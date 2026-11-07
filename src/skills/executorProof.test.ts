// Product-suite port of the isolated real-executor probe (research ch.15 §1,
// mathworld/executor-proof/probe.ts): the same 19 assertions, inputs and
// analytic oracles, against the real kernels. The original probe found the
// executor numerically right but with two provenance failures; the oracles
// here must never be edited to make a failure disappear.
import { beforeAll, describe, expect, it } from 'vitest'
import { executeSkill, replayRun, type SkillOutcome } from './executor'
import { buildPlan } from './playPlan'
import { listExperimentRuns, type ExperimentRun } from '../experiments/protocol'

const source = {
  docId: 'synthetic-analytic-oracle',
  anchorId: 'oracle-polynomial',
  title: 'Declared analytic test, not a paper claim',
}
const expr = ['Add', ['Multiply', 'a', ['Power', 'x', 2]], 'b']
const evaluation = { expression: expr, bindings: { a: 2, b: 1, x: 1.25 } }
const plotInput = { expression: expr, parameters: ['a', 'b'], independent: 'x', range: [-1, 1], values: { a: 2, b: 1 }, samples: 101 }
const model = { states: ['u'], rhs: { u: '-k u' }, params: { k: 2 }, initialState: { u: 1 } }

type Outcome = SkillOutcome<any> // eslint-disable-line @typescript-eslint/no-explicit-any
const runOf = (o: Outcome): ExperimentRun<any> | undefined => (o as { run?: ExperimentRun<any> | null }).run ?? undefined // eslint-disable-line @typescript-eslint/no-explicit-any
const resultOf = (o: Outcome) => (o.status === 'ok' ? runOf(o)?.result : undefined)
const runCount = () => listExperimentRuns({ limit: 100000 }).length

async function call(skill: string, input: unknown, label: string): Promise<Outcome> {
  const plan = buildPlan({ skill, goal: `isolated real-executor verification: ${label}`, inputs: input as Record<string, unknown> })
  return executeSkill(skill, input, { planId: plan.planId, source })
}

