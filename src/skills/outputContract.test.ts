// S1.2 output contract, against real kernels: every compute skill's actual
// output satisfies its registered schema and produces the registered run kind,
// nullable metrics are declared as nullable, and output that breaks the contract
// becomes an error run with no result, so it can never reach a chart or a Goal.
import { describe, expect, it } from 'vitest'
import '../physics/registerMujocoRunner'
import '../challenges/registerChallengeRunner'
import { executeSkill, registerSkillRunner } from './executor'
import { getSkill, schemaError } from './registry'
import { buildPlan } from './playPlan'
import { executeSpec, getExperimentRun, type ExperimentRun } from '../experiments/protocol'

const planId = (skill: string) => buildPlan({ skill, goal: `output contract: ${skill}` }).planId
const lv = { kind: 'lv2', params: { alpha: 1.1, beta: 0.4, gamma: 0.4, delta: 0.1 } }
const decay = { states: ['u'], rhs: { u: '-k u' }, params: { k: 2 }, initialState: { u: 1 } }
const orbit = { system: { kind: 'generic2', states: ['x', 'y'], rhs: { x: 'x - x y', y: 'x y - y' } }, initialState: { x: 2, y: 0.5 } }

const CASES: Array<[string, string, Record<string, unknown>]> = [
  ['scalar', 'formula.evaluate', { expression: ['Multiply', 'a', 'x'], bindings: { a: 2, x: 3 } }],
  ['curve', 'formula.plot', { expression: ['Multiply', 'a', 'x'], parameters: ['a'], independent: 'x', range: [-1, 1], values: { a: 2 }, samples: 21 }],
  ['tubes', 'kakeya.generate', { deltaExp: 4, packing: 0.3, nTubes: 24 }],
  ['voxels', 'kakeya.measure', { deltaExp: 4, packing: 0.5, res: 18, nTubes: 16 }],
  ['sweep', 'kakeya.sweep', { param: 'nTubes', values: [8, 16], deltaExp: 4, packing: 0, res: 14 }],
  ['perron tree', 'geometry.2d', { construction: 'perron-tree', params: { k: 3, alpha: 0.8 } }],
  ['needle sweep', 'geometry.2d', { construction: 'needle-sweep', params: { grid: 32 } }],
  ['lv ode', 'ode.solve', { system: lv, initialValues: { prey: 1, predator: 0.5 }, tSpan: [0, 4] }],
  ['phase ode', 'ode.phase', { ...orbit, tSpan: [0, 20] }],
  ['model build', 'model.build', decay],
  ['model solve', 'model.solve', { ...decay, tSpan: [0, 1], steps: 200 }],
  ['mujoco', 'mujoco.simulate', { scene: 'simple.xml', steps: 60, sampleEvery: 30 }],
  ['projectile', 'challenge.attempt', { challenge: 'projectile', changes: { angleDeg: 45, speed: 10 } }],
  ['pendulum', 'challenge.attempt', { challenge: 'pendulum', changes: { length: 1, angleDeg: 20 } }],
  ['tubes challenge', 'challenge.attempt', { challenge: 'tubes', changes: {} }],
]

