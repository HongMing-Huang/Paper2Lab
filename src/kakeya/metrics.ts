// Small helpers turning kernel outputs into chart-ready rows.
import type { VoxelMetrics } from './voxels3d'

export interface HistRow {
  multiplicity: number
  count: number
}

export function histogramRows(result: VoxelMetrics, maxM?: number): HistRow[] {
  const cap = Math.min(maxM ?? result.maxMultiplicity, result.histogram.length - 1)
  const rows: HistRow[] = []
  for (let m = 1; m <= cap; m++) rows.push({ multiplicity: m, count: result.histogram[m] ?? 0 })
  return rows
}

/** overlap efficiency: |⋃T| / Σ|T| — 1 means no overlap at all. */
export function unionEfficiency(result: VoxelMetrics): number {
  return result.sumTubeVolume > 0 ? Math.min(1, result.occupiedVolume / result.sumTubeVolume) : 0
}

export const fmt = (v: number, digits = 4) => v.toFixed(digits)
export const fmtPct = (v: number, digits = 1) => `${(100 * v).toFixed(digits)}%`

/** a point on the |⋃T| sweep curve (live, precomputed, or fork series) */
export interface CurvePoint {
  x: number
  y: number
  series: string
  /** which experiment run produced this point (Data → Experiment navigation) */
  runId?: string
}