describe('real-executor proof: the 19 historical assertions', () => {
  const o: Record<string, Outcome> = {}
  let missingPlanRunsDelta = NaN

  beforeAll(async () => {
    delete process.env.PAPER2LAB_ALLOW_UNREGISTERED_PLANS
    o.evaluate = await call('formula.evaluate', evaluation, 'evaluate-polynomial')
    o.evaluate2 = await call('formula.evaluate', { ...evaluation, bindings: { a: 4, b: 1, x: 1.25 } }, 'evaluate-parameter-change')
    o.plot = await call('formula.plot', plotInput, 'plot-polynomial')
    o.plotReplay = await replayRun(runOf(o.plot)!.runId)
    o.plotFork = await call('experiment.fork', { sourceRunId: runOf(o.plot)!.runId, parameterChanges: { a: 4 } }, 'plot-fork-a4')
    o.build = await call('model.build', model, 'build-exponential-decay')
    o.solve = await call('model.solve', { ...model, tSpan: [0, 1], steps: 200 }, 'solve-exponential-decay')
    o.solveReplay = await replayRun(runOf(o.solve)!.runId)
    o.solveFork = await call('experiment.fork', { sourceRunId: runOf(o.solve)!.runId, parameterChanges: { k: 1 } }, 'model-fork-k1')
    const before = runCount()
    o.missing = await executeSkill('formula.plot', plotInput, {})
    missingPlanRunsDelta = runCount() - before
    o.forged = await executeSkill('formula.plot', plotInput, { planId: 'not-a-registered-plan', source })
    o.unknown = await executeSkill('not.a.skill', {}, {})
    o.pole = await call('formula.plot', { expression: ['Divide', 1, 'x'], parameters: [], independent: 'x', range: [-1, 1], values: {}, samples: 3 }, 'nonfinite-pole')
    o.scalarFork = await call('experiment.fork', { sourceRunId: runOf(o.evaluate)!.runId, parameterChanges: { a: 4 } }, 'evaluate-fork-a4')
  }, 60_000)

  it('evaluate analytic value', () => {
    expect(resultOf(o.evaluate)?.value).toBe(4.125)
  })
  it('evaluate parameter sensitivity', () => {
    expect(resultOf(o.evaluate2)?.value).toBe(7.25)
  })
  it('plot grid and peak', () => {
    expect(resultOf(o.plot)?.points).toHaveLength(101)
    expect(resultOf(o.plot)?.peak).toBe(3)
  })
  it('plot every point analytic oracle', () => {
    const points = resultOf(o.plot)?.points as Array<[number, number]>
    expect(Math.max(...points.map(([x, y]) => Math.abs(y - (2 * x * x + 1))))).toBeLessThan(1e-13)
  })
  it('plot trapezoidal integral', () => {
    expect(Math.abs((resultOf(o.plot)?.integral as number) - 10 / 3)).toBeLessThan(0.000267)
  })
  it('plot replay same result new id', () => {
    expect(o.plotReplay.status).toBe('ok')
    expect(JSON.stringify(resultOf(o.plotReplay))).toBe(JSON.stringify(resultOf(o.plot)))
    expect(runOf(o.plotReplay)?.runId).not.toBe(runOf(o.plot)?.runId)
  })
  it('plot fork lineage and sensitivity', () => {
    expect(runOf(o.plotFork)?.parentRunId).toBe(runOf(o.plot)?.runId)
    expect(resultOf(o.plotFork)?.peak).toBe(5)
  })
  it('plot fork source inheritance', () => {
    expect(runOf(o.plotFork)?.spec.source).toEqual(source)
  })
  it('model build initial derivative', () => {
    expect(resultOf(o.build)?.verifiedAt?.[0]?.value).toBe(-2)
  })
  it('model RK4 analytic endpoint', () => {
    const final = resultOf(o.solve)?.series?.[0]?.values?.at(-1) as number
    expect(Math.abs(final - Math.exp(-2))).toBeLessThan(1e-9)
  })
  it('model replay identical', () => {
    expect(o.solveReplay.status).toBe('ok')
    expect(JSON.stringify(resultOf(o.solveReplay))).toBe(JSON.stringify(resultOf(o.solve)))
  })
  it('model fork lineage analytic endpoint', () => {
    expect(runOf(o.solveFork)?.parentRunId).toBe(runOf(o.solve)?.runId)
    const end = resultOf(o.solveFork)?.series?.[0]?.values?.at(-1) as number
    expect(Math.abs(end - Math.exp(-1))).toBeLessThan(1e-9)
  })
  it('missing PlayPlan rejected without run', () => {
    expect(o.missing.status).toBe('needs_input')
    expect(runOf(o.missing)).toBeUndefined()
    expect(missingPlanRunsDelta).toBe(0)
  })
  it('unregistered PlayPlan rejected', () => {
    expect(o.forged.status).toBe('needs_input')
    expect(runOf(o.forged)).toBeUndefined()
  })
  it('unknown skill rejected', () => {
    expect(o.unknown.status).toBe('error')
    expect(o.unknown.status === 'error' && o.unknown.code).toBe('unknown_skill')
    expect(runOf(o.unknown)).toBeUndefined()
  })
  it('nonfinite becomes error Run', () => {
    expect(o.pole.status).toBe('error')
    const run = runOf(o.pole)
    expect(run?.status).toBe('error')
    expect(run?.errors.length).toBeGreaterThan(0)
    expect(run?.result).toBeUndefined()
  })
  it('scalar fork numeric result', () => {
    expect(resultOf(o.scalarFork)?.value).toBe(7.25)
  })
  it('scalar fork lineage preserved', () => {
    expect(runOf(o.scalarFork)?.parentRunId).toBe(runOf(o.evaluate)?.runId)
  })
  it('scalar source preserved', () => {
    expect(runOf(o.evaluate)?.spec.source).toEqual(source)
  })
})
