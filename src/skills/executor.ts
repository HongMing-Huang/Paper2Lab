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
import { analyzeFormula } from '../formula/analyze'
import { getEngine } from '../formula/engine'
import { getPlan, planCoversSkill } from './playPlan'
import { compileFormula } from '../formula/compile'

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
  // paper latex often arrives as `y = …` (an Equal node): plotting means the
  // RIGHT-HAND SIDE — compiling the whole Equal yields a constant-0 curve
  // (first bit with VLM extraction, whose formulas keep the LHS)
  let expr = expression
  if (typeof expr === 'string') {
    expr = getEngine().parse(expr).json
  }
  if (Array.isArray(expr) && expr[0] === 'Equal' && expr.length >= 3) {
    expr = expr[2] as MathJsonExpression
  }
  const compiled = compile(expr, { to: 'javascript' })
  if (!compiled || typeof compiled.run !== 'function') {
    throw new Error('Cortex could not compile the expression to JavaScript')
  }
  return compiled
}

async function runFormulaEvaluate(input: Input, opts: ExecuteOptions = {}): Promise<ExperimentRun<{ value: number }>> {
  const compiled = compileExpr(input.expression as MathJsonExpression)
  return executeSpec(
    {
      kind: 'formula.value',
      params: {},
      seed: 0,
      model: { expression: input.expression, bindings: input.bindings },
      source: opts.source,
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
  if (!Number.isInteger(samples) || samples < 2) {
    throw new Error(`formula.plot requires samples >= 2 (got ${input.samples}) — fewer yields an empty curve or a divide-by-zero`)
  }
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

async function runKakeyaGenerate(input: Input, opts: ExecuteOptions): Promise<ExperimentRun<Tube3[]>> {
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
      source: opts.source,
    },
    ENGINES.kakeyaWorker,
    () => tubes,
    { parentRunId: opts.parentRunId },
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
      source: opts.source,
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
  // non-nTubes sweeps measure a FIXED tube family — without a baseline count
  // nTubes is undefined → NaN → fibonacciDirections(NaN) returns an empty
  // family and the sweep records zero-volume CALCULATED evidence (review finding)
  if (param !== 'nTubes' && typeof input.nTubes !== 'number') {
    throw new Error(`kakeya.sweep over '${param}' requires a baseline nTubes (the fixed tube family being swept)`)
  }
  const nTubes = typeof input.nTubes === 'number' ? Number(input.nTubes) : 0
  return executeSpec(
    {
      kind: 'kakeya.sweep',
      params: { deltaExp, packing },
      seed: KAKEYA_SEED,
      res,
      model: { param, values, deltaExp, packing, res, ...(nTubes ? { nTubes } : {}) },
      source: opts.source,
    },
    ENGINES.kakeyaWorker,
    async () => {
      const points: Array<{ x: number; y: number; series: string; runId: string }> = []
      for (const v of values) {
        const child = await runKakeyaMeasure(
          param === 'nTubes'
            ? { ...input, nTubes: v, res }
            : param === 'packing'
              ? { nTubes, deltaExp, packing: v, res }
              : { nTubes, deltaExp: v, packing, res },
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
      source: opts.source,
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

// ---- ode.phase runtime (generic 2-state RK4, paper LaTeX RHS) ---------------

const ODE_PHASE_STEPS = 2400
/** registered config (#24): integration window default for paper ODEs */
export const ODE_PHASE_T_SPAN: [number, number] = [0, 20]

interface OdePhasePoint { t: number; s0: number; s1: number }

/** compile ONE paper-latex right-hand side into a JS function of the states */
function compileOdeRhs(latex: string, states: [string, string]): ((x: number, y: number) => number) | null {
  const a = analyzeFormula(latex)
  if (!a.ok) return null
  const compiled = compileFormula(a.rhs)
  if (!compiled) return null
  const [s0, s1] = states
  return (x: number, y: number) => {
    const raw = compiled.run({ [s0]: x, [s1]: y })
    return typeof raw === 'number' ? raw : Number(raw)
  }
}

async function runOdePhase(input: Input, opts: ExecuteOptions): Promise<ExperimentRun> {
  const system = (input as { system: { kind?: string; states?: [string, string]; rhs?: Record<string, string>; params?: Record<string, number> } }).system
  if (system?.kind !== 'generic2' || !Array.isArray(system.states) || system.states.length !== 2) {
    throw new Error(`ode.phase: only system.kind='generic2' with exactly 2 states is supported, got ${JSON.stringify(system?.kind ?? null)}`)
  }
  const [s0name, s1name] = system.states
  const rhs0 = compileOdeRhs(String(system.rhs?.[s0name] ?? ''), [s0name, s1name])
  const rhs1 = compileOdeRhs(String(system.rhs?.[s1name] ?? ''), [s0name, s1name])
  if (!rhs0 || !rhs1) throw new Error(`ode.phase: could not compile the paper's right-hand sides for states ${s0name}, ${s1name}`)
  const initial = (input as { initialState: Record<string, number> }).initialState ?? {}
  const x0 = Number(initial[s0name])
  const y0 = Number(initial[s1name])
  if (!Number.isFinite(x0) || !Number.isFinite(y0)) throw new Error(`ode.phase: initialState must provide finite ${s0name} and ${s1name}`)
  const tSpan = (input as { tSpan: [number, number] }).tSpan
  const [t0, t1] = tSpan
  if (!(t1 > t0) || !Number.isFinite(t0) || !Number.isFinite(t1)) throw new Error('ode.phase: tSpan must be [t0,t1] with t1>t0')

  return executeSpec(
    {
      kind: 'ode.phase2',
      params: { [s0name]: x0, [s1name]: y0, t0, t1 },
      seed: 0,
      model: { system: { kind: 'generic2', states: system.states, rhs: system.rhs, params: system.params ?? {} }, initialState: initial, tSpan, steps: ODE_PHASE_STEPS },
      source: opts.source,
    },
    { engine: 'ts-rk4', version: 'ode-rk4@0.2' },
    () => {
      const h = (t1 - t0) / ODE_PHASE_STEPS
      const f = (_t: number, x: number, y: number): [number, number] => [rhs0(x, y), rhs1(x, y)]
      let x = x0
      let y = y0
      const points: OdePhasePoint[] = [{ t: t0, s0: x, s1: y }]
      const emitEvery = Math.max(1, Math.round(ODE_PHASE_STEPS / 240))
      let maxAbs0 = Math.abs(x)
      let maxAbs1 = Math.abs(y)
      for (let i = 1; i <= ODE_PHASE_STEPS; i++) {
        const t = t0 + (i - 1) * h
        const [k1x, k1y] = f(t, x, y)
        const [k2x, k2y] = f(t + h / 2, x + (h / 2) * k1x, y + (h / 2) * k1y)
        const [k3x, k3y] = f(t + h / 2, x + (h / 2) * k2x, y + (h / 2) * k2y)
        const [k4x, k4y] = f(t + h, x + h * k3x, y + h * k3y)
        x += (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x)
        y += (h / 6) * (k1y + 2 * k2y + 2 * k3y + k4y)
        maxAbs0 = Math.max(maxAbs0, Math.abs(x))
        maxAbs1 = Math.max(maxAbs1, Math.abs(y))
        if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e8 || Math.abs(y) > 1e8) {
          throw new Error(`ode.phase: trajectory diverged at t=${(t + h).toFixed(3)} — check the paper's equations/initial state`)
        }
        if (i % emitEvery === 0 || i === ODE_PHASE_STEPS) points.push({ t: t0 + i * h, s0: x, s1: y })
      }
      // period from rising crossings of the signal's MIDLINE (min+max)/2 —
      // orbits typically oscillate around their equilibrium, not around 0
      // (LV: x* = 1), so plain zero-crossings would miss the cycle entirely.
      // Nullable: decaying/too-short signals may not complete two crossings,
      // and that fact is itself the observation.
      let minS0 = Infinity
      let maxS0 = -Infinity
      for (const v of points) {
        if (v.s0 < minS0) minS0 = v.s0
        if (v.s0 > maxS0) maxS0 = v.s0
      }
      const mid = (minS0 + maxS0) / 2
      const crossings: number[] = []
      for (let i = 1; i < points.length; i++) {
        if (points[i - 1].s0 < mid && points[i].s0 >= mid) {
          const f0 = (mid - points[i - 1].s0) / (points[i].s0 - points[i - 1].s0 || 1e-12)
          crossings.push(points[i - 1].t + f0 * (points[i].t - points[i - 1].t))
        }
      }
      let period0: number | null = null
      if (crossings.length >= 2) {
        const gaps = crossings.slice(1).map((c, i) => c - crossings[i])
        period0 = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
      }
      return {
        t: points.map((p) => p.t),
        s0: points.map((p) => p.s0),
        s1: points.map((p) => p.s1),
        period0,
        maxAbs0,
        maxAbs1,
      }
    },
    { parentRunId: opts.parentRunId },
  )
}

// ---- model runtime (paper→model L2: compile & solve an N-state system) ----

/** registered config: default integration steps for model.solve (audit E/G) */
export const MODEL_SOLVE_STEPS = 2400

/** rename model symbols to collision-free v0/v1/… in the MathJSON tree.
 * Single-letter names hit Cortex's CONSTANT folding: a bare `I` compiles to
 * EulerGamma·x (0.5772…), so epidemiology's standard Infected state silently
 * becomes a constant — a pure symbol rename fixes every such collision. */
function sanitizeSymbols(
  expr: MathJsonExpression,
  map: Map<string, string>,
): MathJsonExpression {
  if (typeof expr === 'string') {
    return map.get(expr) ?? expr
  }
  if (Array.isArray(expr)) {
    return expr.map((e, i) =>
      i === 0 && typeof e === 'string' ? e : sanitizeSymbols(e as MathJsonExpression, map),
    ) as unknown as MathJsonExpression
  }
  if (expr && typeof expr === 'object' && 'fn' in (expr as Record<string, unknown>)) {
    const wrapped = expr as unknown as { fn?: unknown; sym?: unknown }
    const inner = sanitizeSymbols((wrapped.fn ?? wrapped.sym) as MathJsonExpression, map)
    return ('sym' in wrapped ? { sym: inner } : { fn: inner }) as unknown as MathJsonExpression
  }
  return expr
}

/** block Cortex's constant folding on greek macros: a bare `\gamma` parses
 * to the EulerGamma CONSTANT (0.5772…) even inside larger expressions, while
 * `\mathrm{gamma}` reliably parses to the plain symbol `gamma`. Rewriting
 * every DECLARED symbol's macro keeps paper parameter names (β, γ, …) as
 * tunable variables, never constants. (Verified in-context: `\gamma{}`
 * still folds inside an Add node; `\mathrm{gamma}` does not.) */
function safeLatexSymbols(latex: string, names: string[]): string {
  let out = latex
  for (const n of names) {
    out = out.replace(new RegExp(`\\\\${n}(?![a-zA-Z])`, 'g'), `\\mathrm{${n}}`)
  }
  return out
}

function compileModelRhs(
  states: string[],
  rhsIn: Record<string, string>,
  paramNames: string[] = [],
): { fns: Record<string, ReturnType<typeof compileFormula>>; map: Map<string, string> } {
  if (!Array.isArray(states) || states.length < 1) {
    throw new Error(`model: states must be a non-empty array, got ${JSON.stringify(states)}`)
  }
  if (new Set(states).size !== states.length) {
    throw new Error(`model: duplicate state names: ${JSON.stringify(states)}`)
  }
  const map = new Map<string, string>()
  ;[...states, ...paramNames].forEach((name, i) => map.set(name, `v${i}`))
  const allNames = [...states, ...paramNames]
  const fns: Record<string, ReturnType<typeof compileFormula>> = {}
  for (const s of states) {
    const latex = String(rhsIn?.[s] ?? '')
    // parse directly (NOT analyzeFormula — classification demands an
    // independent variable like x/t, but an autonomous system's rhs may not
    // mention t at all); Equal equations contribute their RIGHT-hand side
    let box
    try {
      box = getEngine().parse(safeLatexSymbols(latex, allNames))
    } catch {
      throw new Error(`model: right-hand side of state '${s}' failed to parse: ${latex}`)
    }
    if (box.errors.length > 0 || !box.isValid) {
      throw new Error(`model: right-hand side of state '${s}' is invalid LaTeX: ${latex}`)
    }
    let expr: MathJsonExpression = box.json
    if (Array.isArray(expr) && expr[0] === 'Equal' && expr.length >= 3) expr = expr[2] as MathJsonExpression
    const compiled = compileFormula(sanitizeSymbols(expr, map))
    if (!compiled) throw new Error(`model: right-hand side of state '${s}' failed to compile to JS: ${latex}`)
    fns[s] = compiled
  }
  return { fns, map }
}

/** env binding for a sanitized compile: {v_i: value} for every mapped name */
function sanitizedEnv(
  map: Map<string, string>,
  values: Record<string, number>,
): Record<string, number> {
  const env: Record<string, number> = {}
  for (const [name, safe] of map) {
    const v = values[name]
    if (Number.isFinite(v)) env[safe] = v
  }
  return env
}

async function runModelBuild(input: Input, opts: ExecuteOptions): Promise<ExperimentRun> {
  const states = (input.states as string[]) ?? []
  const rhsIn = (input.rhs as Record<string, string>) ?? {}
  const params = (input.params as Record<string, number>) ?? {}
  const initial = (input.initialState as Record<string, number>) ?? {}
  const { fns, map } = compileModelRhs(states, rhsIn, Object.keys(params))

  // verify every rhs evaluates FINITELY at the paper's own initial state —
  // a model that cannot even start is a build failure, not a solve surprise
  for (const s of states) {
    const v = Number(initial[s])
    if (!Number.isFinite(v)) {
      throw new Error(`model.build: initialState must provide a finite value for state '${s}' — the paper's own initials drive the model, nothing is invented`)
    }
  }
  const env = sanitizedEnv(map, { ...params, ...initial })
  const verifiedAt: number[] = states.map((s) => {
    const raw = fns[s]!.run(env)
    const v = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(v)) throw new Error(`model.build: rhs of '${s}' is non-finite at the initial state — check the paper's equations`)
    return v
  })
  const known = new Set(map.values())
  const free = new Set<string>()
  for (const s of states) for (const sym of fns[s]!.freeSymbols) if (!known.has(sym)) free.add(sym)

  return executeSpec(
    {
      kind: 'model.compiled',
      params: { ...params, ...Object.fromEntries(states.map((s) => [s, Number(initial[s])])) },
      seed: 0,
      model: { states, rhs: rhsIn, params, initialState: initial },
      source: opts.source,
    },
    { engine: 'ts-cortex', version: 'model-build@0.1' },
    () => ({
      nStates: states.length,
      verifiedAt: states.map((s, i) => ({ state: s, value: verifiedAt[i] })),
      freeParams: [...free].sort(),
    }),
    { parentRunId: opts.parentRunId },
  )
}

async function runModelSolve(input: Input, opts: ExecuteOptions): Promise<ExperimentRun> {
  const states = (input.states as string[]) ?? []
  const rhsIn = (input.rhs as Record<string, string>) ?? {}
  const params = (input.params as Record<string, number>) ?? {}
  const initial = (input.initialState as Record<string, number>) ?? {}
  const tSpan = input.tSpan as [number, number]
  const steps = typeof input.steps === 'number' && Number.isInteger(input.steps) && input.steps >= 2 ? input.steps : MODEL_SOLVE_STEPS
  const { fns, map } = compileModelRhs(states, rhsIn, Object.keys(params))
  const [t0, t1] = tSpan ?? []
  if (!(t1 > t0) || !Number.isFinite(t0) || !Number.isFinite(t1)) {
    throw new Error('model.solve: tSpan must be [t0,t1] with t1>t0')
  }
  let y0 = states.map((s) => {
    const v = Number(initial[s])
    if (!Number.isFinite(v)) throw new Error(`model.solve: initialState must provide a finite value for state '${s}'`)
    return v
  })

  return executeSpec(
    {
      kind: 'model.solved',
      params: { ...params, ...Object.fromEntries(states.map((s, i) => [s, y0[i]])) },
      seed: 0,
      model: { states, rhs: rhsIn, params, initialState: initial, tSpan, steps },
      source: opts.source,
    },
    { engine: 'ts-rk4', version: 'model-rk4@0.1' },
    () => {
      const h = (t1 - t0) / steps
      const f = (y: number[]): number[] => {
        const env = sanitizedEnv(
          map,
          { ...params, ...Object.fromEntries(states.map((s, i) => [s, y[i]])) },
        )
        return states.map((s) => {
          const raw = fns[s]!.run(env)
          return typeof raw === 'number' ? raw : Number(raw)
        })
      }
      const emitEvery = Math.max(1, Math.round(steps / 240))
      const ts: number[] = [t0]
      const series: Array<number[]> = states.map((_, i) => [y0[i]])
      const perState = states.map((s, i) => ({ state: s, min: y0[i], max: y0[i] }))
      let y = y0.slice()
      for (let i = 1; i <= steps; i++) {
        const k1 = f(y)
        const k2 = f(y.map((v, j) => v + (h / 2) * k1[j]))
        const k3 = f(y.map((v, j) => v + (h / 2) * k2[j]))
        const k4 = f(y.map((v, j) => v + h * k3[j]))
        y = y.map((v, j) => v + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]))
        for (let j = 0; j < y.length; j++) {
          if (!Number.isFinite(y[j]) || Math.abs(y[j]) > 1e8) {
            throw new Error(`model.solve: state '${states[j]}' diverged at t=${(t0 + i * h).toFixed(3)} — check the paper's equations/parameters`)
          }
          perState[j].min = Math.min(perState[j].min, y[j])
          perState[j].max = Math.max(perState[j].max, y[j])
        }
        if (i % emitEvery === 0 || i === steps) {
          ts.push(t0 + i * h)
          states.forEach((_, j) => series[j].push(y[j]))
        }
      }
      // period of the FIRST state via midline rising-crossings (same logic as
      // ode.phase: orbits oscillate around their equilibrium, not around 0)
      const s0 = series[0]
      let min = Infinity
      let max = -Infinity
      for (const v of s0) { if (v < min) min = v; if (v > max) max = v }
      const mid = (min + max) / 2
      const crossings: number[] = []
      for (let i = 1; i < s0.length; i++) {
        if (s0[i - 1] < mid && s0[i] >= mid) {
          const frac = (mid - s0[i - 1]) / (s0[i] - s0[i - 1] || 1e-12)
          crossings.push(ts[i - 1] + frac * (ts[i] - ts[i - 1]))
        }
      }
      let period0: number | null = null
      if (crossings.length >= 2) {
        const gaps = crossings.slice(1).map((c, i) => c - crossings[i])
        period0 = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
      }
      return {
        t: ts,
        series: states.map((s, j) => ({ state: s, values: series[j] })),
        perState,
        period0,
        steps,
      }
    },
    { parentRunId: opts.parentRunId },
  )
}

// ---- orchestration skills ---------------------------------------------------

const COMPUTE_BY_KIND: Record<string, string> = {
  'formula.curve': 'formula.plot',
  'formula.value': 'formula.evaluate',
  'model.compiled': 'model.build',
  'model.solved': 'model.solve',
  'kakeya.voxel': 'kakeya.measure',
  'kakeya.geometry': 'kakeya.generate',
  'kakeya.sweep': 'kakeya.sweep',
  'perron.tree': 'geometry.2d',
  'lv.ode': 'ode.solve',
  'ode.phase2': 'ode.phase',
  'mujoco.sim': 'mujoco.simulate',
  'challenge.attempt': 'challenge.attempt',
}

// ---------------------------------------------------------------------------
// Engine-side skill runners: skills whose kernels need Node-only facilities
// (e.g. the MuJoCo WASM module's VFS) register their implementation from the
// engine process. The browser bundle sees the SAME registry entry and an
// honest "engine-only" answer — numbers never differ between surfaces.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const extraRunners = new Map<string, (input: any, opts: ExecuteOptions) => Promise<ExperimentRun>>()

/** register an engine-side implementation for a skill (Node-only kernels) */
export function registerSkillRunner(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runner: (input: any, opts: ExecuteOptions) => Promise<ExperimentRun>,
): void {
  extraRunners.set(name, runner)
}

/** the replayable skill input of a historical run (agent chaining: a follow-up
 *  turn uses this as its base instead of the original first-run input) */
export function inputForRun(runId: string): { skill: string; input: Input } | { error: string } {
  const run = getExperimentRun(runId)
  if (!run) return { error: `Unknown run: ${runId}` }
  const skillName = COMPUTE_BY_KIND[run.spec.kind]
  if (!skillName) return { error: `No compute skill mapped for kind ${run.spec.kind}` }
  const input = inputFromSpec(skillName, run)
  if (!input) return { error: `Run ${runId} spec lacks the model fields needed for replay` }
  return { skill: skillName, input }
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

/** merge fork parameterChanges into each skill's REAL nested input shape */
function applyForkChanges(skillName: string, forkInput: Input, changes: Record<string, number>): void {
  if (Object.keys(changes).length === 0) return
  switch (skillName) {
    case 'formula.plot': {
      const values = (forkInput.values as Record<string, number>) ?? {}
      const unknown = Object.keys(changes).filter((k) => !(k in values))
      if (unknown.length) throw new Error(`fork(formula.plot): unknown parameters ${JSON.stringify(unknown)} — known: ${JSON.stringify(Object.keys(values))}`)
      forkInput.values = { ...values, ...changes }
      return
    }
    case 'formula.evaluate': {
      const bindings = (forkInput.bindings as Record<string, number>) ?? {}
      const unknown = Object.keys(changes).filter((k) => !(k in bindings))
      if (unknown.length) throw new Error(`fork(formula.evaluate): unknown bindings ${JSON.stringify(unknown)}`)
      forkInput.bindings = { ...bindings, ...changes }
      return
    }
    case 'ode.solve': {
      // parameters live in system.params; initial populations in initialValues
      // (spec.model records are frozen — clone before mutating)
      const sys = (forkInput.system as { kind?: string; params?: Record<string, number> }) ?? {}
      const params: Record<string, number> = { ...(sys.params ?? {}) }
      const init: Record<string, number> = { ...((forkInput.initialValues as Record<string, number>) ?? {}) }
      for (const [k, v] of Object.entries(changes)) {
        if (k in params) params[k] = v
        else if (k in init) init[k] = v
        else throw new Error(`fork(ode.solve): unknown change '${k}' — not a system param or initial value`)
      }
      forkInput.system = { ...sys, params }
      forkInput.initialValues = init
      return
    }
    case 'model.build':
    case 'model.solve': {
      // parameters live at input.params (nominal bindings). initialState is
      // the PAPER'S OWN evidence — forks change parameters, never initials
      const params = { ...((forkInput.params as Record<string, number>) ?? {}) }
      for (const [k, v] of Object.entries(changes)) {
        if (!(k in params)) {
          throw new Error(`fork(${skillName}): unknown parameter '${k}' — known: ${JSON.stringify(Object.keys(params))}`)
        }
        params[k] = v
      }
      forkInput.params = params
      return
    }
    case 'geometry.2d': {
      // construction decides which keys are meaningful (k/alpha for perron, grid
      // for needle); inputFromSpec packs the model as params — clone first
      const params: Record<string, number> = { ...((forkInput.params as Record<string, number>) ?? {}) }
      const unknown = Object.keys(changes).filter((k) => !(k in params))
      if (unknown.length) throw new Error(`fork(geometry.2d): unknown parameters ${JSON.stringify(unknown)}`)
      Object.assign(params, changes)
      forkInput.params = params
      return
    }
    case 'kakeya.measure':
    case 'kakeya.generate':
    case 'kakeya.sweep': {
      // these skills read params at the top level — but only known keys
      const known = ['deltaExp', 'nTubes', 'packing', 'res']
      const unknown = Object.keys(changes).filter((k) => !known.includes(k))
      if (unknown.length) throw new Error(`fork(${skillName}): unknown parameters ${JSON.stringify(unknown)} — known: ${JSON.stringify(known)}`)
      Object.assign(forkInput, changes)
      return
    }
    case 'mujoco.simulate': {
      // physics params live in the nested `params` object; forces (event
      // replay) survive a fork untouched — only numeric params change
      const params = { ...((forkInput.params as Record<string, unknown>) ?? {}) }
      const known = ['gravityZ', 'windX', 'timestep']
      const unknown = Object.keys(changes).filter((k) => !known.includes(k))
      if (unknown.length) throw new Error(`fork(mujoco.simulate): unknown parameters ${JSON.stringify(unknown)} — known: ${JSON.stringify(known)}`)
      Object.assign(params, changes)
      forkInput.params = params
      return
    }
    default:
      throw new Error(`fork: parameter changes not supported for skill ${skillName}`)
  }
}

function inputFromSpec(skillName: string, run: ExperimentRun): Input | null {  const model = run.spec.model as Record<string, unknown> | undefined
  if (skillName === 'challenge.attempt') {
    if (!model?.challenge) return null
    return {
      challenge: model.challenge,
      changes: { ...(model.changes ?? {}) },
      level: { ...(model.level ?? {}) },
    }
  }
  if (skillName === 'mujoco.simulate') {
    if (!model?.scene) return null
    const params = (model.params ?? {}) as Record<string, unknown>
    return {
      scene: model.scene,
      steps: model.steps ?? 100,
      sampleEvery: model.sampleEvery ?? 10,
      // forces are part of the event contract — replay/fork keep them
      params: { ...params, ...(Array.isArray(params.forces) ? { forces: params.forces } : {}) },
    }
  }
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
  if (skillName === 'model.build') {
    return {
      states: model?.states ?? [],
      rhs: model?.rhs ?? {},
      params: model?.params ?? {},
      initialState: model?.initialState ?? {},
    }
  }
  if (skillName === 'model.solve') {
    return {
      states: model?.states ?? [],
      rhs: model?.rhs ?? {},
      params: model?.params ?? {},
      initialState: model?.initialState ?? {},
      tSpan: model?.tSpan ?? [0, 20],
      steps: model?.steps,
    }
  }
  return null
}

// ---- the single entry -------------------------------------------------------

/** skills whose runs are formal evidence and therefore need a PlayPlan */
const FORMAL_SKILLS = new Set(['formula.plot', 'formula.evaluate', 'kakeya.generate', 'kakeya.measure', 'kakeya.sweep', 'geometry.2d', 'ode.solve', 'model.build', 'model.solve', 'mujoco.simulate', 'challenge.attempt'])

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
      skill: skill.name,
      message: skill.unavailableReason ?? `${skill.name} is registered but not wired to the unified executor yet`,
    }
  }
  // canonical aliases resolve to the registry name BEFORE dispatch, so every
  // accepted name runs the same implementation (AGENTS §4 vocabulary)
  if (skill.name !== name) name = skill.name
  const inputError = schemaError(skill.inputSchema, input, name)
  if (inputError) return { status: 'error', code: 'invalid_input', message: inputError }
  if (FORMAL_SKILLS.has(name) && !opts.replay) {
    // #32: a bare planId string proves nothing — the plan must be REGISTERED
    // (builder/plan-op) and COVER this skill. Env escape hatch is for local
    // probes only; the browser has none.
    const allowUnregistered = (() => {
      try {
        return (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.PAPER2LAB_ALLOW_UNREGISTERED_PLANS === '1'
      } catch {
        return false
      }
    })()
    if (!opts.planId) {
      return { status: 'needs_input', missing: ['planId'], message: `${name} refuses to run without a PlayPlan` }
    }
    if (!allowUnregistered) {
      const registered = getPlan(opts.planId)
      if (!registered) {
        return {
          status: 'needs_input',
          missing: ['plan'],
          message: `planId '${opts.planId.slice(0, 40)}' is not a registered PlayPlan — submit the full plan (plan op / inline plan field) before executing ${name}`,
        }
      }
      if (!planCoversSkill(registered, name)) {
        return {
          status: 'needs_input',
          missing: ['plan.skill'],
          message: `PlayPlan '${registered.planId}' (skill ${registered.skill}) does not cover '${name}' — a plan governs its own experiment`,
        }
      }
    }
  }
  try {
    if (name === 'formula.evaluate') return { status: 'ok', run: (await runFormulaEvaluate(input as Input)) as ExperimentRun<T> }
    if (name === 'formula.plot') return { status: 'ok', run: (await runFormulaPlot(input as Input, opts)) as ExperimentRun<T> }
    if (name === 'kakeya.generate') return { status: 'ok', run: (await runKakeyaGenerate(input as Input, opts)) as ExperimentRun<T> }
    if (name === 'kakeya.measure') return { status: 'ok', run: (await runKakeyaMeasure(input as Input, opts)) as ExperimentRun<T> }
    if (name === 'kakeya.sweep') return { status: 'ok', run: (await runKakeyaSweep(input as Input, opts)) as ExperimentRun<T> }
    if (name === 'geometry.2d') return { status: 'ok', run: (await runGeometry2D(input as Input, opts)) as ExperimentRun<T> }
    if (name === 'ode.solve') return { status: 'ok', run: (await runOdeSolve(input as Input, opts)) as ExperimentRun<T> }
    if (name === 'ode.phase') return { status: 'ok', run: (await runOdePhase(input as Input, opts)) as ExperimentRun<T> }
    if (name === 'model.build') return { status: 'ok', run: (await runModelBuild(input as Input, opts)) as ExperimentRun<T> }
    if (name === 'model.solve') return { status: 'ok', run: (await runModelSolve(input as Input, opts)) as ExperimentRun<T> }
    if (name === 'experiment.fork') {
      const { sourceRunId, parameterChanges = {} } = input as { sourceRunId: string; parameterChanges?: Record<string, number> }
      const source = getExperimentRun(sourceRunId)
      if (!source) return { status: 'error', code: 'invalid_input', message: `Unknown run: ${sourceRunId}` }
      const skillName = COMPUTE_BY_KIND[source.spec.kind]
      if (!skillName) return { status: 'unsupported', skill: source.spec.kind, message: 'Source run kind has no compute skill' }
      const forkInput = inputFromSpec(skillName, source)
      if (!forkInput) return { status: 'error', code: 'invalid_input', message: 'Source run spec cannot be replayed' }
      // merge parameterChanges into each skill's ACTUAL nested input shape —
      // top-level Object.assign used to silently recompute the unchanged
      // experiment for every non-formula skill (review finding)
      applyForkChanges(skillName, forkInput, parameterChanges)
      const outcome = await executeSkill(skillName, forkInput, {
        planId: `fork:${sourceRunId}`,
        replay: true,
        parentRunId: sourceRunId,
        // Lane A source inheritance: a fork keeps its parent's provenance
        // anchor (paper/doc reference) — losing it orphaned desk charts
        source: source.spec.source,
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
    if (name === 'mujoco.simulate' || name === 'challenge.attempt') {
      const runner = extraRunners.get(name)
      if (!runner) {
        return {
          status: 'unsupported',
          skill: name,
          message: `${name} runs in the backend engine (Node WASM) — use server execution mode / the engine API; the page imports the resulting Runs`,
        }
      }
      return { status: 'ok', run: (await runner(input as Input, opts)) as ExperimentRun<T> }
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