describe('registered output contract vs real kernels', () => {
  it.each(CASES)('%s: real output satisfies the schema and the declared run kind', async (_label, skill, input) => {
    const out = await executeSkill(skill, input, { planId: planId(skill) })
    expect(out.status, out.status === 'error' ? out.message : '').toBe('ok')
    if (out.status !== 'ok' || !out.run) throw new Error('no run')
    const declared = getSkill(skill)!
    expect(out.run.spec.kind).toBe(declared.runKind)
    expect(schemaError(declared.outputSchema, out.run.result, skill)).toBeNull()
  }, 120_000)

  it('period0 is declared nullable where a decaying signal really yields null', async () => {
    const solve = await executeSkill('model.solve', { ...decay, tSpan: [0, 1], steps: 200 }, { planId: planId('model.solve') })
    const phase = await executeSkill('ode.phase', { system: { kind: 'generic2', states: ['x', 'y'], rhs: { x: '-x', y: '-y' } }, initialState: { x: 1, y: 1 }, tSpan: [0, 1] }, { planId: planId('ode.phase') })
    for (const [skill, out] of [['model.solve', solve], ['ode.phase', phase]] as const) {
      expect(out.status, skill).toBe('ok')
      if (out.status !== 'ok' || !out.run) throw new Error('no run')
      expect((out.run.result as { period0: unknown }).period0, skill).toBeNull()
      expect(schemaError(getSkill(skill)!.outputSchema, { ...(out.run.result as object), period0: 'soon' }, skill), skill).toMatch(/period0/)
    }
  })

  it('period0 is a number where the orbit really closes', async () => {
    const out = await executeSkill('ode.phase', { ...orbit, tSpan: [0, 20] }, { planId: planId('ode.phase') })
    if (out.status !== 'ok' || !out.run) throw new Error('no run')
    expect((out.run.result as { period0: number }).period0).toBeGreaterThan(0)
  })

  it('run-less skills: fork, compare and trace payloads satisfy their schemas', async () => {
    const source = { anchorId: 'output-contract-anchor', docId: 'd', page: 2 }
    const a = await executeSkill('formula.evaluate', { expression: ['Multiply', 'a', 'x'], bindings: { a: 2, x: 3 } }, { planId: planId('formula.evaluate'), source })
    if (a.status !== 'ok' || !a.run) throw new Error('no run')
    const fork = await executeSkill('experiment.fork', { sourceRunId: a.run.runId, parameterChanges: { a: 4 } })
    if (fork.status !== 'ok' || !fork.run) throw new Error('no fork')
    expect(schemaError(getSkill('experiment.fork')!.outputSchema, fork.payload, 'fork')).toBeNull()
    const cmp = await executeSkill('experiment.compare', { runA: a.run.runId, runB: fork.run.runId })
    expect(cmp.status).toBe('ok')
    expect(schemaError(getSkill('experiment.compare')!.outputSchema, cmp.status === 'ok' && cmp.payload, 'compare')).toBeNull()
    const trace = await executeSkill('paper.trace-source', { anchorId: source.anchorId })
    expect(trace.status).toBe('ok')
    expect(schemaError(getSkill('paper.trace-source')!.outputSchema, trace.status === 'ok' && trace.payload, 'trace')).toBeNull()
  })

  it('a skill name with a registered fork target keeps the registered kind on its fork', async () => {
    const a = await executeSkill('formula.evaluate', { expression: ['Multiply', 'a', 'x'], bindings: { a: 2, x: 3 } }, { planId: planId('formula.evaluate') })
    if (a.status !== 'ok' || !a.run) throw new Error('no run')
    const fork = await executeSkill('experiment.fork', { sourceRunId: a.run.runId, parameterChanges: { a: 4 } })
    if (fork.status !== 'ok' || !fork.run) throw new Error('no fork')
    expect(fork.run.spec.kind).toBe(getSkill('formula.evaluate')!.runKind)
  })
})

describe('output that breaks the contract becomes an error run', () => {
  const failedRun = (out: unknown) => (out as { run?: ExperimentRun }).run

  async function runWith(result: unknown) {
    registerSkillRunner('mujoco.simulate', async (_input, opts) =>
      executeSpec({ kind: 'mujoco.sim', params: {}, seed: 0 }, { engine: 'contract-test', version: '0' }, () => result, opts),
    )
    return executeSkill('mujoco.simulate', { scene: 'simple.xml', steps: 1 }, { planId: planId('mujoco.simulate') })
  }

  it.each([
    ['a wrong shape', { wrong: true }],
    ['a raw typed array', { metrics: { finalTime: 1 }, qpos: new Float64Array(2) }],
    ['a NaN metric', { metrics: { finalTime: NaN } }],
  ])('%s: output_invalid, recorded as an error, no result to project', async (_label, bad) => {
    const out = await runWith(bad)
    expect(out.status).toBe('error')
    expect(out.status === 'error' && out.code).toBe('output_invalid')
    const run = failedRun(out)
    expect(run?.status).toBe('error')
    expect(run?.result).toBeUndefined()
    expect(run?.errors.length).toBeGreaterThan(0)
    expect(getExperimentRun(run!.runId)?.result).toBeUndefined()
  })

  it('a kernel throwing stays execution_failed, not output_invalid', async () => {
    const out = await executeSkill('formula.evaluate', { expression: ['Divide', 1, 'x'], bindings: { x: 0 } }, { planId: planId('formula.evaluate') })
    expect(out.status === 'error' && out.code).toBe('execution_failed')
  })
})

describe('ode.phase declares only what its kernel does', () => {
  it('rejects system.params instead of silently ignoring them', async () => {
    const out = await executeSkill('ode.phase', { system: { ...orbit.system, params: { k: 2 } }, initialState: orbit.initialState, tSpan: [0, 2] }, { planId: planId('ode.phase') })
    expect(out.status).toBe('error')
    expect(out.status === 'error' && out.message).toMatch(/params/)
  })
  it('still accepts the empty params the desk store sends', async () => {
    const out = await executeSkill('ode.phase', { system: { ...orbit.system, params: {} }, initialState: orbit.initialState, tSpan: [0, 2] }, { planId: planId('ode.phase') })
    expect(out.status).toBe('ok')
  })
})
