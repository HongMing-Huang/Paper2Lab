// J1.2a — one engine attempt = one OWNED child process running the unified
// executor in candidate mode (scripts/engine_once --candidate). The child only
// returns a candidate; it never reads or writes the legacy JSONL run log. A
// cancel/timeout/shutdown kills THIS child only (SIGTERM, then SIGKILL after a
// grace period) and resolves only after the OS reported its exit — "queue
// cancelled" is never mistaken for "computation stopped".
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface EngineCommand {
  command: string
  args: string[]
  cwd: string
  /** identity of the code that actually executes (bundle hash or 'source') */
  artifact: { mode: 'bundle' | 'source'; path: string; sha256: string | null }
}

/** once-bundle preferred (the artifact Docker ships), TS source as fallback —
 *  the same built-first rule engine_bridge applies to engine_server */
export function resolveEngineCommand(repoRoot: string, mode: string = process.env.PAPER2LAB_ENGINE_MODE ?? 'auto'): EngineCommand {
  const bundle = join(repoRoot, 'scripts', 'engine_once.mjs')
  const source = join(repoRoot, 'scripts', 'engine_once.ts')
  if (mode !== 'source' && existsSync(bundle)) {
    const sha256 = createHash('sha256').update(readFileSync(bundle)).digest('hex')
    return { command: process.execPath, args: [bundle, '--candidate'], cwd: repoRoot, artifact: { mode: 'bundle', path: 'scripts/engine_once.mjs', sha256 } }
  }
  if (mode === 'bundle') throw new Error('PAPER2LAB_ENGINE_MODE=bundle but scripts/engine_once.mjs is missing')
  return { command: process.execPath, args: ['--import', 'tsx', source, '--candidate'], cwd: repoRoot, artifact: { mode: 'source', path: 'scripts/engine_once.ts', sha256: null } }
}

export interface EngineExit {
  code: number | null
  signal: NodeJS.Signals | null
}

export type EngineResult =
  | { kind: 'outcome'; outcome: Record<string, unknown>; wallMs: number; pid: number; timing?: Record<string, number> }
  | { kind: 'aborted'; reason: string; exit: EngineExit; wallMs: number; pid: number }
  | { kind: 'failed'; message: string; exit: EngineExit; stderrTail: string; wallMs: number; pid: number }

export interface RunEngineOptions {
  signal: AbortSignal
  timeoutMs: number
  /** called once the child exists (audit trail: which OS process computed) */
  onSpawn?: (pid: number) => void
  killGraceMs?: number
}

export function runEngine(cmd: EngineCommand, request: Record<string, unknown>, opts: RunEngineOptions): Promise<EngineResult> {
  const started = Date.now()
  return new Promise((resolve) => {
    const child = spawn(cmd.command, cmd.args, {
      cwd: cmd.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      // the engine's orphan watchdog compares its parent against this pid
      env: { ...process.env, PAPER2LAB_ENGINE_OWNER_PID: String(process.pid) },
    })
    const pid = child.pid ?? -1
    const out: Buffer[] = []
    let errTail = ''
    let abortReason: string | null = null
    let killTimer: NodeJS.Timeout | null = null
    let spawnError: Error | null = null

    child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      errTail = (errTail + chunk.toString('utf8')).slice(-2000)
    })
    child.on('error', (err) => {
      spawnError = err
    })

    const abort = (reason: string) => {
      if (abortReason !== null) return
      abortReason = reason
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), opts.killGraceMs ?? 2000)
    }
    const timeout = setTimeout(() => abort('timeout'), opts.timeoutMs)
    const onAbort = () => abort(String(opts.signal.reason ?? 'aborted'))
    if (opts.signal.aborted) onAbort()
    else opts.signal.addEventListener('abort', onAbort, { once: true })

    // 'close' fires after the process EXITED and its stdio drained — the
    // confirmation the cancel contract needs
    child.on('close', (code, signal) => {
      clearTimeout(timeout)
      if (killTimer) clearTimeout(killTimer)
      opts.signal.removeEventListener('abort', onAbort)
      const wallMs = Date.now() - started
      const exit = { code, signal }
      if (abortReason !== null) return resolve({ kind: 'aborted', reason: abortReason, exit, wallMs, pid })
      if (spawnError) return resolve({ kind: 'failed', message: `engine spawn failed: ${spawnError.message}`, exit, stderrTail: errTail, wallMs, pid })
      if (code !== 0) return resolve({ kind: 'failed', message: `engine exited ${code ?? signal}`, exit, stderrTail: errTail, wallMs, pid })
      try {
        const raw = Buffer.concat(out)
        const parsed = JSON.parse(raw.toString('utf8')) as { outcome?: Record<string, unknown>; timing?: Record<string, unknown> }
        if (!parsed || typeof parsed.outcome !== 'object' || parsed.outcome === null) throw new Error('missing outcome')
        // the engine's own spans (boot/read/execute) ride beside the outcome
        const timing: Record<string, number> = { outputBytes: raw.length }
        for (const [k, v] of Object.entries(parsed.timing ?? {})) if (typeof v === 'number' && Number.isFinite(v)) timing[k] = v
        resolve({ kind: 'outcome', outcome: parsed.outcome, wallMs, pid, timing })
      } catch (err) {
        resolve({ kind: 'failed', message: `engine produced unparseable output: ${err instanceof Error ? err.message : String(err)}`, exit, stderrTail: errTail, wallMs, pid })
      }
    })

    if (pid > 0) opts.onSpawn?.(pid)
    child.stdin.on('error', () => {
      /* a child that died before reading stdin reports through 'close' */
    })
    child.stdin.end(JSON.stringify(request))
  })
}

/** is an OS process still alive? (signal 0 probes without delivering) */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}
