// ExperimentSpec → ExperimentRun protocol (AGENTS.md §2.8).
// Every user-visible number/chart/observation must trace to an ExperimentRun;
// components may only subscribe to runs — never own results.

export type ExperimentKind =
  | 'kakeya.geometry' // tube family generation (simulate_geometry)
  | 'kakeya.voxel' // one finite-scale voxel measurement
  | 'kakeya.sweep' // |⋃T|–N sweep
  | 'kakeya.preview' // drag-time low-res preview (presentation-only, not evidence)
  | 'lv.ode' // second-paper ODE (Pyodide/scipy)
  | 'kakeya.pyodide-mc' // NumPy Monte-Carlo cross-check
  | 'perron.tree' // 2D Perron tree measurement
  | 'formula.curve' // generic formula explorer (Cortex→JS sampling)
  | 'formula.value' // single-point formula evaluation (Cortex→JS)
  | 'mujoco.sim' // MuJoCo WASM headless simulation (vendored demo scenes)

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
  return `${prefix}-${Date.now().toString(36)}-${(runSeq++).toString(36)}`
}

/** Session-local immutable records; exporting never recomputes results. */
const history = new Map<string, ExperimentRun>()
export function getExperimentRun(runId: string): ExperimentRun | undefined {
  return history.get(runId)
}
/** Register an imported (previously executed) run; immutable, id must be new. */
export function registerImportedRun(run: ExperimentRun): void {
  if (history.has(run.runId)) throw new Error(`Run already recorded: ${run.runId}`)
  if (run.status === 'resolved' && run.result === undefined) throw new Error(`Imported run ${run.runId} has no result`)
  history.set(run.runId, freezeRecord(structuredClone(run)))
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
export class ExperimentExecutionError extends Error {
  constructor(public readonly run: ExperimentRun) {
    super(run.errors.join('; '))
  }
}

/** wrap a deterministic compute into a full ExperimentRun */
export async function executeSpec<T>(
  spec: ExperimentSpec,
  engine: { engine: string; version: string },
  compute: () => Promise<T> | T,
  lineage: { parentRunId?: string } = {},
): Promise<ExperimentRun<T>> {
  const t0 = performance.now()
  const startedAt = Date.now()
  const input = structuredClone(spec)
  let result: T | undefined
  let failure: string | undefined
  try { result = await compute() } catch (err) { failure = err instanceof Error ? err.message : String(err) }
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
  if (failure !== undefined) throw new ExperimentExecutionError(run)
  return run
}
