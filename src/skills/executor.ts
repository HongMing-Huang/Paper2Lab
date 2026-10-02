// Unified Scientific Skill execution entry (Stage A) — THE single door every
// caller (UI cells, local planner, agent bridge, headless protocol client)
// goes through. Resolves implementations by registered name, validates input
// BEFORE any side effect, executes the real runtime, validates output
// (finite numbers, required fields) and returns a uniform outcome. Skills
// that exist in the registry but are not wired here answer `unsupported`.
import { compile, type MathJsonExpression } from '@cortex-js/compute-engine'
import { executeSpec, getExperimentRun, listExperimentRuns, ENGINES, type ExperimentRun } from '../experiments/protocol'
import { compareRuns, type RunComparison } from '../experiments/runRepository'
import { getSkill, schemaError } from './registry'
import { fibonacciDirections } from '../kakeya/directions'
import { makeTubes, type Tube3 } from '../kakeya/tubes'
import { computeVoxelCoverage, type VoxelResult } from '../kakeya/voxels3d'
import { isWorkerAvailable, measureVoxelCover } from '../workers/voxelClient'

/** the Kakeya family seed pinned across UI cells and C++ precompute */
export const KAKEYA_SEED = 20250224
/** voxel resolution of the visual occupancy grid (divides res choices) */
const VIS_RES = 16

export type SkillOutcome<T = unknown> =
  | { status: 'ok'; run: ExperimentRun<T> | null; payload?: unknown }
  | { status: 'needs_input'; missing: string[]; message: string }
  | { status: 'unsupported'; skill: string; message: string }
  | {
      status: 'error'
      code: 'unknown_skill' | 'invalid_input' | 'execution_failed' | 'output_invalid'
      message: string
      run?: ExperimentRun
    }

export interface ExecuteOptions {
  /** PlayPlan id — formal numeric skills refuse to run without one */
  planId?: string
  /** set when re-executing an already-planned historical run (replay) */
  replay?: boolean
  parentRunId?: string
  /** provenance anchor stored on the run spec (Docling source) */
  source?: unknown
}

type Input = Record<string, unknown>

// ---- formula runtime (Cortex → JS) ----------------------------------------

function compileExpr(expression: MathJsonExpression) {
  const compiled = compile(expression, { to: 'javascript' })
  if (!compiled || typeof compiled.run !== 'function') {
    throw new Error('Cortex could not compile the expression to JavaScript')
  }
  return compiled
}

async function runFormulaEvaluate(input: Input): Promise<ExperimentRun<{ value: number }>> {
  const compiled = compileExpr(input.expression as MathJsonExpression)
  return executeSpec(
    {
      kind: 'formula.value',
      params: {},
      seed: 0,
      model: { expression: input.expression, bindings: input.bindings },
    },
    ENGINES.cortexJs,
    () => {
      const raw = compiled.run(input.bindings as Record<string, number>)
      const value = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(value)) throw new Error(`Formula produced a non-finite value: ${String(raw)}`)
      return { value }
    },
  )
}

async function runFormulaPlot(input: Input, opts: ExecuteOptions): Promise<ExperimentRun> {
  const parameters = (input.parameters as string[]) ?? []
  const values = (input.values as Record<string, number>) ?? {}
  const independent = String(input.independent)
  const [x0, x1] = input.range as [number, number]
  const samples = typeof input.samples === 'number' ? input.samples : 361
  const compiled = compileExpr(input.expression as MathJsonExpression)
  return executeSpec(
    {
      kind: 'formula.curve',
      params: Object.fromEntries(parameters.map((p) => [p, Number(values[p] ?? 1)])),
      seed: 0,
      model: { expression: input.expression, independent, range: [x0, x1], samples, parameters },
      source: opts.source,
    },
    ENGINES.cortexJs,
    () => {
      const points: Array<[number, number]> = []
      let peak = 0
      let integral = 0
      let previous: [number, number] | null = null
      for (let i = 0; i < samples; i++) {
        const x = x0 + ((x1 - x0) * i) / (samples - 1)
        const raw = compiled.run({ ...values, [independent]: x })
        const y = typeof raw === 'number' ? raw : Number(raw)
        if (!Number.isFinite(y)) throw new Error(`Non-finite value at ${independent}=${x}`)
        points.push([x, y])
        peak = Math.max(peak, Math.abs(y))
        if (previous) integral += (Math.abs(y) + Math.abs(previous[1])) * (x - previous[0]) / 2
        previous = [x, y]
      }
      return { points, peak, integral }
    },
    { parentRunId: opts.parentRunId },
  )
}

// ---- kakeya runtime (same kernels the worker uses) -------------------------

function tubesFor(deltaExp: number, nTubes: number, packing: number): Tube3[] {
  return makeTubes(fibonacciDirections(nTubes), 2 ** -deltaExp, packing, KAKEYA_SEED)
}

