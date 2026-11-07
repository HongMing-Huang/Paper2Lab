// J1.2b — the DSH activation runner. Owns ONE DeepSeekHarness runtime per
// research activation: generates the product patch overlay from env, spawns
// the runtime with a scrubbed environment, runs one prompt on a new or resumed
// session, records the full tool-call trace, and CLOSES the runtime (closing is
// confirmed; a failed close is reported, never swallowed).
//
// The DSH SDK lives only in the isolated server/node/dsh install; this module
// loads it dynamically, so the product server boots fine without it.
//
// Budget: one activation is bounded by model rounds (the SDK runs one prompt
// per run() — multi-round tool loops happen INSIDE that run), wall clock, and
// output tokens (maxTokens on the harness). No unbounded loop exists here.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DSH_ROOT = join(HERE)
/** the isolated official-SDK install this runner loads dynamically */
export const SDK_ENTRY = join(DSH_ROOT, 'node_modules', '@deepseek-ai', 'dsh-sdk-client', 'lib', 'index.js')
const PATCH_TEMPLATE = join(DSH_ROOT, 'paper2lab-research.patch.yml')

export interface ActivationConfig {
  provider: string
  model: string
  baseURL: string
  apiKey: string
  contextWindow: number
  maxTokens: number
  scienceUrl: string
  wallClockMs: number
  /** extra fixed env the runtime needs (PATH…); credentials are merged separately */
  env?: Record<string, string>
}

export function readQwenConfig(env: NodeJS.ProcessEnv = process.env): ActivationConfig | { error: string } {
  const apiKey = env.PAPER2LAB_QWEN_API_KEY ?? env.DASHSCOPE_API_KEY ?? ''
  if (!apiKey) return { error: 'PAPER2LAB_QWEN_API_KEY (or DASHSCOPE_API_KEY) is not configured — real Qwen turns are blocked until it is; see /api/v1/research/health' }
  return {
    provider: 'qwen',
    model: env.PAPER2LAB_QWEN_MODEL ?? 'qwen-plus',
    baseURL: env.PAPER2LAB_QWEN_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    apiKey,
    contextWindow: Number(env.PAPER2LAB_QWEN_CONTEXT_WINDOW ?? 131072),
    maxTokens: Number(env.PAPER2LAB_QWEN_MAX_TOKENS ?? 8192),
    scienceUrl: env.PAPER2LAB_SCIENCE_URL ?? 'http://127.0.0.1:8790',
    wallClockMs: Number(env.PAPER2LAB_RESEARCH_WALLCLOCK_MS ?? 15 * 60_000),
  }
}

/** the quota-exhaustion fallback provider (PAPER2LAB_QWEN_FALLBACK_*): used
 *  automatically when the primary answers with a quota/auth-class error, so
 *  research continues on the备用 model without user intervention */
export function readFallbackConfig(env: NodeJS.ProcessEnv = process.env): ActivationConfig | null {
  const apiKey = env.PAPER2LAB_QWEN_FALLBACK_API_KEY ?? ''
  if (!apiKey) return null
  return {
    provider: 'qwen',
    model: env.PAPER2LAB_QWEN_FALLBACK_MODEL ?? env.PAPER2LAB_QWEN_MODEL ?? 'qwen-plus',
    baseURL: env.PAPER2LAB_QWEN_FALLBACK_BASE_URL ?? env.PAPER2LAB_QWEN_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    apiKey,
    contextWindow: Number(env.PAPER2LAB_QWEN_FALLBACK_CONTEXT_WINDOW ?? env.PAPER2LAB_QWEN_CONTEXT_WINDOW ?? 131072),
    maxTokens: Number(env.PAPER2LAB_QWEN_FALLBACK_MAX_TOKENS ?? env.PAPER2LAB_QWEN_MAX_TOKENS ?? 8192),
    scienceUrl: env.PAPER2LAB_SCIENCE_URL ?? 'http://127.0.0.1:8790',
    wallClockMs: Number(env.PAPER2LAB_RESEARCH_WALLCLOCK_MS ?? 15 * 60_000),
  }
}

/** did the provider answer with a quota/auth-class error worth a fallback? */
export function isQuotaClassFailure(trace: { finishReason: string | null; finalResponse: string; assistantTexts: Array<{ text: string }> }, errorText?: string): boolean {
  const hay = `${trace.finishReason ?? ''} ${errorText ?? ''} ${trace.assistantTexts.map((t) => t.text).join(' ').slice(-500)}`.toLowerCase()
  return /quota|arrearage|insufficient|balance|401|402|403|invalid_api_key|rate.?limit|throttl/.test(hay) && !trace.finalResponse
}

