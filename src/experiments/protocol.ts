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

export interface ExperimentSpec {
  kind: ExperimentKind
  /** numeric inputs, fully describing the run (single source: runtime params) */
  params: Record<string, number>
  /** deterministic RNG seed (0 = none) */
  seed: number
  /** voxel grid resolution when applicable */
  res?: number
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

/** wrap a deterministic compute into a full ExperimentRun */
export async function executeSpec<T>(
  spec: ExperimentSpec,
  engine: { engine: string; version: string },
  compute: () => Promise<T> | T,
): Promise<ExperimentRun<T>> {
  const t0 = performance.now()
  const startedAt = Date.now()
  const result = await compute()
  return {
    runId: nextRunId(spec.kind.replace(/\./g, '-')),
    spec,
    status: 'resolved',
    result,
    engine: engine.engine,
    engineVersion: engine.version,
    durationMs: Math.max(0, Math.round(performance.now() - t0)),
    evidence: 'CALCULATED',
    createdAt: startedAt,
    startedAt,
    errors: [],
  }
}
