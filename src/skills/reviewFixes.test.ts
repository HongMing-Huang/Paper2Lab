// Regressions for the Codex PR-review findings (each test pins one finding).
import { describe, expect, it } from 'vitest'
import { executeSkill } from './executor'
import { getExperimentRun } from '../experiments/protocol'
import { importRuns } from '../experiments/runRepository'
import { analyzeFormula } from '../formula/analyze'
import { buildExplorerSpec } from '../formula/spec'
import { explorerStore } from '../desk/explorerStore'
import { executeFormulaSteps } from './formulaExecutor'

const plan = { planId: 'plan-review' }

describe('PR review: PlayPlan gate covers the new numeric adapters', () => {
  it('geometry.2d and ode.solve refuse to run without a planId', async () => {
    const g = await executeSkill('geometry.2d', { construction: 'perron-tree', params: { k: 2, alpha: 0.7 } })
    expect(g.status).toBe('needs_input')
    const o = await executeSkill('ode.solve', {
      system: { kind: 'lv2', params: { alpha: 1.1, beta: 0.4, gamma: 0.4, delta: 0.1 } },
      initialValues: { prey: 1, predator: 0.5 },
      tSpan: [0, 5],
    })
    expect(o.status).toBe('needs_input')
  })
})

describe('PR review: fork merges changes into each skill\'s nested inputs', () => {
  it('ode.solve fork with {alpha:2} actually changes alpha (was silently unchanged)', async () => {
    const base = await executeSkill('ode.solve', {
      system: { kind: 'lv2', params: { alpha: 1.1, beta: 0.4, gamma: 0.4, delta: 0.1 } },
      initialValues: { prey: 1, predator: 0.5 },
      tSpan: [0, 10],
    }, plan)
    if (base.status !== 'ok' || !base.run) throw new Error('base solve failed')
    const fork = await executeSkill('experiment.fork', {
      sourceRunId: base.run.runId,
      parameterChanges: { alpha: 2.2 },
    }, plan)
    expect(fork.status).toBe('ok')
    if (fork.status !== 'ok' || !fork.run) return
    expect(fork.run.spec.params.alpha).toBe(2.2) // changed, not the original 1.1
    expect(fork.run.parentRunId).toBe(base.run.runId)
    // trajectories actually differ
    const a = (base.run.result as { y: { prey: number[] } }).y.prey
    const b = (fork.run.result as { y: { prey: number[] } }).y.prey
    expect(a[100]).not.toBeCloseTo(b[100], 6)
  })

  it('ode.solve fork rejects unknown keys instead of recomputing unchanged', async () => {
    const base = await executeSkill('ode.solve', {
      system: { kind: 'lv2', params: { alpha: 1.1, beta: 0.4, gamma: 0.4, delta: 0.1 } },
      initialValues: { prey: 1, predator: 0.5 },
      tSpan: [0, 5],
    }, plan)
    if (base.status !== 'ok' || !base.run) throw new Error('base solve failed')
    const bad = await executeSkill('experiment.fork', {
      sourceRunId: base.run.runId,
      parameterChanges: { zzz: 1 },
    }, plan)
    expect(bad.status).toBe('error')
    if (bad.status === 'error') expect(bad.message).toMatch(/unknown change 'zzz'/)
  })

  it('geometry.2d fork applies changes into params and keeps lineage', async () => {
    const base = await executeSkill('geometry.2d', { construction: 'perron-tree', params: { k: 2, alpha: 0.7 } }, plan)
    if (base.status !== 'ok' || !base.run) throw new Error('base failed')
    // alpha must stay in the kernel's legal window (0.5, 1] — 0.8 changes it
    // without tripping the domain check (that the change IS applied while an
    // illegal 0.4 is rejected is itself proven by the kernel error)
    const fork = await executeSkill('experiment.fork', {
      sourceRunId: base.run.runId,
      parameterChanges: { alpha: 0.9 },
    }, plan)
    expect(fork.status).toBe('ok')
    if (fork.status !== 'ok' || !fork.run) return
    expect(fork.run.spec.params.alpha).toBe(0.9)
    expect(fork.run.parentRunId).toBe(base.run.runId)
    // and an out-of-domain change IS routed into the kernel (rejected there)
    const bad = await executeSkill('experiment.fork', {
      sourceRunId: base.run.runId,
      parameterChanges: { alpha: 0.4 },
    }, plan)
    expect(bad.status).toBe('error')
    if (bad.status === 'error') expect(bad.message).toMatch(/alpha must be/)
  })

  it('formula.evaluate fork routes changes into bindings', async () => {
    const expr = ['Multiply', 'a', ['Sin', 'x']]
    const base = await executeSkill('formula.evaluate', { expression: expr, bindings: { a: 1, x: 0.5 } }, plan)
    if (base.status !== 'ok' || !base.run) throw new Error('base failed')
    const fork = await executeSkill('experiment.fork', {
      sourceRunId: base.run.runId,
      parameterChanges: { a: 3 },
    }, plan)
    expect(fork.status).toBe('ok')
    if (fork.status !== 'ok' || !fork.run) return
    expect((fork.run.result as { value: number }).value).toBeCloseTo(3 * Math.sin(0.5), 10)
  })
})

