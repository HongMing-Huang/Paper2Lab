// #23 sweep-on-demand: the six-point sweep used to fire on every param
// change (6 worker computes, competing with the exact voxel cell). It is now
// gated by pSweepOn — off resolves to [] with zero compute; on produces the
// full SWEEP_NS series; off again clears it. Lazy cells mean the whole graph
// also parks when nothing observes it.
import { describe, expect, it } from 'vitest'
import { kakeya, sweepCell, pSweepOn, SWEEP_NS } from './kakeyaGraph'
import type { CurvePoint } from '../kakeya/metrics'

function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const check = () => {
      if (cond()) return resolve()
      if (Date.now() - t0 > timeoutMs) return reject(new Error('waitFor timeout'))
      setTimeout(check, 25)
    }
    check()
  })
}

describe('kakeya.sweep on-demand (#23)', () => {
  it('off → resolves to [] with no grid points; on → full SWEEP_NS series; off again → []', async () => {
    const unsub = kakeya.subscribe(sweepCell.id, () => {})
    const value = () => (kakeya.get<CurvePoint[]>(sweepCell.id).value ?? [])
    try {
      // default: OFF — the cell resolves immediately to an empty series
      await waitFor(() => kakeya.get(sweepCell.id).status === 'resolved')
      expect(value()).toEqual([])

      // ON — six REAL grid points (node fallback kernel, same as worker input)
      kakeya.setParam(pSweepOn.id, true)
      await waitFor(() => value().length === SWEEP_NS.length, 8000)
      const points = value()
      expect(points.map((p) => p.x)).toEqual(SWEEP_NS)
      // every point finite and carrying a real runId (Data → Experiment)
      for (const p of points) {
        expect(Number.isFinite(p.y)).toBe(true)
        expect(p.runId).toMatch(/^kakeya-sweep/)
      }

      // OFF again — back to [] without compute
      kakeya.setParam(pSweepOn.id, false)
      await waitFor(() => value().length === 0)
      expect(value()).toEqual([])
    } finally {
      unsub()
    }
  })
})