/** 用户提供的百炼模型池：主模型不可用（配额/认证/模型不存在或已下线类
 *  错误）时，同一 API key 内按序切换下一个 ID 重试，不等用户干预。 */
export const BAILIAN_MODEL_POOL = [
  'qwen3.8-27b',
  'qwen3.8-flash',
  'kimi-k3',
  'qwen3.8-max-0902',
  'deepseek-v4.1-flash-1017',
  'deepseek-v4.1-flash',
  'glm-5.3',
  'deepseek-v4-pro-0813',
  'qwen3.8-2.4t-a95b',
] as const

/** ordered model ids to try per turn: the configured primary first, then the
 *  pool (deduped). PAPER2LAB_QWEN_MODEL_CHAIN overrides the whole order. */
export function readModelChain(env: NodeJS.ProcessEnv = process.env): string[] {
  const explicit = (env.PAPER2LAB_QWEN_MODEL_CHAIN ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (explicit.length > 0) return [...new Set(explicit)]
  const primary = (env.PAPER2LAB_QWEN_MODEL ?? BAILIAN_MODEL_POOL[0]).trim()
  return [primary, ...BAILIAN_MODEL_POOL.filter((m) => m !== primary)]
}

/** "model unusable" class: the model id doesn't exist / isn't available /
 *  decommissioned on this endpoint, an upstream 5xx — or the provider round
 *  died with finishReason=error producing NOTHING (no answer, no assistant
 *  text, no tool step). Worth switching id; never fires when anything was
 *  produced (a partial answer is delivered, not retried on another model). */
export function isModelUnusableFailure(trace: { finishReason: string | null; finalResponse: string; assistantTexts: Array<{ text: string }>; steps?: Array<unknown> }, errorText?: string): boolean {
  if (trace.finalResponse) return false
  const producedNothing = trace.assistantTexts.length === 0 && (!trace.steps || trace.steps.length === 0)
  if ((trace.finishReason === 'error' || trace.finishReason === null) && producedNothing) return true
  const hay = `${trace.finishReason ?? ''} ${errorText ?? ''} ${trace.assistantTexts.map((t) => t.text).join(' ').slice(-500)}`.toLowerCase()
  return (
    /model[^\n]{0,60}(not[ _]?(found|exist|available|exist)|does[^\n]{0,10}not[^\n]{0,10}exist|unavailable|decommission|deprecated|no[ _]longer)/.test(hay) ||
    /invalid[ _]?(model|model.?id)/.test(hay) ||
    /no[ _]such[ _]model/.test(hay) ||
    /\b(error|failed)\b[^\n]{0,40}\bmodel\b/.test(hay) ||
    /503|502|service[ _]unavailable/.test(hay)
  )
}

/** any failure worth an automatic same-key model-id switch */
export function isFallbackWorthyFailure(trace: Parameters<typeof isQuotaClassFailure>[0], errorText?: string): boolean {
  return isQuotaClassFailure(trace, errorText) || isModelUnusableFailure(trace, errorText)
}

/** generate the effective patch overlay for one activation (env-driven model
 *  and endpoint), in a private temp dir beside the plugin so the loader's
 *  relative `name: ./paper2lab-science-plugin.mjs` anchor still resolves */
function materializePatch(cfg: ActivationConfig): { dir: string; patchPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'p2l-dsh-activation-'))
  const template = readFileSync(PATCH_TEMPLATE, 'utf8')
  const url = new URL(cfg.baseURL)
  const patched = template
    .replace(/baseURL: .+/, `baseURL: ${url.origin}${url.pathname.replace(/\/+$/, '')}`)
    .replace(/model: qwen-plus\n/, `model: ${cfg.model}\n`)
    .replace(/- id: qwen-plus\n/, `- id: ${cfg.model}\n`)
    .replace(/name: Qwen Plus\n/, `name: ${cfg.model}\n`)
    .replace(/contextWindow: \d+/, `contextWindow: ${cfg.contextWindow}`)
    .replace(/maxTokens: \d+/, `maxTokens: ${cfg.maxTokens}`)
    .replace(/scienceUrl: .+/, `scienceUrl: ${cfg.scienceUrl}`)
  const patchPath = join(dir, 'paper2lab.patch.yml')
  writeFileSync(patchPath, patched)
  // the loader anchors a relative plugin path beside the PATCH file: link the
  // plugin (and, so Node resolves its @deepseek-ai imports, node_modules)
  writeFileSync(join(dir, 'paper2lab-science-plugin.mjs'), readFileSync(join(DSH_ROOT, 'paper2lab-science-plugin.mjs')))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'p2l-dsh-activation', private: true, type: 'module' }))
  const nm = join(dir, 'node_modules')
  spawn('/bin/ln', ['-s', join(DSH_ROOT, 'node_modules'), nm]).on('error', () => {})
  return { dir, patchPath }
}