async function measureVoxels(
  tubes: Tube3[],
  res: number,
): Promise<Pick<VoxelResult, 'occupiedVolume' | 'sumTubeVolume' | 'maxMultiplicity' | 'avgMultiplicity'>> {
  if (isWorkerAvailable()) {
    const r = await measureVoxelCover(tubes, res, VIS_RES)
    return {
      occupiedVolume: r.occupiedVolume,
      sumTubeVolume: r.sumTubeVolume,
      maxMultiplicity: r.maxMultiplicity,
      avgMultiplicity: r.avgMultiplicity,
    }
  }
  const r = computeVoxelCoverage(tubes, res, VIS_RES)
  return {
    occupiedVolume: r.occupiedVolume,
    sumTubeVolume: r.sumTubeVolume,
    maxMultiplicity: r.maxMultiplicity,
    avgMultiplicity: r.avgMultiplicity,
  }
}

async function runKakeyaGenerate(input: Input): Promise<ExperimentRun<Tube3[]>> {
  const deltaExp = Number(input.deltaExp)
  const nTubes = Number(input.nTubes)
  const packing = Number(input.packing)
  const tubes = tubesFor(deltaExp, nTubes, packing)
  return executeSpec(
    {
      kind: 'kakeya.geometry',
      params: { delta: 2 ** -deltaExp, packing, nTubes },
      seed: KAKEYA_SEED,
      model: { deltaExp, packing, nTubes },
    },
    ENGINES.kakeyaWorker,
    () => tubes,
  )
}

async function runKakeyaMeasure(input: Input, opts: ExecuteOptions): Promise<ExperimentRun> {
  const deltaExp = Number(input.deltaExp)
  const nTubes = Number(input.nTubes)
  const packing = Number(input.packing)
  const res = typeof input.res === 'number' ? Number(input.res) : 48
  const tubes = tubesFor(deltaExp, nTubes, packing)
  return executeSpec(
    {
      kind: 'kakeya.voxel',
      params: { deltaExp, packing, nTubes },
      seed: KAKEYA_SEED,
      res,
      model: { deltaExp, packing, nTubes, res },
    },
    ENGINES.kakeyaWorker,
    () => measureVoxels(tubes, res),
    { parentRunId: opts.parentRunId },
  )
}

async function runKakeyaSweep(input: Input, opts: ExecuteOptions): Promise<ExperimentRun> {
  const param = String(input.param)
  const values = input.values as number[]
  const deltaExp = typeof input.deltaExp === 'number' ? Number(input.deltaExp) : 4
  const packing = typeof input.packing === 'number' ? Number(input.packing) : 0
  const res = typeof input.res === 'number' ? Number(input.res) : 40
  return executeSpec(
    {
      kind: 'kakeya.sweep',
      params: { deltaExp, packing },
      seed: KAKEYA_SEED,
      res,
      model: { param, values, deltaExp, packing, res },
    },
    ENGINES.kakeyaWorker,
    async () => {
      const points: Array<{ x: number; y: number; series: string; runId: string }> = []
      for (const v of values) {
        const child = await runKakeyaMeasure(
          param === 'nTubes' ? { ...input, nTubes: v, res } : param === 'packing' ? { ...input, packing: v, res } : { ...input, deltaExp: v, res },
          { ...opts, parentRunId: opts.parentRunId },
        )
        points.push({ x: v, y: (child.result as { occupiedVolume: number }).occupiedVolume, series: 'sweep', runId: child.runId })
      }
      return { points }
    },
    { parentRunId: opts.parentRunId },
  )
}

// ---- orchestration skills ---------------------------------------------------

const COMPUTE_BY_KIND: Record<string, string> = {
  'formula.curve': 'formula.plot',
  'formula.value': 'formula.evaluate',
  'kakeya.voxel': 'kakeya.measure',
  'kakeya.geometry': 'kakeya.generate',
  'kakeya.sweep': 'kakeya.sweep',
}

/** re-execute a historical run from its recorded spec (real replay, no mocks) */
export async function replayRun(runId: string): Promise<SkillOutcome> {
  const run = getExperimentRun(runId)
  if (!run) return { status: 'error', code: 'unknown_skill', message: `Unknown run: ${runId}` }
  const skillName = COMPUTE_BY_KIND[run.spec.kind]
  if (!skillName) return { status: 'unsupported', skill: run.spec.kind, message: `No compute skill mapped for kind ${run.spec.kind}` }
  const input = inputFromSpec(skillName, run)
  if (!input) return { status: 'error', code: 'invalid_input', message: `Run ${runId} spec lacks the model fields needed for replay` }
  return executeSkill(skillName, input, { planId: `replay:${runId}`, replay: true })
}

