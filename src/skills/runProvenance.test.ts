// Provenance contract for EVERY compute skill, not just the two historically
// reported failures: a run keeps its caller's source, a fork keeps parent and
// source, a replay keeps source without pretending to be a fork, and a failed
// run keeps both. All cases execute real kernels.
import { describe, expect, it } from 'vitest'
import '../physics/registerMujocoRunner'
import '../challenges/registerChallengeRunner'
import { executeSkill, replayRun } from './executor'
import { buildPlan } from './playPlan'
import { getExperimentRun, type ExperimentRun } from '../experiments/protocol'

const anchor = { docId: 'provenance-test', anchorId: 'anchor-1', title: 'Declared test anchor, not a paper claim' }
const planFor = (skill: string) => buildPlan({ skill, goal: `provenance test: ${skill}` })
const stripIds = (r: unknown) => JSON.stringify(r, (k, v) => (k === 'runId' ? undefined : v))

interface Case {
  label: string
  kind: string
  skill: string
  input: Record<string, unknown>
  /** omitted when a skill's fork carries lineage only (no numeric parameter surface) */
  change?: Record<string, number>
}

const lv = { kind: 'lv2', params: { alpha: 1.1, beta: 0.4, gamma: 0.4, delta: 0.1 } }
const decay = { states: ['u'], rhs: { u: '-k u' }, params: { k: 2 }, initialState: { u: 1 } }

const CASES: Case[] = [
  { label: 'scalar', kind: 'formula.value', skill: 'formula.evaluate', input: { expression: ['Multiply', 'a', 'x'], bindings: { a: 2, x: 3 } }, change: { a: 4 } },
  { label: 'curve', kind: 'formula.curve', skill: 'formula.plot', input: { expression: ['Multiply', 'a', 'x'], parameters: ['a'], independent: 'x', range: [-1, 1], values: { a: 2 }, samples: 21 }, change: { a: 4 } },
  { label: 'tubes', kind: 'kakeya.geometry', skill: 'kakeya.generate', input: { deltaExp: 4, packing: 0.3, nTubes: 24 }, change: { packing: 0.6 } },
  { label: 'voxels', kind: 'kakeya.voxel', skill: 'kakeya.measure', input: { deltaExp: 4, packing: 0.5, res: 18, nTubes: 16 }, change: { packing: 1 } },
  { label: 'sweep over nTubes', kind: 'kakeya.sweep', skill: 'kakeya.sweep', input: { param: 'nTubes', values: [8, 16], deltaExp: 4, packing: 0, res: 14 }, change: { packing: 1 } },
  { label: 'sweep over packing', kind: 'kakeya.sweep', skill: 'kakeya.sweep', input: { param: 'packing', values: [0, 1], nTubes: 16, deltaExp: 4, packing: 0, res: 14 }, change: { nTubes: 8 } },
  { label: 'perron tree', kind: 'perron.tree', skill: 'geometry.2d', input: { construction: 'perron-tree', params: { k: 3, alpha: 0.8 } }, change: { alpha: 0.7 } },
  { label: 'needle sweep', kind: 'perron.tree', skill: 'geometry.2d', input: { construction: 'needle-sweep', params: { grid: 32 } }, change: { grid: 48 } },
  { label: 'lv ode', kind: 'lv.ode', skill: 'ode.solve', input: { system: lv, initialValues: { prey: 1, predator: 0.5 }, tSpan: [0, 4] }, change: { alpha: 1.5 } },
  { label: 'phase ode', kind: 'ode.phase2', skill: 'ode.phase', input: { system: { kind: 'generic2', states: ['x', 'y'], rhs: { x: 'x - x y', y: 'x y - y' } }, initialState: { x: 2, y: 0.5 }, tSpan: [0, 6] }, change: { x: 1.5 } },
  { label: 'model build', kind: 'model.compiled', skill: 'model.build', input: decay, change: { k: 1 } },
  { label: 'model solve', kind: 'model.solved', skill: 'model.solve', input: { ...decay, tSpan: [0, 1], steps: 200 }, change: { k: 1 } },
  { label: 'mujoco', kind: 'mujoco.sim', skill: 'mujoco.simulate', input: { scene: 'simple.xml', steps: 60, sampleEvery: 30, params: { gravityZ: -9.81 } }, change: { gravityZ: -1 } },
  { label: 'challenge', kind: 'challenge.attempt', skill: 'challenge.attempt', input: { challenge: 'projectile', changes: { angleDeg: 45, speed: 10 } } },
]

async function runCase(c: Case, source?: unknown): Promise<ExperimentRun> {
  const out = await executeSkill(c.skill, c.input, { planId: planFor(c.skill).planId, source })
  expect(out.status, `${c.label}: ${out.status === 'error' ? out.message : ''}`).toBe('ok')
  if (out.status !== 'ok' || !out.run) throw new Error(`${c.label} produced no run`)
  expect(out.run.spec.kind).toBe(c.kind)
  return out.run as ExperimentRun
}