export interface ToolStep {
  seq: number
  kind: 'tool_call' | 'tool_result'
  name: string
  callId: string
  arguments?: unknown
  isError?: boolean
  text?: string
  meta?: unknown
}

export interface ActivationTrace {
  sessionId: string
  finishReason: string | null
  finalResponse: string
  steps: ToolStep[]
  assistantTexts: Array<{ turn: number; text: string }>
  usage: Array<Record<string, unknown>>
  runtimeClosed: boolean
}

/** thrown when the caller asked to stop mid-run (cooperative cancel): the
 *  runtime was closed, its subprocess is confirmed reaped, and the model
 *  output — if any had streamed — is DISCARDED (a cancelled turn is never
 *  reported as the model's answer) */
export class ActivationCancelled extends Error {
  constructor() {
    super('cancelled: the owning turn was asked to stop; the DSH runtime is closed')
    this.name = 'ActivationCancelled'
  }
}

/** run ONE bounded research turn on the DSH runtime. `sessionId` resumes an
 *  existing persisted session (its DSH history dir must exist); omitted mints
 *  a fresh one whose history is persisted under the session id after close.
 *  `shouldAbort` is polled while the model runs: true → close the runtime and
 *  throw ActivationCancelled. */
export async function runResearchActivation(cfg: ActivationConfig, prompt: string, sessionId?: string, shouldAbort?: () => boolean): Promise<ActivationTrace> {
  const { DeepSeekHarness } = (await import(pathToFileURL(SDK_ENTRY).href)) as {
    DeepSeekHarness: new (options: Record<string, unknown>) => {
      start(): Promise<void>
      session(id?: string): { run(input: string, options?: Record<string, unknown>): Promise<Record<string, unknown>> }
      resumeSession(id: string): Promise<{ run(input: string, options?: Record<string, unknown>): Promise<Record<string, unknown>> }>
      close(): Promise<void>
    }
  }
  // session history must SURVIVE the activation: resumeSession reads the
  // persisted sessions dir of the SAME dshHome that created the session. New
  // sessions run in a staging dir under the data root and are renamed to
  // <sessionsRoot>/<sessionId> after close (same filesystem); resumes use the
  // persisted dir directly. One dir per session — no cross-session contention.
  const dataDir = process.env.PAPER2LAB_DATA_DIR ?? join(HERE, '..', '..', 'server', 'data')
  const sessionsRoot = join(dataDir, 'dsh-sessions')
  mkdirSync(sessionsRoot, { recursive: true })
  if (sessionId) {
    const persisted = join(sessionsRoot, sessionId)
    if (!existsSync(persisted)) {
      throw new Error(`session '${sessionId}' has no persisted DSH history under ${sessionsRoot} — submit a new turn without a sessionId to start fresh`)
    }
  }
  const staging = mkdtempSync(join(sessionsRoot, 'activation-'))
  // a RESUME runs with the persisted dir as its home — the SDK discovers
  // session history under its own dshHome, and the stored journal path embeds
  // the home it was created in, so a fresh staging dir can never see it (the
  // follow-up turn then fails "session not found"). Fresh sessions run in the
  // staging dir and are renamed into place after close. Same-session
  // concurrency is already excluded by the API's session-busy guard.
  const home = sessionId ? join(sessionsRoot, sessionId) : staging
  const { patchPath } = materializePatch(cfg)
  const runtime = new DeepSeekHarness({
    dshHome: home,
    processCwd: home,
    cwd: home,
    provider: cfg.provider,
    model: cfg.model,
    maxTokens: cfg.maxTokens,
    patches: [patchPath],
    env: {
      PATH: cfg.env?.PATH ?? '/usr/bin:/bin',
      HOME: home,
      TMPDIR: tmpdir(),
      LANG: 'en_US.UTF-8',
      DSH_TELEMETRY_MODE: 'DISABLED',
      // the ONLY credential the runtime receives
      PAPER2LAB_QWEN_API_KEY: cfg.apiKey,
      PAPER2LAB_API_TOKEN: process.env.PAPER2LAB_API_TOKEN ?? '',
    },
    initializeTimeoutMs: 60_000,
    requestTimeoutMs: cfg.wallClockMs,
    disposeEofGraceMs: 3_000,
    disposeGraceMs: 5_000,
  })
  const steps: ToolStep[] = []
  let seq = 0
  const trace = { sessionId: '', finishReason: null as string | null, finalResponse: '', steps, assistantTexts: [] as ActivationTrace['assistantTexts'], usage: [] as Array<Record<string, unknown>>, runtimeClosed: false }
  try {
    await runtime.start()
    const session = sessionId ? await runtime.resumeSession(sessionId) : runtime.session()
    const sessionHandle = session as unknown as { id: string; setWorkingDirectory?: (path: string) => Promise<string> }
    trace.sessionId = sessionId ?? sessionHandle.id ?? ''
    if (sessionId) {
      // resume fix: the persisted journal records its ORIGINAL staging home as
      // the working directory — after the staging→session rename that path no
      // longer exists and the first turn dies with `working-directory: directory
      // does not exist`. Point the session back at its persisted home before
      // running (origin/permissions unchanged; the SDK validates the path).
      const fix = sessionHandle.setWorkingDirectory
      if (typeof fix === 'function') await fix.call(session, home)
    }
    // cooperative cancel: poll the caller's flag; on cancel, close the runtime
    // (reaps the subprocess) and settle as cancelled — the partial model output
    // never becomes the turn's answer
    let cancelWatcher: NodeJS.Timeout | null = null
    const cancelled = new Promise<never>((_, reject) => {
      if (!shouldAbort) return
      cancelWatcher = setInterval(() => {
        if (shouldAbort()) {
          if (cancelWatcher) clearInterval(cancelWatcher)
          reject(new ActivationCancelled())
        }
      }, 500)
    })
    let result: Record<string, unknown>
    try {
      result = await Promise.race([
        session.run(prompt, {
          onNotification: (notification: { method: string; params: Record<string, unknown> }) => {
            if (notification.method !== 'session.event') return
            const event = notification.params.event as { type: string; data?: Record<string, unknown>; sessionId?: string }
            trace.sessionId = trace.sessionId || String(notification.params.sessionId ?? '')
            const data = event.data ?? {}
            if (event.type === 'tool/call') {
              let args: unknown
              try {
                args = JSON.parse(String(data.arguments ?? 'null'))
              } catch {
                args = String(data.arguments ?? '')
              }
              steps.push({ seq: seq++, kind: 'tool_call', name: String(data.name ?? ''), callId: String(data.callId ?? ''), arguments: args })
            } else if (event.type === 'tool/result') {
              const message = (data.message ?? {}) as { toolCallId?: string; isError?: boolean; content?: Array<{ type: string; text?: string }>; source?: { name?: string } }
              const blocks = Array.isArray(message.content) ? message.content : []
              const meta = data.meta
              steps.push({
                seq: seq++,
                kind: 'tool_result',
                name: String(message.source?.name ?? ''),
                callId: String(message.toolCallId ?? ''),
                isError: message.isError === true,
                text: blocks.filter((b) => b.type === 'text').map((b) => String(b.text ?? '')).join('\n').slice(0, 4000),
                ...(meta !== undefined ? { meta } : {}),
              })
            } else if (event.type === 'assistant/message') {
              const message = (data.message ?? {}) as { content?: Array<{ type: string; text?: string }> }
              const text = (Array.isArray(message.content) ? message.content : []).filter((b) => b.type === 'text').map((b) => String(b.text ?? '')).join('')
              if (text) trace.assistantTexts.push({ turn: Number(data.turn ?? 0), text })
              if (data.usage !== undefined && data.usage && typeof data.usage === 'object') trace.usage.push(data.usage as Record<string, unknown>)
            }
          },
        }),
        cancelled,
      ])
    } finally {
      if (cancelWatcher) clearInterval(cancelWatcher)
    }
    trace.finishReason = typeof result.finishReason === 'string' ? result.finishReason : null
    trace.finalResponse = String(result.finalResponse ?? '')
  } finally {
    try {
      await runtime.close()
      trace.runtimeClosed = true
    } catch (err) {
      trace.runtimeClosed = false
      trace.finishReason = `${trace.finishReason ?? ''}|close-failed:${err instanceof Error ? err.message : String(err)}`.trim()
    }
    // persist the session history for future resumes: rename the staging home
    // to <sessionsRoot>/<sessionId> (same filesystem). Best effort — the turn
    // itself already settled; a failed rename only costs the NEXT resume.
    if (trace.sessionId && !sessionId) {
      try {
        const target = join(sessionsRoot, trace.sessionId)
        if (!existsSync(target)) renameSync(staging, target)
      } catch {
        /* keep going: the answer stands, resume will report missing history */
      }
    }
  }
  return trace
}