function inputFromSpec(skillName: string, run: ExperimentRun): Input | null {
  const model = run.spec.model as Record<string, unknown> | undefined
  if (skillName === 'formula.plot') {
    if (!model?.expression) return null
    return {
      expression: model.expression,
      parameters: model.parameters ?? [],
      independent: model.independent ?? 'x',
      range: model.range ?? [-5, 5],
      values: Object.fromEntries(Object.entries(run.spec.params).filter(([, v]) => typeof v === 'number')),
      samples: model.samples,
    }
  }
  if (skillName === 'kakeya.measure' || skillName === 'kakeya.generate') {
    return {
      deltaExp: model?.deltaExp ?? run.spec.params.deltaExp,
      nTubes: model?.nTubes ?? run.spec.params.nTubes,
      packing: model?.packing ?? run.spec.params.packing,
      res: model?.res ?? run.spec.res,
    }
  }
  if (skillName === 'kakeya.sweep' && model) {
    return {
      param: model.param,
      values: model.values,
      deltaExp: model.deltaExp,
      packing: model.packing,
      res: model.res,
    }
  }
  if (skillName === 'formula.evaluate' && model) {
    return { expression: model.expression, bindings: model.bindings }
  }
  return null
}

// ---- the single entry -------------------------------------------------------

/** skills whose runs are formal evidence and therefore need a PlayPlan */
const FORMAL_SKILLS = new Set(['formula.plot', 'formula.evaluate', 'kakeya.generate', 'kakeya.measure', 'kakeya.sweep'])

export async function executeSkill<T = unknown>(
  name: string,
  input: unknown,
  opts: ExecuteOptions = {},
): Promise<SkillOutcome<T>> {
  const skill = getSkill(name)
  if (!skill) return { status: 'error', code: 'unknown_skill', message: `Unknown skill: ${name}` }
  if (!skill.implemented) {
    return {
      status: 'unsupported',
      skill: name,
      message: skill.unavailableReason ?? `${name} is registered but not wired to the unified executor yet`,
    }
  }
  const inputError = schemaError(skill.inputSchema, input, name)
  if (inputError) return { status: 'error', code: 'invalid_input', message: inputError }
  if (FORMAL_SKILLS.has(name) && !opts.planId && !opts.replay) {
    return { status: 'needs_input', missing: ['planId'], message: `${name} refuses to run without a PlayPlan` }
  }
  try {
    if (name === 'formula.evaluate') return { status: 'ok', run: (await runFormulaEvaluate(input as Input)) as ExperimentRun<T> }
    if (name === 'formula.plot') return { status: 'ok', run: (await runFormulaPlot(input as Input, opts)) as ExperimentRun<T> }
    if (name === 'kakeya.generate') return { status: 'ok', run: (await runKakeyaGenerate(input as Input)) as ExperimentRun<T> }
    if (name === 'kakeya.measure') return { status: 'ok', run: (await runKakeyaMeasure(input as Input, opts)) as ExperimentRun<T> }
    if (name === 'kakeya.sweep') return { status: 'ok', run: (await runKakeyaSweep(input as Input, opts)) as ExperimentRun<T> }
    if (name === 'experiment.fork') {
      const { sourceRunId, parameterChanges = {} } = input as { sourceRunId: string; parameterChanges?: Record<string, number> }
      const source = getExperimentRun(sourceRunId)
      if (!source) return { status: 'error', code: 'invalid_input', message: `Unknown run: ${sourceRunId}` }
      const skillName = COMPUTE_BY_KIND[source.spec.kind]
      if (!skillName) return { status: 'unsupported', skill: source.spec.kind, message: 'Source run kind has no compute skill' }
      const forkInput = inputFromSpec(skillName, source)
      if (!forkInput) return { status: 'error', code: 'invalid_input', message: 'Source run spec cannot be replayed' }
      if (skillName === 'formula.plot') {
        forkInput.values = { ...((forkInput.values as Record<string, number>) ?? {}), ...parameterChanges }
      } else {
        Object.assign(forkInput, parameterChanges)
      }
      const outcome = await executeSkill(skillName, forkInput, {
        planId: `fork:${sourceRunId}`,
        replay: true,
        parentRunId: sourceRunId,
      })
      if (outcome.status === 'ok' && outcome.run) {
        return { status: 'ok', run: outcome.run as ExperimentRun<T>, payload: { forkRunId: outcome.run.runId } }
      }
      return outcome as SkillOutcome<T>
    }
    if (name === 'experiment.compare') {
      const { runA, runB } = input as { runA: string; runB: string }
      try {
        const comparison: RunComparison = compareRuns(runA, runB)
        return { status: 'ok', run: null, payload: comparison }
      } catch (err) {
        return { status: 'error', code: 'invalid_input', message: err instanceof Error ? err.message : String(err) }
      }
    }
    if (name === 'paper.trace-source') {
      const { anchorId } = input as { anchorId: string }
      const withSource = listExperimentRuns({ limit: 500 }).filter(
        (r) => (r.spec.source as { anchorId?: string } | undefined)?.anchorId === anchorId,
      )
      if (withSource.length === 0) {
        return { status: 'needs_input', missing: ['anchor'], message: `No recorded run carries source anchor ${anchorId}` }
      }
      return { status: 'ok', run: null, payload: withSource[0].spec.source }
    }
    return { status: 'unsupported', skill: name, message: 'No implementation branch' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const failedRun = (err as { run?: ExperimentRun }).run
    return { status: 'error', code: 'execution_failed', message, run: failedRun }
  }
}