describe('run provenance across every compute skill', () => {
  it.each(CASES)('$label: the run records the caller source', async (c) => {
    const run = await runCase(c, anchor)
    expect(run.spec.source).toEqual(anchor)
    expect(run.parentRunId).toBeUndefined()
  }, 120_000)

  it.each(CASES)('$label: a fork keeps parent and inherits source', async (c) => {
    const base = await runCase(c, anchor)
    const fork = await executeSkill('experiment.fork', { sourceRunId: base.runId, ...(c.change ? { parameterChanges: c.change } : {}) })
    expect(fork.status, `${c.label}: ${fork.status === 'error' ? fork.message : ''}`).toBe('ok')
    if (fork.status !== 'ok' || !fork.run) throw new Error(`${c.label} fork produced no run`)
    expect(fork.run.parentRunId).toBe(base.runId)
    expect(fork.run.spec.source).toEqual(anchor)
    expect(fork.run.spec.kind).toBe(c.kind)
    // a parameter change must actually change the computation, not just the label
    if (c.change) expect(stripIds(fork.run.result)).not.toBe(stripIds(base.result))
  }, 120_000)

  it.each(CASES)('$label: a replay keeps source, matches numerically, and is not a fork', async (c) => {
    const base = await runCase(c, anchor)
    const replay = await replayRun(base.runId)
    expect(replay.status, `${c.label}: ${replay.status === 'error' ? replay.message : ''}`).toBe('ok')
    if (replay.status !== 'ok' || !replay.run) throw new Error(`${c.label} replay produced no run`)
    expect(replay.run.runId).not.toBe(base.runId)
    expect(replay.run.parentRunId).toBeUndefined()
    expect(replay.run.spec.source).toEqual(anchor)
    expect(stripIds(replay.run.result)).toBe(stripIds(base.result))
  }, 120_000)

  it.each(CASES)('$label: no source is invented when the caller gives none', async (c) => {
    const run = await runCase(c)
    expect(run.spec.source).toBeUndefined()
  }, 120_000)

  it('a curve run records the FULL values map — replay keeps non-parameter bindings (chaining fidelity)', async () => {
    // b is neither a declared parameter nor the independent: it lives only in
    // `values`. spec.params carries declared parameters alone, so a replayable
    // input built from params alone would drop b and recompute garbage.
    const input = {
      expression: ['Multiply', 'a', ['Multiply', 'b', 'x']],
      parameters: ['a'],
      independent: 'x',
      range: [-1, 1],
      values: { a: 2, b: 3 },
      samples: 11,
    }
    const plan = buildPlan({ skill: 'formula.plot', goal: 'values fidelity', inputs: input })
    const first = await executeSkill('formula.plot', input, { planId: plan.planId })
    expect(first.status).toBe('ok')
    if (first.status !== 'ok' || !first.run) throw new Error('first run failed')
    const strip = (r: unknown) => JSON.stringify(r, (k, v) => (k === 'runId' ? undefined : v))
    const replay = await replayRun(first.run.runId)
    expect(replay.status).toBe('ok')
    if (replay.status !== 'ok' || !replay.run) throw new Error('replay failed')
    expect(strip(replay.run.result)).toBe(strip(first.run.result))
    // and inputForRun (the agent chain's base resolver) carries b
    const { inputForRun } = await import('./executor')
    const resolved = inputForRun(first.run.runId)
    if ('error' in resolved) throw new Error(resolved.error)
    expect((resolved.input as { values: Record<string, number> }).values.b).toBe(3)
  }, 120_000)
})

describe('failed runs keep their provenance', () => {
  const scalar = { expression: ['Divide', 1, 'x'], bindings: { x: 2 } }

  it('an error run records source and evaluates to no result', async () => {
    const out = await executeSkill('formula.evaluate', { ...scalar, bindings: { x: 0 } }, { planId: planFor('formula.evaluate').planId, source: anchor })
    expect(out.status).toBe('error')
    const run = (out as { run?: ExperimentRun }).run
    expect(run?.status).toBe('error')
    expect(run?.result).toBeUndefined()
    expect(run?.spec.source).toEqual(anchor)
  })

  it('a failed fork still points at its parent and inherits source', async () => {
    const base = await executeSkill('formula.evaluate', scalar, { planId: planFor('formula.evaluate').planId, source: anchor })
    if (base.status !== 'ok' || !base.run) throw new Error('base run failed')
    expect((base.run.result as { value: number }).value).toBe(0.5)
    const fork = await executeSkill('experiment.fork', { sourceRunId: base.run.runId, parameterChanges: { x: 0 } })
    expect(fork.status).toBe('error')
    const run = (fork as { run?: ExperimentRun }).run
    expect(run?.status).toBe('error')
    expect(run?.parentRunId).toBe(base.run.runId)
    expect(run?.spec.source).toEqual(anchor)
  })

  it('sweep child runs carry the sweep source so each datapoint traces back', async () => {
    const out = await executeSkill('kakeya.sweep', { param: 'nTubes', values: [8], deltaExp: 4, packing: 0, res: 14 }, { planId: planFor('kakeya.sweep').planId, source: anchor })
    if (out.status !== 'ok' || !out.run) throw new Error('sweep failed')
    const point = (out.run.result as { points: Array<{ runId: string }> }).points[0]
    expect(getExperimentRun(point.runId)?.spec.source).toEqual(anchor)
  })
})
