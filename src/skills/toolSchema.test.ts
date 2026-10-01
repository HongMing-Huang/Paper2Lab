import { describe, expect, it } from 'vitest'
import { validatePlan, planSmugglesNumbers, EXPERIMENT_PLAN_JSON_SCHEMA, AGENT_SKILL_WHITELIST } from './toolSchema'
import { planExperiment } from './planner'
import './index'

const cur = { nTubes: 96, deltaExp: 4, packing: 0 }

describe('Agent Tool Schema', () => {
  it('whitelist covers the canonical 11 plus the primitive trio', () => {
    for (const id of ['inspect_source', 'change_parameter', 'fork_experiment', 'simulate_geometry', 'measure_volume', 'measure_multiplicity', 'run_scale_sweep', 'compare_experiments', 'explain_result', 'trace_evidence', 'open_proof']) {
      expect(AGENT_SKILL_WHITELIST).toContain(id)
    }
    expect(EXPERIMENT_PLAN_JSON_SCHEMA.properties.actions.items.properties.skill.enum.length).toBeGreaterThan(10)
  })

  it('accepts a well-formed plan', () => {
    const r = validatePlan({ title: 't', actions: [{ skill: 'change_parameter', args: { param: 'kakeya.packing', value: 1 }, label: 'x' }] })
    expect(r.ok).toBe(true)
  })

  it('rejects non-whitelisted skills, empty actions, malformed entries', () => {
    expect(validatePlan({ title: 't', actions: [{ skill: 'hack_the_numbers', args: {}, label: 'x' }] }).ok).toBe(false)
    expect(validatePlan({ title: 't', actions: [] }).ok).toBe(false)
    expect(validatePlan({ title: '', actions: [{ skill: 'open_proof', args: {}, label: 'x' }] }).ok).toBe(false)
    expect(validatePlan(null).ok).toBe(false)
  })

  it('every deterministic planner output validates against the schema', () => {
    for (const q of ['如果方向数减少一半呢？', 'sticky', '证明', 'perron', '随便', '方向加倍', 'δ 减半']) {
      const plan = planExperiment(q, cur)!
      const r = validatePlan(plan as unknown as Record<string, unknown>)
      expect(r.ok).toBe(true)
    }
  })

  it('explain_result may not carry numeric args (no smuggled CALCULATED values)', () => {
    expect(planSmugglesNumbers({ title: 't', actions: [{ skill: 'explain_result', args: { fake: 0.42 }, label: 'x' }] })).toBe(true)
    expect(planSmugglesNumbers({ title: 't', actions: [{ skill: 'explain_result', args: {}, label: 'x' }] })).toBe(false)
    // and real planner explain actions never smuggle:
    const plan = planExperiment('方向减半', cur)!
    expect(planSmugglesNumbers(plan as unknown as { title: string; actions: Array<{ skill: 'explain_result'; args: Record<string, number | string>; label: string }> })).toBe(false)
  })
})
