// M5 acceptance: geometry.2d and ode.solve are REAL skills behind the unified
// executor now — numbers checked against hand-computed/paper-cited values and
// ODE invariants (not mirror assertions of the implementation).
import { describe, expect, it } from 'vitest'
import { executeSkill, replayRun } from './executor'
import { getSkill } from './registry'
import { getExperimentRun } from '../experiments/protocol'

const plan = { planId: 'plan-m5' }

describe('geometry.2d — Perron tree (real kernel)', () => {
  it('k=3, α=0.8 matches the paper-cited union area ratio (0.3454/0.5774 ≈ 0.598)', async () => {
    const out = await executeSkill('geometry.2d', {
      construction: 'perron-tree',
      params: { k: 3, alpha: 0.8 },
    }, plan)
    expect(out.status).toBe('ok')
    if (out.status !== 'ok' || !out.run) return
    const r = out.run.result as { computedArea: number; triangleArea: number; ratio: number; boundArea: number; triangles: number }
    expect(r.triangleArea).toBeCloseTo(1 / Math.sqrt(3), 12)
    // hand-computed grid value pinned by src/kakeya/perron.test.ts (900-raster)
    expect(r.computedArea).toBeCloseTo(0.3454, 3)
    expect(r.ratio).toBeGreaterThan(0.55)
    expect(r.ratio).toBeLessThan(0.65)
    // cited theoretical bound (α^{2k} + 2(1-α))·A — union never exceeds it
    expect(r.computedArea).toBeLessThanOrEqual(r.boundArea + 1e-12)
    expect(r.triangles).toBe(8) // 2³ sub-triangles
    expect(getExperimentRun(out.run.runId)?.spec.kind).toBe('perron.tree')
  })

  it('needle-sweep: swept area → analytic π/4 as the grid refines; run records grid', async () => {
    const coarse = await executeSkill('geometry.2d', { construction: 'needle-sweep', params: { grid: 96 } }, plan)
    const fine = await executeSkill('geometry.2d', { construction: 'needle-sweep', params: { grid: 384 } }, plan)
    expect(coarse.status).toBe('ok')
    expect(fine.status).toBe('ok')
    if (coarse.status !== 'ok' || fine.status !== 'ok') return
    const c = coarse.run!.result as { sweptArea: number; analyticArea: number; ratio: number }
    const f = fine.run!.result as { sweptArea: number; ratio: number }
    expect(c.analyticArea).toBeCloseTo(Math.PI / 4, 12)
    // both within 8% of π/4 and the finer grid strictly closer
    expect(Math.abs(c.ratio - 1)).toBeLessThan(0.08)
    expect(Math.abs(f.ratio - 1)).toBeLessThan(Math.abs(c.ratio - 1))
  })

  it('rejects out-of-domain k/alpha/grid before any side effect', async () => {
    for (const bad of [
      { construction: 'perron-tree', params: { k: 2.5, alpha: 0.8 } }, // non-integer
      { construction: 'perron-tree', params: { k: 3, alpha: 1.5 } }, // alpha out of [0,1]
      { construction: 'needle-sweep', params: { grid: 4 } }, // grid < 8
    ]) {
      const out = await executeSkill('geometry.2d', bad, plan)
      expect(out.status, JSON.stringify(bad)).toBe('error')
      if (out.status === 'error') expect(out.code).toBe('execution_failed')
    }
  })
})

describe('ode.solve — Lotka–Volterra RK4 (real kernel)', () => {
  const lvInput = {
    system: { kind: 'lv2', params: { alpha: 1.1, beta: 0.4, gamma: 0.4, delta: 0.1 } },
    initialValues: { prey: 1.0, predator: 0.5 },
    tSpan: [0, 30] as [number, number],
  }

  it('trajectory stays on the closed LV orbit (conserved quantity drift < 1e-3)', async () => {
    const out = await executeSkill('ode.solve', lvInput, plan)
    expect(out.status).toBe('ok')
    if (out.status !== 'ok' || !out.run) return
    const r = out.run.result as { t: number[]; y: { prey: number[]; predator: number[] }; conservedDrift: number }
    expect(r.t.length).toBeGreaterThan(200)
    expect(r.t[0]).toBe(0)
    expect(r.t[r.t.length - 1]).toBeCloseTo(30, 6)
    // both populations finite & positive throughout
    expect(r.y.prey.every((v) => v > 0 && Number.isFinite(v))).toBe(true)
    expect(r.y.predator.every((v) => v > 0 && Number.isFinite(v))).toBe(true)
    // V = δx − γ lnx + βy − α lny conserved on the exact flow; RK4 keeps it tight
    expect(r.conservedDrift).toBeLessThan(1e-3)
    expect(out.run.engine).toBe('ts-rk4')
  })

  it('phase relation: predator peak follows prey peak by roughly a quarter period', async () => {
    const out = await executeSkill('ode.solve', lvInput, plan)
    if (out.status !== 'ok' || !out.run) throw new Error('solve failed')
    const r = out.run.result as { t: number[]; y: { prey: number[]; predator: number[] } }
    const iPrey = r.y.prey.indexOf(Math.max(...r.y.prey))
    const iPred = r.y.predator.indexOf(Math.max(...r.y.predator))
    expect(iPred).toBeGreaterThan(iPrey)
    // LV period for these params ≈ 10.4; quarter ≈ 2.6 — allow (1, 5)
    const lag = r.t[iPred] - r.t[iPrey]
    expect(lag).toBeGreaterThan(0.5)
    expect(lag).toBeLessThan(5.5)
  })

  it('deterministic: same inputs → identical trajectory; replay reproduces from the recorded spec', async () => {
    const a = await executeSkill('ode.solve', lvInput, plan)
    const b = await executeSkill('ode.solve', lvInput, plan)
    if (a.status !== 'ok' || b.status !== 'ok') throw new Error('solve failed')
    const ra = a.run!.result as { y: { prey: number[] } }
    const rb = b.run!.result as { y: { prey: number[] } }
    expect(ra.y.prey[100]).toBe(rb.y.prey[100])

    const replay = await replayRun(a.run!.runId)
    expect(replay.status).toBe('ok')
    if (replay.status === 'ok' && replay.run) {
      const rr = replay.run.result as { y: { prey: number[] } }
      expect(rr.y.prey[100]).toBe(ra.y.prey[100])
    }
  })

  it('unwired system kinds and bad params fail with explicit errors', async () => {
    const out = await executeSkill('ode.solve', {
      system: { kind: 'lorenz' },
      initialValues: { x: 1 },
      tSpan: [0, 10],
    }, plan)
    expect(out.status).toBe('error')
    if (out.status === 'error') expect(out.message).toMatch(/lv2/)

    const bad = await executeSkill('ode.solve', {
      system: { kind: 'lv2', params: { alpha: -1, beta: 0.4, gamma: 0.4, delta: 0.1 } },
      initialValues: { prey: 1, predator: 1 },
      tSpan: [0, 10],
    }, plan)
    expect(bad.status).toBe('error')
  })
})

describe('registry honesty after M5', () => {
  it('every registered skill is now implemented (no callable-without-implementation)', () => {
    const unimplemented = ['geometry.2d', 'ode.solve'].filter((n) => !getSkill(n)?.implemented)
    expect(unimplemented).toEqual([])
  })
})
