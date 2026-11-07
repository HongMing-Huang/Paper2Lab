// High-scale precomputed runs (AGENTS §3.2): the browser computes small
// scales real-time; grids too heavy for the page (up to 320³, δ=2⁻⁸) are
// precomputed offline by the C++ engine and arrive as immutable
// ExperimentRuns. Importing is atomic + idempotent, so every precomputed
// datapoint carries a REAL traceable runId (engine cpp-precompute) — never a
// presentation literal.
import { kakeya, pDeltaExp, pPacking } from './kakeyaGraph'
import { getExperimentRun, listExperimentRuns, type ExperimentRun } from '../experiments/protocol'
import { importRuns } from '../experiments/runRepository'
import type { CurvePoint } from '../kakeya/metrics'
import fallbackBundle from '../data/kakeya-precomputed-runs.json'
import { authHeaders } from '../ingest/apiAuth'

/** bump after an import to recompute the points cell */
export const pPrecomputedNonce = kakeya.param<number>('kakeya.precomputed.nonce', 0)

interface PrecomputedRun extends ExperimentRun<{ res: number; occupiedVolume: number }> {
  engine: string
  spec: ExperimentRun['spec'] & { params: { deltaExp: number; packing: number; nTubes: number } }
}

function availableRows(): PrecomputedRun[] {
  // resolved only — an imported error row must never become chart evidence
  return listExperimentRuns({ kind: 'kakeya.voxel', limit: 500 }).filter(
    (r) => r.engine === 'cpp-precompute' && r.status === 'resolved',
  ) as PrecomputedRun[]
}

/** fetch from the backend engine; fall back to the bundled dataset offline */
async function fetchRuns(): Promise<unknown[]> {
  try {
    const res = await fetch('/api/engine/kakeya/precomputed', { headers: authHeaders() })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as { runs?: unknown[] }
    if (!Array.isArray(body.runs) || body.runs.length === 0) throw new Error('empty bundle')
    return body.runs
  } catch {
    // the same bundle ships with the app — offline/dev fallback stays honest
    return (fallbackBundle as { runs: unknown[] }).runs
  }
}

/**
 * Idempotent: runs already recorded are skipped, the rest import atomically.
 * Returns how many new runs landed (0 on a warm cache).
 */
export async function ensurePrecomputedRuns(): Promise<{ imported: number; skipped: number; source: string }> {
  const rows = (await fetchRuns()) as PrecomputedRun[]
  const fresh = rows.filter((r) => !getExperimentRun(r.runId))
  let source = 'bundled'
  if (fresh.length > 0) {
    importRuns(JSON.stringify(fresh))
    source = rows === ((fallbackBundle as { runs: unknown[] }).runs) ? 'bundled' : 'api'
  }
  kakeya.setParam(pPrecomputedNonce.id, Date.now())
  return { imported: fresh.length, skipped: rows.length - fresh.length, source }
}

export const PRECOMPUTED_DELTA_EXPS = [4, 5, 6, 7, 8, 9, 10] as const
const PRECOMPUTED_PACKINGS = [0, 0.5, 1]

// read-only evidence hook (also works in the built bundle — the headless
// product-path script asserts the imported high-scale run ids)
if (typeof window !== 'undefined') {
  ;(window as unknown as { __P2L_CPP_RUNS__?: () => string[] }).__P2L_CPP_RUNS__ = () =>
    availableRows().map((r) => r.runId)
}

/** precomputed series for the CURRENT δ/packing selection (real runIds) */
export const precomputedPointsCell = kakeya.derive<CurvePoint[]>(
  'kakeya.precomputed.points',
  [pDeltaExp, pPacking, pPrecomputedNonce],
  ([deltaExp, packing]) => {
    const e = PRECOMPUTED_DELTA_EXPS.reduce((best, c) =>
      Math.abs(c - (deltaExp as number)) < Math.abs(best - (deltaExp as number)) ? c : best, 4)
    const p = PRECOMPUTED_PACKINGS.reduce((best, c) =>
      Math.abs(c - (packing as number)) < Math.abs(best - (packing as number)) ? c : best, 0)
    return availableRows()
      .filter((r) => Math.round(r.spec.params.deltaExp) === e && Math.abs(r.spec.params.packing - p) < 1e-9)
      .sort((a, b) => a.spec.params.nTubes - b.spec.params.nTubes)
      .map((r) => ({
        x: r.spec.params.nTubes,
        y: (r.result as { occupiedVolume: number }).occupiedVolume,
        series: 'precomputed（C++ 高规模）',
        runId: r.runId,
      }))
  },
)
