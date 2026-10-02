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
import { perronTree } from '../kakeya/perron'
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

// ---- geometry.2d runtime (Perron tree / needle union kernels) ---------------

const PERRON_RASTER = 900

async function runGeometry2D(input: Input, opts: ExecuteOptions): Promise<ExperimentRun> {
  const construction = String((input as { construction: string }).construction)
  const params = (input as { params: Record<string, number> }).params ?? {}
  if (construction === 'perron-tree') {
    const k = Number(params.k)
    const alpha = Number(params.alpha)
    if (!Number.isInteger(k) || k < 1 || k > 6) throw new Error(`perron-tree: k must be an integer 1..6, got ${k}`)
    if (!(alpha >= 0 && alpha <= 1)) throw new Error(`perron-tree: alpha must be in [0,1], got ${alpha}`)
    return executeSpec(
      {
        kind: 'perron.tree',
        params: { k, alpha },
        seed: 0,
        res: PERRON_RASTER,
        model: { construction, k, alpha, raster: PERRON_RASTER },
      },
      ENGINES.kakeyaWorker,
      () => {
        const r = perronTree(k, alpha, PERRON_RASTER)
        return {
          k, alpha,
          computedArea: r.computedArea,
          triangleArea: r.triangleArea,
          boundArea: r.boundArea,
          ratio: r.computedArea / r.triangleArea,
          triangles: r.triangles.length,
        }
      },
      { parentRunId: opts.parentRunId },
    )
  }
  // needle-sweep: rasterised union area of a unit needle rotated over [0, π/2]
  // (the Kakeya needle problem's minimal 2D model — same grid measure family
  // as the 3D voxel kernel; δ-behaviour mirrors NeedleSweep's 96² constant)
  const grid = Number(params.grid ?? 96)
  if (!Number.isInteger(grid) || grid < 8 || grid > 512) throw new Error(`needle-sweep: grid must be an integer 8..512, got ${grid}`)
  return executeSpec(
    {
      kind: 'perron.tree',
      params: { grid },
      seed: 0,
      res: grid,
      model: { construction, grid },
    },
    ENGINES.kakeyaWorker,
    () => {
      const cell = 1 / grid
      const covered = new Uint8Array(grid * grid)
      let touched = 0
      const steps = Math.max(64, grid * 4)
      for (let s = 0; s <= steps; s++) {
        const theta = (Math.PI / 2) * (s / steps)
        const dx = Math.cos(theta)
        const dy = Math.sin(theta)
        // unit needle from apex (0,0) along (cosθ, sinθ) — Besicovitch base
        for (let t = 0; t <= 1; t += cell / 4) {
          const px = t * dx
          const py = t * dy
          const ix = Math.min(grid - 1, Math.max(0, Math.floor(px / cell)))
          const iy = Math.min(grid - 1, Math.max(0, Math.floor(py / cell)))
          const idx = iy * grid + ix
          if (!covered[idx]) {
            covered[idx] = 1
            touched++
          }
        }
      }
      const sweptArea = (touched * cell * cell)
      // analytic: area swept by a unit needle rotating through π/2 is π/4
      return { grid, sweptArea, analyticArea: Math.PI / 4, ratio: sweptArea / (Math.PI / 4) }
    },
    { parentRunId: opts.parentRunId },
  )
}

// ---- ode.solve runtime (RK4 Lotka–Volterra kernel) --------------------------

const ODE_STEPS = 2400

interface OdePointOut { t: number; prey: number; predator: number }