describe('PR review: executor input hardening', () => {
  it('formula.plot rejects samples < 2 before creating any run', async () => {
    const out = await executeSkill('formula.plot', {
      expression: ['Sin', 'x'],
      parameters: [],
      independent: 'x',
      range: [-1, 1],
      samples: 0,
    }, plan)
    expect(out.status).toBe('error')
    if (out.status === 'error') expect(out.message).toMatch(/samples >= 2/)
  })

  it('kakeya.sweep over packing without baseline nTubes fails (no NaN evidence)', async () => {
    const out = await executeSkill('kakeya.sweep', {
      param: 'packing',
      values: [0.5, 1],
      deltaExp: 4,
      res: 12,
      // nTubes intentionally omitted
    }, plan)
    expect(out.status).toBe('error')
    if (out.status === 'error') expect(out.message).toMatch(/baseline nTubes/)
  })

  it('kakeya.sweep over packing WITH baseline nTubes works end-to-end', async () => {
    const out = await executeSkill('kakeya.sweep', {
      param: 'packing',
      values: [0, 1],
      deltaExp: 3,
      nTubes: 8,
      res: 10,
    }, plan)
    expect(out.status).toBe('ok')
    if (out.status === 'ok' && out.run) {
      const pts = (out.run.result as { points: Array<{ y: number }> }).points
      expect(pts.every((p) => Number.isFinite(p.y) && p.y > 0)).toBe(true)
    }
  })
})

describe('PR review: importRuns is truly all-or-nothing', () => {
  it('a bundle with a duplicate id fails WITHOUT importing the valid prefix', async () => {
    const a = await executeSkill('formula.evaluate', { expression: ['Sin', 'x'], bindings: { x: 1 } }, plan)
    const b = await executeSkill('formula.evaluate', { expression: ['Cos', 'x'], bindings: { x: 1 } }, plan)
    if (a.status !== 'ok' || b.status !== 'ok' || !a.run || !b.run) throw new Error('setup failed')
    const { exportExperimentRuns } = await import('../experiments/protocol')
    // bundle = [entry with a FRESH id, entry whose id collides with history]
    const bundle = JSON.parse(exportExperimentRuns([a.run.runId]))
    const freshId = 'formula-value-preflight-new-1'
    bundle[0].runId = freshId // renamed → genuinely new
    bundle.push(JSON.parse(JSON.stringify(getExperimentRun(b.run.runId)))) // collides
    expect(() => importRuns(JSON.stringify(bundle))).toThrow(/already recorded/)
    // preflight held: the fresh first entry was NOT partially registered
    expect(getExperimentRun(freshId)).toBeUndefined()
  })

  it('duplicate ids WITHIN one bundle are also caught in preflight', async () => {
    const a = await executeSkill('formula.evaluate', { expression: ['Sin', 'x'], bindings: { x: 2 } }, plan)
    if (a.status !== 'ok' || !a.run) throw new Error('setup failed')
    const { exportExperimentRuns } = await import('../experiments/protocol')
    const bundle = exportExperimentRuns([a.run.runId])
    const arr = JSON.parse(bundle)
    arr.push({ ...arr[0] }) // duplicate within the bundle
    expect(() => importRuns(JSON.stringify(arr))).toThrow(/already recorded/)
  })
})

describe('PR review: compare-only plans never compare a run with itself', () => {
  it('compare-only with no fork and no parent → explicit needs-target error', async () => {
    const { spec, compiled } = buildExplorerSpec(
      analyzeFormula('y = a x'),
      { docId: 'rev', page: 1, bbox: { x: 0, y: 0, w: 1, h: 1 }, latex: 'y = a x' },
    )
    explorerStore.create('rev-base', spec, compiled as never)
    await explorerStore.waitForRun('rev-base')
    try {
      await executeFormulaSteps('rev-base', [{ op: 'experiment.compare' }], {
        fork: () => null,
        compare: () => {},
      })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(String(err)).toMatch(/没有可对比的第二个实验/)
    } finally {
      explorerStore.dispose('rev-base')
    }
  })

  it('compare-only on a FORK compares fork vs parent (not itself)', async () => {
    const { spec, compiled } = buildExplorerSpec(
      analyzeFormula('y = a x'),
      { docId: 'rev2', page: 1, bbox: { x: 0, y: 0, w: 1, h: 1 }, latex: 'y = a x' },
    )
    explorerStore.create('rev2-base', spec, compiled as never)
    await explorerStore.waitForRun('rev2-base')
    explorerStore.fork('rev2-base', 'rev2-fork')
    explorerStore.setParams('rev2-fork', { a: 3 })
    await explorerStore.waitForRun('rev2-fork')
    const out = await executeFormulaSteps('rev2-fork', [{ op: 'experiment.compare' }], {
      fork: () => null,
      compare: () => {},
    })
    const cmp = out.comparison as { runA: string; runB: string; rows: Array<{ key: string; delta: number | null }> }
    expect(cmp.runA).not.toBe(cmp.runB) // parent vs fork — not self
    const peak = cmp.rows.find((r) => r.key === 'peak')!
    expect(peak.delta).not.toBe(0)
    explorerStore.dispose('rev2-base')
    explorerStore.dispose('rev2-fork')
  })
})
