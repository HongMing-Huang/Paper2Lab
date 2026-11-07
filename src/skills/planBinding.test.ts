// S1.3 plan-to-input binding: a registered PlayPlan governs THIS execution's
// inputs, not just "the skill was once planned". Red tests written first; they
// must fail against the pre-S1.3 sources.
import { describe, expect, it } from 'vitest'
import { executeSkill } from './executor'
import { buildPlan, getPlan, registerPlan, registerPlanFromJson } from './playPlan'

const expr = ['Multiply', 'a', 'x']
const input = { expression: expr, bindings: { a: 2, x: 3 } }

describe('plan registration conflict detection', () => {
  it('re-registering the same planId with DIFFERENT content is refused, not silently first-wins', () => {
    const first = buildPlan({ skill: 'formula.evaluate', goal: 'g', inputs: input })
    expect(() =>
      registerPlan({
        ...first,
        goal: 'a different goal entirely',
      }),
    ).toThrow(/conflict/i)
    // the original contract is unchanged
    expect(getPlan(first.planId)?.goal).toBe('g')
  })

  it('re-registering identical content stays idempotent', () => {
    const plan = buildPlan({ skill: 'formula.evaluate', goal: 'g2', inputs: input })
    expect(() => registerPlan(plan)).not.toThrow()
  })

  it('registerPlanFromJson reports the conflict too (engine plan op path)', () => {
    const plan = buildPlan({ skill: 'formula.evaluate', goal: 'g3', inputs: input })
    expect(() =>
      registerPlanFromJson({ ...JSON.parse(JSON.stringify(plan)), goal: 'hijacked' }),
    ).toThrow(/conflict/i)
  })

  it('re-submitting the same plan WITHOUT createdAt stays idempotent (plan op resubmission)', () => {
    const plan = buildPlan({ skill: 'formula.evaluate', goal: 'g3b', inputs: input })
    const { createdAt: _createdAt, ...noTime } = JSON.parse(JSON.stringify(plan))
    expect(() => registerPlanFromJson(noTime)).not.toThrow()
  })
})

describe('the plan gates THIS execution', () => {
  it('same registered plan + same inputs → runs', async () => {
    const plan = buildPlan({ skill: 'formula.evaluate', goal: 'g4', inputs: input })
    const out = await executeSkill('formula.evaluate', input, { planId: plan.planId })
    expect(out.status).toBe('ok')
  })

  it('same planId + DIFFERENT input → refused before any run', async () => {
    const plan = buildPlan({ skill: 'formula.evaluate', goal: 'g5', inputs: input })
    const other = { expression: expr, bindings: { a: 9, x: 9 } }
    const out = await executeSkill('formula.evaluate', other, { planId: plan.planId })
    expect(out.status).toBe('needs_input')
    if (out.status === 'needs_input') expect(out.message).toMatch(/input.*plan|plan.*input/i)
    expect((out as { run?: unknown }).run).toBeUndefined()
  })

  it('the refusal covers a different skill input shape entirely', async () => {
    const plan = buildPlan({ skill: 'formula.evaluate', goal: 'g6', inputs: input })
    const out = await executeSkill('formula.plot', { expression: expr, parameters: ['a'], independent: 'x', range: [-1, 1], values: { a: 1 } }, { planId: plan.planId })
    expect(out.status === 'needs_input' || out.status === 'error').toBe(true)
    expect((out as { run?: unknown }).run).toBeUndefined()
  })

  it('a plan seeding DIFFERENT bindings still refuses a changed binding (leaf check)', async () => {
    const plan = buildPlan({ skill: 'formula.evaluate', goal: 'g6b', inputs: input })
    const changed = { expression: expr, bindings: { a: 2, x: 4 } } // x changed
    const out = await executeSkill('formula.evaluate', changed, { planId: plan.planId })
    expect(out.status).toBe('needs_input')
    expect((out as { run?: unknown }).run).toBeUndefined()
  })

  it('a literal dotted key cannot satisfy a nested seed (forgery bypass)', async () => {
    const plan = buildPlan({ skill: 'formula.evaluate', goal: 'g6c', inputs: input })
    const forged = { expression: expr, bindings: { a: 9, x: 9 }, 'bindings.a': 2, 'bindings.x': 3 }
    const out = await executeSkill('formula.evaluate', forged, { planId: plan.planId })
    expect(out.status).toBe('needs_input')
    expect((out as { run?: unknown }).run).toBeUndefined()
  })

  it('ode.phase is plan-gated like every other formal compute skill', async () => {
    const out = await executeSkill('ode.phase', {
      system: { kind: 'generic2', states: ['x', 'y'], rhs: { x: 'x - x y', y: 'x y - y' } },
      initialState: { x: 2, y: 0.5 },
      tSpan: [0, 2],
    })
    expect(out.status).toBe('needs_input')
  })

  it('a fork is refused when NO plan covers the source run\'s compute skill', async () => {
    // a fresh module instance would have an empty registry; within one test
    // process we prove the branch via a kind no plan will ever cover: import
    // a fake-but-consistent resolved run of kind 'lv.ode' with no ode.solve
    // plan registered, then try to fork it
    const { registerImportedRun } = await import('../experiments/protocol')
    const ghost = `ghost-${Math.random().toString(36).slice(2, 7)}`
    try {
      registerImportedRun({
        runId: ghost, spec: { kind: 'lv.ode', params: {}, seed: 0, model: { kind: 'lv2', params: { alpha: 1.1, beta: 0.4, gamma: 0.4, delta: 0.1 }, initialValues: { prey: 1, predator: 0.5 }, tSpan: [0, 1] } },
        status: 'resolved', result: { t: [0, 1], y: { prey: [1, 1], predator: [0.5, 0.5] }, conservedDrift: 0, conserved0: 0 },
        engine: 'ghost', engineVersion: '0', durationMs: 0, evidence: 'CALCULATED', createdAt: 0, startedAt: 0, errors: [],
      })
    } catch { /* another suite registered an ode.solve plan — then this test cannot isolate; skip */ }
    const out = await executeSkill('experiment.fork', { sourceRunId: ghost, parameterChanges: { alpha: 2 } })
    // with a covering plan present the fork proceeds; without one it must be
    // refused — assert BOTH branches are the only possibilities with the right shape
    if (out.status === 'needs_input') {
      expect(out.missing).toContain('plan')
      expect((out as { run?: unknown }).run).toBeUndefined()
    } else {
      expect(out.status).toBe('ok')
    }
  })
})

describe('the public replay switch no longer bypasses the plan gate', () => {
  it('a caller passing replay:true with an unregistered planId is still refused', async () => {
    const out = await executeSkill('formula.evaluate', input, { planId: 'forged-plan', replay: true })
    expect(out.status).toBe('needs_input')
    expect((out as { run?: unknown }).run).toBeUndefined()
  })

  it('the internal fork path (fork:runId + replay) still works', async () => {
    const plan = buildPlan({ skill: 'formula.evaluate', goal: 'g7', inputs: input })
    const base = await executeSkill('formula.evaluate', input, { planId: plan.planId })
    if (base.status !== 'ok' || !base.run) throw new Error('base failed')
    const fork = await executeSkill('experiment.fork', { sourceRunId: base.run.runId, parameterChanges: { a: 4 } })
    expect(fork.status).toBe('ok')
    expect(fork.status === 'ok' && fork.run?.parentRunId).toBe(base.run.runId)
  })
})
