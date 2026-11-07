// ExperimentSpec → ExperimentRun protocol (AGENTS.md §2.8).
// Every user-visible number/chart/observation must trace to an ExperimentRun;
// components may only subscribe to runs — never own results.

export type ExperimentKind =
  | 'kakeya.geometry' // tube family generation (simulate_geometry)
  | 'kakeya.voxel' // one finite-scale voxel measurement
  | 'kakeya.sweep' // |⋃T|–N sweep
  | 'kakeya.preview' // drag-time low-res preview (presentation-only, not evidence)
  | 'lv.ode' // second-paper ODE (Pyodide/scipy)
  | 'ode.phase2' // generic 2-state paper ODE, phase-plane + time series from ONE run (#24)
  | 'kakeya.pyodide-mc' // NumPy Monte-Carlo cross-check
  | 'perron.tree' // 2D Perron tree measurement
  | 'formula.curve' // generic formula explorer (Cortex→JS sampling)
  | 'formula.preview' // drag-time coarse-grid preview (same kernel, presentation-only)
  | 'formula.value' // single-point formula evaluation (Cortex→JS)
  | 'mujoco.sim' // MuJoCo WASM headless simulation (vendored demo scenes)
  | 'challenge.attempt' // playable-challenge attempt (code-built model, real compute)
  | 'model.compiled' // paper→model L2: N-state paper equations compiled & verified (paper-to-model)
  | 'model.solved' // paper→model L2: N-state RK4 integration, one run = all series

export interface ExperimentSpec {
  kind: ExperimentKind
  /** numeric inputs, fully describing the run (single source: runtime params) */
  params: Record<string, number>
  /** deterministic RNG seed (0 = none) */
  seed: number
  /** voxel grid resolution when applicable */
  res?: number
  /** Serializable model inputs needed to reproduce non-Kakeya experiments. */
  model?: unknown
  source?: unknown
}

export type RunStatus = 'stale' | 'computing' | 'resolved' | 'error'

export interface ExperimentRun<T = unknown> {
  runId: string
  spec: ExperimentSpec
  status: RunStatus
  result: T | undefined
  /** which engine produced the result */
  engine: string
  engineVersion: string
  durationMs: number
  evidence: 'CALCULATED'
  createdAt: number
  /** wall-clock start (v6 protocol: same instant as createdAt at run start) */
  startedAt: number
  /** fork lineage: parent run this one was compared against */
  parentRunId?: string
  /** execution errors (empty on success) — part of the v6 audit contract */
  errors: string[]
}

export const ENGINES = {
  kakeyaWorker: { engine: 'ts-kakeya-worker', version: 'v3' },
  kakeyaPreview: { engine: 'ts-kakeya-preview', version: 'v3' },
  cppPrecomputed: { engine: 'cpp-precompute', version: 'kakeya-voxel-v3-cpp' },
  pyodide: { engine: 'pyodide-scipy', version: 'v0.27.7' },
  cortexJs: { engine: 'cortex-ce-js', version: '0.142.0' },
} as const

let runSeq = 0
export function nextRunId(prefix: string): string {
  // cross-process safe run ids: short-lived engine processes spawned in the
  // same millisecond collide on `${ms}-${seq}` (seq restarts at 0 per process
  // — the 6-way concurrency battery caught two requests sharing a runId).
  // Random entropy is for uniqueness only, never for crypto.
  const ms = Date.now().toString(36)
  const rnd = Math.random().toString(36).slice(2, 7)
  return `${prefix}-${ms}-${rnd}-${runSeq++}`
}

/** Session-local immutable records; exporting never recomputes results. */
const history = new Map<string, ExperimentRun>()
export function getExperimentRun(runId: string): ExperimentRun | undefined {
  return history.get(runId)
}
/** Register an imported (previously executed) run; immutable, id must be new. */
export function registerImportedRun(run: ExperimentRun): void {
  validateImportedRun(run)
  if (history.has(run.runId)) throw new Error(`Run already recorded: ${run.runId}`)
  history.set(run.runId, freezeRecord(structuredClone(run)))
}

/**
 * The import consistency gate (M1): status/result/errors must be coherent and
 * any result must hold JSON evidence — a rejected output can never re-enter
 * history through an import. Shared by registerImportedRun and importRuns so
 * bundle validation is exactly entry validation (import atomicity).
 */
export function validateImportedRun(run: ExperimentRun): void {
  if (!run || typeof run.runId !== 'string' || !run.spec || typeof run.status !== 'string' || !Array.isArray(run.errors)) {
    throw new Error(`Imported run does not match the ExperimentRun protocol: ${String(run?.runId)}`)
  }
  if (!['stale', 'computing', 'resolved', 'error'].includes(run.status)) {
    throw new Error(`Imported run ${run.runId} has illegal status '${run.status}'`)
  }
  if (run.status === 'error') {
    if (run.result !== undefined) throw new Error(`Imported run ${run.runId} is an error run carrying a result — rejected output can never become evidence`)
    if (run.errors.length === 0) throw new Error(`Imported run ${run.runId} is an error run without an error message`)
    return
  }
  if (run.status !== 'resolved') {
    // stale/computing are in-flight states — an import claiming one while
    // carrying a result would smuggle unsealed numbers into history
    if (run.result !== undefined) throw new Error(`Imported run ${run.runId} is '${run.status}' while carrying a result — only resolved runs carry evidence`)
    return
  }
  if (run.result === undefined) throw new Error(`Imported run ${run.runId} has no result`)
  if (run.errors.length > 0) throw new Error(`Imported run ${run.runId} is resolved but carries errors`)
  sealResult(run.result)
}
/** Most recent runs (optionally filtered by kind), newest first. */
export function listExperimentRuns(filter?: { kind?: ExperimentKind; parentRunId?: string; limit?: number }): ExperimentRun[] {
  let rows = [...history.values()]
  if (filter?.kind) rows = rows.filter((r) => r.spec.kind === filter.kind)
  if (filter?.parentRunId) rows = rows.filter((r) => r.parentRunId === filter.parentRunId)
  rows.sort((a, b) => b.createdAt - a.createdAt)
  return rows.slice(0, filter?.limit ?? 50)
}
export function exportExperimentRuns(runIds: string[]): string {
  return JSON.stringify(runIds.map((id) => {
    const run = history.get(id)
    if (!run) throw new Error(`Unknown run: ${id}`)
    return run
  }), null, 2)
}
function freezeRecord<T>(value: T): T {
  if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) freezeRecord(child)
  }
  return value
}