async function runOdeSolve(input: Input, opts: ExecuteOptions): Promise<ExperimentRun> {
  const system = (input as { system: { kind?: string } }).system ?? {}
  if (system.kind !== 'lv2') {
    throw new Error(`ode.solve: only system.kind='lv2' (2-species Lotka–Volterra) is wired in 0.1, got ${JSON.stringify(system.kind ?? null)}`)
  }
  const p = (input as { system: { params?: Record<string, number> } }).system.params ?? {}
  const y0 = (input as { initialValues: Record<string, number> }).initialValues ?? {}
  const tSpan = (input as { tSpan: [number, number] }).tSpan
  const alpha = Number(p.alpha ?? 1.1), beta = Number(p.beta ?? 0.4)
  const gamma = Number(p.gamma ?? 0.4), delta = Number(p.delta ?? 0.1)
  let prey0 = Number(y0.prey ?? 1), predator0 = Number(y0.predator ?? 0.5)
  for (const [k, v] of Object.entries({ alpha, beta, gamma, delta, prey: prey0, predator: predator0 })) {
    if (!Number.isFinite(v) || v <= 0) throw new Error(`ode.solve: ${k} must be a positive finite number, got ${v}`)
  }
  const [t0, t1] = tSpan
  if (!(t1 > t0) || !Number.isFinite(t0) || !Number.isFinite(t1)) throw new Error(`ode.solve: tSpan must be [t0,t1] with t1>t0`)

  return executeSpec(
    {
      kind: 'lv.ode',
      params: { alpha, beta, gamma, delta, prey0, predator0, t0, t1 },
      seed: 0,
      model: { kind: 'lv2', params: { alpha, beta, gamma, delta }, initialValues: { prey: prey0, predator: predator0 }, tSpan, steps: ODE_STEPS },
      source: opts.source,
    },
    // RK4 fixed-step in TS (CLI-verifiable without Pyodide); the Pyodide/
    // scipy path remains the browser-second-paper surface (odeGraph).
    { engine: 'ts-rk4', version: 'ode-rk4@0.1' },
    () => {
      const h = (t1 - t0) / ODE_STEPS
      const f = (_t: number, x: number, y: number): [number, number] => [
        alpha * x - beta * x * y,
        -gamma * y + delta * x * y,
      ]
      let x = prey0
      let y = predator0
      const points: OdePointOut[] = [{ t: t0, prey: x, predator: y }]
      // sample output at the same 240 points the Pyodide path emits
      const emitEvery = Math.max(1, Math.round(ODE_STEPS / 240))
      for (let i = 1; i <= ODE_STEPS; i++) {
        const t = t0 + (i - 1) * h
        const [k1x, k1y] = f(t, x, y)
        const [k2x, k2y] = f(t + h / 2, x + h / 2 * k1x, y + h / 2 * k1y)
        const [k3x, k3y] = f(t + h / 2, x + h / 2 * k2x, y + h / 2 * k2y)
        const [k4x, k4y] = f(t + h, x + h * k3x, y + h * k3y)
        x += (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x)
        y += (h / 6) * (k1y + 2 * k2y + 2 * k3y + k4y)
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`ode.solve: trajectory diverged at t=${(t + h).toFixed(3)} — check parameters`)
        if (x < 0 || y < 0) throw new Error(`ode.solve: population went negative at t=${(t + h).toFixed(3)} — step size too large for stiffness`)
        if (i % emitEvery === 0 || i === ODE_STEPS) points.push({ t: t0 + i * h, prey: x, predator: y })
      }
      // LV conserved quantity: V = δx − γ ln x + βy − α ln y (should drift ≈ 0)
      const V0 = delta * prey0 - gamma * Math.log(prey0) + beta * predator0 - alpha * Math.log(predator0)
      const last = points[points.length - 1]
      const V1 = delta * last.prey - gamma * Math.log(last.prey) + beta * last.predator - alpha * Math.log(last.predator)
      return { t: points.map((p2) => p2.t), y: { prey: points.map((p2) => p2.prey), predator: points.map((p2) => p2.predator) }, conservedDrift: Math.abs(V1 - V0), conserved0: V0 }
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
  'perron.tree': 'geometry.2d',
  'lv.ode': 'ode.solve',
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
  if (skillName === 'geometry.2d' && model) {
    return { construction: model.construction, params: model }
  }
  if (skillName === 'ode.solve' && model) {
    return {
      system: { kind: model.kind, params: model.params },
      initialValues: model.initialValues,
      tSpan: model.tSpan,
    }
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
    if (name === 'geometry.2d') return { status: 'ok', run: (await runGeometry2D(input as Input, opts)) as ExperimentRun<T> }
    if (name === 'ode.solve') return { status: 'ok', run: (await runOdeSolve(input as Input, opts)) as ExperimentRun<T> }
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
