// v0.3 agent foundation: step-runner (four desks, everything through the
// registered executor) + canonical-skill aliases resolve to real runs.
import { describe, expect, it } from 'vitest'
import '../physics/registerMujocoRunner'
import { runAgentSteps } from './agentSteps'
import { executeSkill } from './executor'
import { SKILL_REGISTRY } from './registry'
import { buildPlan } from './playPlan'

const planFor = (skill: string) => buildPlan({ skill, goal: `agentsteps test: ${skill}` })
const planIds = {
  formula: buildPlan({ skill: 'formula.plot', goal: 'agentsteps test: formula' }).planId,
  kakeya: buildPlan({ skill: 'kakeya.measure', goal: 'agentsteps test: kakeya' }).planId,
  ode: buildPlan({ skill: 'ode.solve', goal: 'agentsteps test: ode' }).planId,
  geometry: buildPlan({ skill: 'geometry.2d', goal: 'agentsteps test: geometry' }).planId,
  mujoco: buildPlan({ skill: 'mujoco.simulate', goal: 'agentsteps test: mujoco' }).planId,
  model: buildPlan({ skill: 'model.solve', goal: 'agentsteps test: model' }).planId,
}

describe('agentSteps: every desk completes through the registry', () => {
  it('formula desk: fork + scale ×2 + plot + compare (numbers land in runs)', async () => {
    const out = await runAgentSteps('formula', [
      { op: 'experiment.fork' },
      { op: 'formula.scale', param: 'a', value: 2 },
      { op: 'formula.plot' },
      { op: 'experiment.compare' },
    ], {
      expression: ['Multiply', 'a', ['Sin', 'x']],
      parameters: ['a', 'x'],
      values: { a: 1, x: 0 },
      independent: 'x',
      range: [-7, 7],
      samples: 161,
    }, planIds.formula)
    expect(out.status).toBe('ok')
    expect(out.runs.length).toBe(1)
    expect(out.runs[0].metrics.peak).toBeCloseTo(2, 3) // a=2 ⇒ peak = |a|
    const cmp = out.comparison as { runA: string; runB: string; rows: Array<{ delta: number }> }
    expect(cmp.runA).not.toBe(cmp.runB)
    expect(cmp.rows.some((r) => r.delta !== 0)).toBe(true)
  })

  it('kakeya desk: halve-n + measure + compare', async () => {
    const out = await runAgentSteps('kakeya', [
      { op: 'experiment.fork' },
      { op: 'kakeya.halve-n' },
      { op: 'kakeya.measure' },
      { op: 'experiment.compare' },
    ], { deltaExp: 4, packing: 0, res: 24, nTubes: 32 }, planIds.kakeya)
    expect(out.status).toBe('ok')
    expect(out.runs[0].runId).toMatch(/^kakeya-voxel-/)
    expect(out.runs[0].metrics.occupiedVolume).toBeGreaterThan(0)
    expect(out.runs[0].metrics.occupiedVolume).toBeLessThan(1)
  })

  it('ode desk: alpha ×2 + solve + compare (LV conservation on the fork)', async () => {
    const out = await runAgentSteps('ode', [
      { op: 'experiment.fork' },
      { op: 'ode.scale', param: 'alpha', value: 2 },
      { op: 'ode.solve' },
      { op: 'experiment.compare' },
    ], {
      system: { kind: 'lv2', params: { alpha: 1.1, beta: 0.4, gamma: 0.4, delta: 0.1 } },
      initialValues: { prey: 1, predator: 0.5 },
      tSpan: [0, 5],
    }, planIds.ode)
    expect(out.status).toBe('ok')
    expect(out.runs[0].runId).toMatch(/^lv-ode-/)
    expect(out.runs[0].metrics.conservedDrift).toBeLessThan(1e-3)
    expect(out.runs[0].metrics.finalPrey).toBeGreaterThan(0)
  })

  it('model desk (#51 P0-C): mu ×2 + solve + compare — paper initials untouched, conservation holds', async () => {
    // the MM paper's own base: 4 states, greek rates, paper-stated initials
    const base = {
      states: ['S', 'C', 'E', 'P'],
      rhs: { S: '-\\kappa S E + \\lambda C', C: '\\kappa S E - \\lambda C - \\mu C', E: '-\\kappa S E + \\lambda C + \\mu C', P: '\\mu C' },
      params: { kappa: 1, lambda: 0.2, mu: 0.4 },
      initialState: { S: 1, C: 0, E: 0.1, P: 0 },
      tSpan: [0, 30],
    }
    const out = await runAgentSteps('model', [
      { op: 'experiment.fork' },
      { op: 'model.scale', param: 'mu', value: 2 }, // catalytic rate doubled
      { op: 'model.solve' },
      { op: 'experiment.compare' },
    ], base, planIds.model)
    expect(out.status).toBe('ok')
    expect(out.runs[0].runId).toMatch(/^model-solved-/)
    // per-state finals present for all 4 states
    for (const s of ['S', 'C', 'E', 'P']) {
      expect(Number.isFinite(out.runs[0].metrics[`final_${s}`])).toBe(true)
    }
    // μ×2 ⇒ faster reaction ⇒ less substrate remaining at t=30
    expect(out.runs[0].metrics.final_S!).toBeLessThan(0.7)
    expect(out.comparison).toBeTruthy()
  })

  it('model desk: setting an INITIAL state is rejected (paper evidence is frozen)', async () => {
    const base = {
      states: ['S', 'I', 'R'],
      rhs: { S: '-\\beta S I', I: '\\beta S I - \\gamma I', R: '\\gamma I' },
      params: { beta: 0.4, gamma: 0.1 },
      initialState: { S: 0.99, I: 0.01, R: 0 },
      tSpan: [0, 20],
    }
    const out = await runAgentSteps('model', [
      { op: 'model.set', param: 'S', value: 0.5 }, // S is a STATE, not a param
      { op: 'model.solve' },
    ], base, planIds.model)
    expect(out.status).toBe('error')
    expect(out.message).toContain('S')
  })

  it('geometry desk: set alpha + plot + compare', async () => {
    const out = await runAgentSteps('geometry', [
      { op: 'experiment.fork' },
      { op: 'geometry.set', param: 'alpha', value: 0.9 },
      { op: 'geometry.plot' },
      { op: 'experiment.compare' },
    ], { construction: 'perron-tree', params: { k: 2, alpha: 0.7 } }, planIds.geometry)
    expect(out.status).toBe('ok')
    expect(out.runs[0].runId).toMatch(/^perron-tree-/)
    expect(out.runs[0].metrics.computedArea).toBeGreaterThan(0)
  })

  it('mujoco desk: gravity scale ×2 (downward) + simulate + compare — real physics', async () => {
    const out = await runAgentSteps('mujoco', [
      { op: 'experiment.fork' },
      { op: 'mujoco.scale', param: 'gravityZ', value: -2 },
      { op: 'mujoco.simulate' },
      { op: 'experiment.compare' },
    ], { scene: 'simple.xml', steps: 200, sampleEvery: 100, params: { gravityZ: -9.81 } }, planIds.mujoco)
    expect(out.status).toBe('ok')
    expect(out.runs[0].runId).toMatch(/^mujoco-sim-/)
    expect(out.runs[0].metrics.finalTime).toBeGreaterThan(0)
    expect(out.runs[0].metrics.qposNormFinal).toBeGreaterThan(0)
    const cmp = out.comparison as { runA: string; runB: string }
    expect(cmp.runA).not.toBe(cmp.runB)
  })

  it('unknown ops and missing params are explicit errors, never silent no-ops', async () => {
    const bad = await runAgentSteps('formula', [{ op: 'backdoor.exec' }], {
      expression: ['Sin', 'x'], parameters: ['x'], values: { x: 1 }, independent: 'x', range: [0, 1], samples: 16,
    }, planIds.formula)
    expect(bad.status).toBe('error')
    expect(bad.message).toMatch(/unknown step op/)
    const noParam = await runAgentSteps('formula', [{ op: 'formula.set', value: 2 }], {
      expression: ['Sin', 'x'], parameters: ['x'], values: { x: 1 }, independent: 'x', range: [0, 1], samples: 16,
    }, planIds.formula)
    expect(noParam.status).toBe('error')
  })
})

