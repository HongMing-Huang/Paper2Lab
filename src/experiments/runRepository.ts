// Run Repository (Stage B) — query/import/export over the immutable run
// history held by the protocol module. Compare works on EXPLICITLY chosen
// run ids, never "all experiments in a store".
import {
  getExperimentRun,
  listExperimentRuns,
  registerImportedRun,
  validateImportedRun,
  type ExperimentRun,
} from './protocol'

export interface CompareRow {
  key: string
  a: number | null
  b: number | null
  delta: number | null
}

export interface RunComparison {
  runA: string
  runB: string
  kindA: string
  kindB: string
  rows: CompareRow[]
}

/** collect finite numeric leaves of a result object as {path → value} */
function numericLeaves(value: unknown, prefix = ''): Map<string, number> {
  const out = new Map<string, number>()
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.set(prefix || 'value', value)
  } else if (Array.isArray(value)) {
    // arrays (points…) are summarised, not enumerated
    const finite = value.filter((v) => typeof v === 'number' && Number.isFinite(v))
    if (finite.length) out.set(`${prefix}(${finite.length})`, finite.length)
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      for (const [pk, pv] of numericLeaves(v, prefix ? `${prefix}.${k}` : k)) out.set(pk, pv)
    }
  }
  return out
}

/** metric-by-metric diff of two EXPLICIT runs; rejects unknown ids */
export function compareRuns(runA: string, runB: string): RunComparison {
  const a = getExperimentRun(runA)
  const b = getExperimentRun(runB)
  if (!a) throw new Error(`Unknown run: ${runA}`)
  if (!b) throw new Error(`Unknown run: ${runB}`)
  const leavesA = numericLeaves(a.result)
  const leavesB = numericLeaves(b.result)
  const keys = [...new Set([...leavesA.keys(), ...leavesB.keys()])].sort()
  const rows: CompareRow[] = keys
    .filter((k) => !k.includes('(')) // skip array-size summaries
    .map((k) => {
      const av = leavesA.get(k) ?? null
      const bv = leavesB.get(k) ?? null
      return { key: k, a: av, b: bv, delta: av !== null && bv !== null ? bv - av : null }
    })
  return { runA, runB, kindA: a.spec.kind, kindB: b.spec.kind, rows }
}

/** import an exported run bundle (JSON string) — all-or-nothing, ids must be new */
export function importRuns(bundleJson: string): { imported: number } {
  const parsed = JSON.parse(bundleJson) as unknown
  if (!Array.isArray(parsed)) throw new Error('Run bundle must be a JSON array')
  const runs = parsed as ExperimentRun[]
  // preflight EVERY entry against the full import gate (same assertion as
  // registerImportedRun) plus duplicate ids, BEFORE touching the store — a
  // mid-bundle failure must leave nothing imported and stay retryable
  for (const r of runs) validateImportedRun(r)
  const seen = new Set<string>()
  for (const r of runs) {
    if (getExperimentRun(r.runId)) throw new Error(`Run already recorded: ${r.runId}`)
    if (seen.has(r.runId)) throw new Error(`Run already recorded: ${r.runId}`)
    seen.add(r.runId)
  }
  for (const r of runs) registerImportedRun(r)
  return { imported: runs.length }
}

export { getExperimentRun, listExperimentRuns }
