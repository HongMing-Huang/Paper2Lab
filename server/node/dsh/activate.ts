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
  const home = staging
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
    const sessionHandle = session as unknown as { id: string }
    trace.sessionId = sessionId ?? sessionHandle.id ?? ''
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