describe('canonical skill aliases (AGENTS §4) execute for real', () => {
  it('every alias resolves and every registry skill is implemented', () => {
    const aliases = SKILL_REGISTRY.flatMap((s) => s.aliases ?? [])
    expect(aliases.length).toBeGreaterThanOrEqual(6)
    for (const s of SKILL_REGISTRY) {
      if (s.implemented) continue
      throw new Error(`unimplemented skill in registry: ${s.name}`)
    }
  })

  it('measure_volume / simulate_geometry / run_scale_sweep / fork_experiment / compare_experiments all run', async () => {
    const gen = await executeSkill('simulate_geometry', { deltaExp: 4, packing: 0, nTubes: 16 }, planFor('simulate_geometry'))
    expect(gen.status).toBe('ok')
    if (gen.status !== 'ok' || !gen.run) return
    expect(gen.run.spec.kind).toBe('kakeya.geometry')

    const measure = await executeSkill('measure_volume', { deltaExp: 4, packing: 0, res: 20, nTubes: 16 }, planFor('measure_volume'))
    expect(measure.status).toBe('ok')
    if (measure.status !== 'ok' || !measure.run) return

    const fork = await executeSkill('fork_experiment', { sourceRunId: measure.run.runId, parameterChanges: { packing: 1 } }, planFor('fork_experiment'))
    expect(fork.status).toBe('ok')
    if (fork.status !== 'ok' || !fork.run) return
    expect(fork.run.spec.kind).toBe('kakeya.voxel')

    const sweep = await executeSkill('run_scale_sweep', { param: 'nTubes', values: [8, 16], nTubes: 16, deltaExp: 4, packing: 0, res: 18 }, planFor('run_scale_sweep'))
    expect(sweep.status).toBe('ok')

    const cmp = await executeSkill('compare_experiments', { runA: measure.run.runId, runB: fork.run.runId })
    expect(cmp.status).toBe('ok')
    const payload = (cmp as { payload?: { runA: string; runB: string } }).payload!
    expect(payload.runA).not.toBe(payload.runB)
  })

  it('aliases face the same PlayPlan gate as their registry names', async () => {
    const out = await executeSkill('measure_volume', { deltaExp: 4, packing: 0, res: 20, nTubes: 16 })
    expect(out.status).toBe('needs_input')
  })
})