/**
 * Finite-value gate (constitution §0.6): every NUMBER in a result must be
 * finite. NaN/±Infinity means the compute diverged (e.g. a degenerate input
 * slipped through) — such a run is recorded as an ERROR, never as
 * CALCULATED evidence. null/undefined leaves are allowed (a metric may be
 * legitimately absent, e.g. comZFinal when a model has one body).
 */
export function assertFiniteNumbers(value: unknown, path = 'result'): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`non-finite number at ${path}: ${value}`)
    return
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) assertFiniteNumbers(value[i], `${path}[${i}]`)
    return
  }
  if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) {
    for (const [key, child] of Object.entries(value)) assertFiniteNumbers(child, `${path}.${key}`)
  }
}
export class ExperimentExecutionError extends Error {
  constructor(
    public readonly run: ExperimentRun,
    /** the kernel threw, or it finished with output that breaks the Run contract */
    public readonly code: 'execution_failed' | 'output_invalid' = 'execution_failed',
  ) {
    super(run.errors.join('; '))
  }
}

/**
 * The evidence boundary (PLAN §3.3): a Run result holds finite numbers, strings,
 * booleans, nulls, plain objects and arrays. Typed arrays and buffers stay mutable
 * and lose dtype/shape in JSON, so binary data must go through artifacts.ts and
 * appear here as a reference. Returns the copy that gets stored, so the producer
 * keeps ownership of what it returned. Undefined object fields are dropped (JSON
 * has no such value); undefined anywhere else has no faithful form and is refused.
 */
export function sealResult<T>(value: T, path = 'result'): T {
  return sealValue(value, path) as T
}

function sealValue(value: unknown, path: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`non-finite number at ${path}: ${value}`)
    return value
  }
  if (Array.isArray(value)) return Array.from(value, (item, i) => sealValue(item, `${path}[${i}]`))
  if (typeof value === 'object') {
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer)) {
      throw new Error(`binary value at ${path}: seal it with sealArray and store the reference`)
    }
    // plain means the prototype is the end of the chain (true across realms too):
    // Map, Set, Date and class instances all have one more link
    const proto = Object.getPrototypeOf(value)
    if (proto !== null && Object.getPrototypeOf(proto) !== null) {
      throw new Error(`non-JSON object at ${path}: ${Object.prototype.toString.call(value)}`)
    }
    const copy: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      // a __proto__ key would swap the copy's prototype instead of adding a
      // field — prototype pollution, not data
      if (key === '__proto__') throw new Error(`prototype key at ${path}: refused`)
      if (child !== undefined) copy[key] = sealValue(child, `${path}.${key}`)
    }
    return copy
  }
  throw new Error(`non-JSON value at ${path}: ${typeof value}`)
}

export type OutputValidator = (result: unknown) => string | null

/** wrap a deterministic compute into a full ExperimentRun */
export async function executeSpec<T>(
  spec: ExperimentSpec,
  engine: { engine: string; version: string },
  compute: () => Promise<T> | T,
  lineage: { parentRunId?: string; validateOutput?: OutputValidator } = {},
): Promise<ExperimentRun<T>> {
  const t0 = performance.now()
  const startedAt = Date.now()
  const input = structuredClone(spec)
  let result: T | undefined
  let failure: string | undefined
  let failureCode: 'execution_failed' | 'output_invalid' = 'execution_failed'
  try {
    const computed = await compute()
    // the boundary runs BEFORE the run can be stamped CALCULATED; on failure the
    // output is discarded, so a rejected value can never reach a chart or a Goal
    failureCode = 'output_invalid'
    const sealedResult = sealResult(computed)
    const invalid = lineage.validateOutput?.(sealedResult)
    if (invalid) throw new Error(`output contract: ${invalid}`)
    result = sealedResult
  } catch (err) {
    // a nested executeSpec (sweep child runs) rethrows its own classified
    // failure — keep that classification instead of relabeling it
    if (err instanceof ExperimentExecutionError) failureCode = err.code
    failure = err instanceof Error ? err.message : String(err)
  }
  const run: ExperimentRun<T> = {
    runId: nextRunId(spec.kind.replace(/\./g, '-')),
    spec: input,
    status: failure === undefined ? 'resolved' : 'error',
    result,
    engine: engine.engine,
    engineVersion: engine.version,
    durationMs: Math.max(0, Math.round(performance.now() - t0)),
    evidence: 'CALCULATED',
    createdAt: startedAt,
    startedAt,
    parentRunId: lineage.parentRunId,
    errors: failure === undefined ? [] : [failure],
  }
  freezeRecord(run)
  history.set(run.runId, run)
  if (failure !== undefined) throw new ExperimentExecutionError(run, failureCode)
  return run
}
