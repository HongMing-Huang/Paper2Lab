// Explorer store — one instance per formula experiment. Parameter cells live
// in an Observable Runtime module (CAScad-style dependency graph): dragging a
// chip calls module.redefine(param), the `curveRun` cell recomputes the
// sampled curve through the Cortex-compiled JS function, and the result is
// wrapped as an ExperimentRun (v4 traceability: every visible number — LOCAL
// CALC badge, peak, integral — comes from a run, never from the model).
import { Runtime, type Module } from '@observablehq/runtime'
import { ENGINES, type ExperimentRun } from '../experiments/protocol'
import type { CompiledFormula } from '../formula/compile'
import type { FormulaExplorerSpec } from '../formula/spec'
import { analyzeFormula } from '../formula/analyze'
import { buildFormulaPlayPlan, type PlayPlan } from '../skills/playPlan'
import { getSkill, validateSkillInput } from '../skills/registry'
import { executeSkill } from '../skills/executor'

/** registered config (AGENTS.md §2 v5 audit): sampling density of the curve */
export const CURVE_SAMPLES = 361
/** drag-time PREVIEW grid (#23): the pointer-up commit re-runs at
 * CURVE_SAMPLES through the exact skill path. Preview uses the SAME
 * compiled kernel, fewer samples — presentation, kind says so. */
export const PREVIEW_SAMPLES = 61

export interface CurveResult {
  points: Array<[number, number]>
  /** max |y| over the grid */
  peak: number
  /** trapezoid ∫|y|dx over the grid */
  integral: number
}
export type CurveRun = ExperimentRun<CurveResult>

export interface Explorer {
  id: string
  spec: FormulaExplorerSpec
  compiled: CompiledFormula | null
  params: Record<string, number>
  run: CurveRun | null
  /** drag-time preview (same compiled kernel, PREVIEW_SAMPLES grid) — shown
   * while dragging; the exact run below replaces it on commit (#23) */
  previewRun: CurveRun | null
  dragging: boolean
  parentRunId?: string
  plan: PlayPlan
  status: 'stale' | 'computing' | 'resolved' | 'error'
  error?: string
}

export type FormulaCell = (name: string) => {
  pending: () => void
  fulfilled: (value: unknown) => void
  rejected: (error: Error) => void
}

/** preview curve through the explorer's OWN compiled kernel at the preview
 * grid — mirrors runFormulaPlot's sampling loop exactly (peak / trapezoid
 * ∫|y|dx), only the sample count differs. Presentation envelope, not the
 * exact evidence run (spec.kind says formula.preview). */
function computePreviewRun(ex: Explorer): CurveRun {
  const spec = ex.spec
  const compiled = ex.compiled!
  const [x0, x1] = spec.independent.range
  const startedAt = Date.now()
  const t0 = performance.now()
  const points: Array<[number, number]> = []
  let peak = 0
  let integral = 0
  let previous: [number, number] | null = null
  for (let i = 0; i < PREVIEW_SAMPLES; i++) {
    const x = x0 + ((x1 - x0) * i) / (PREVIEW_SAMPLES - 1)
    const raw = compiled.run({ ...ex.params, [spec.independent.name]: x })
    const y = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(y)) throw new Error(`preview: non-finite value at ${spec.independent.name}=${x}`)
    points.push([x, y])
    peak = Math.max(peak, Math.abs(y))
    if (previous) integral += ((Math.abs(y) + Math.abs(previous[1])) * (x - previous[0])) / 2
    previous = [x, y]
  }
  return {
    runId: `formula-preview-${startedAt.toString(36)}-${Math.round(Math.random() * 1e6).toString(36)}`,
    spec: {
      kind: 'formula.preview',
      params: { ...ex.params },
      seed: 0,
      model: { samples: PREVIEW_SAMPLES, preview: true, independent: spec.independent.name, range: [x0, x1] },
    },
    status: 'resolved',
    result: { points, peak, integral },
    engine: ENGINES.cortexJs.engine,
    engineVersion: ENGINES.cortexJs.version,
    durationMs: performance.now() - t0,
    evidence: 'CALCULATED',
    createdAt: startedAt,
    startedAt,
    errors: [],
  }
}

export class ExplorerStore {
  private explorers = new Map<string, Explorer>()
  private listeners = new Set<() => void>()
  private runtimes = new Map<string, { runtime: Runtime; module: Module }>()
  private version = 0
  private seq = 0

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getVersion = () => this.version
  private notify() {
    this.version++
    for (const l of this.listeners) l()
  }

  get(id: string): Explorer | undefined {
    return this.explorers.get(id)
  }

  ids(): string[] {
    return [...this.explorers.keys()]
  }

  /** create explorer + observable module; emits the first run synchronously-ish */
  create(id: string, spec: FormulaExplorerSpec, compiled: CompiledFormula | null, parentRunId?: string, binding?: PlayPlan['binding']): Explorer {
    const params = Object.fromEntries(spec.parameters.map((p) => [p.name, p.default]))
    if (!compiled) throw new Error('Formula has no executable kernel')
    const plan = buildFormulaPlayPlan(analyzeFormula(spec.anchor.latex), spec.anchor, spec.anchor.docId, getSkill('formula.plot')!, binding)
    const validation = validateSkillInput(plan.skill, plan.inputs)
    if (!validation.ok) throw new Error(validation.error)
    const ex: Explorer = { id, spec, compiled, params, run: null, previewRun: null, dragging: false, parentRunId, plan, status: 'computing' }
    this.explorers.set(id, ex)

    const runtime = new Runtime()
    const module = runtime.module()
    const paramNames = spec.parameters.map((p) => p.name)
    for (const p of spec.parameters) {
      module.variable().define(p.name, p.default)
    }
    module
      .variable({
        fulfilled: (value: unknown) => {
          const ex0 = this.explorers.get(id)
          if (ex0) {
            const run = value as CurveRun
            if (!Object.entries(ex0.params).every(([k, v]) => run.spec.params[k] === v)) return
            ex0.run = run
            ex0.status = 'resolved'
            ex0.error = undefined
            this.notify()
          }
        },
        rejected: (err: Error) => {
          ex.status = 'error'
          ex.error = err.message
          this.notify()
        },
      })
      .define(
        'curveRun',
        compiled ? [...paramNames] : [],
        compiled
          ? async (...values: number[]) => {
              const paramsNow = Object.fromEntries(paramNames.map((n, i) => [n, values[i]]))
              // UI path goes through the SAME unified executor as the agent
              // and headless clients (AGENTS.md v6 §0.7) — no parallel math.
              const outcome = await executeSkill<CurveResult>(
                'formula.plot',
                {
                  expression: spec.rhs,
                  parameters: paramNames,
                  independent: spec.independent.name,
                  range: spec.independent.range,
                  values: paramsNow,
                  samples: CURVE_SAMPLES,
                },
                { planId: plan.planId, parentRunId: ex.parentRunId, source: spec.anchor },
              )
              if (outcome.status !== 'ok' || !outcome.run) {
                throw new Error(outcome.status === 'error' ? outcome.message : `formula.plot returned ${outcome.status}`)
              }
              return outcome.run as CurveRun
            }
          : () => null,
      )
    this.runtimes.set(id, { runtime, module })
    this.notify()
    return ex
  }

  /** param update with the #23 drag contract:
   *  - { preview: true } (pointer MOVE): update params + compute a cheap
   *    preview locally (same kernel, PREVIEW_SAMPLES) — NO executor round
   *    trip, the chart follows the pointer
   *  - default / { preview: false } (pointer UP / keyboard / agent): the
   *    exact path — redefine cells → formula.plot at CURVE_SAMPLES; an empty
   *    patch commits the CURRENT params (drag-end commit) */
  setParams(id: string, patch: Record<string, number>, opts: { preview?: boolean } = {}) {
    const ex = this.explorers.get(id)
    const rt = this.runtimes.get(id)
    if (!ex || !rt) return
    for (const [k, v] of Object.entries(patch)) {
      const param = ex.spec.parameters.find((p) => p.name === k)
      if (!param || !Number.isFinite(v) || v < param.min || v > param.max) {
        throw new Error(`Invalid parameter ${k}: ${v}`)
      }
    }
    if (opts.preview) {
      for (const [k, v] of Object.entries(patch)) ex.params[k] = v
      ex.dragging = true
      ex.status = 'stale'
      try {
        ex.previewRun = computePreviewRun(ex)
      } catch {
        ex.previewRun = null // preview is best-effort; exact commit will surface errors
      }
      this.notify()
      return
    }
    // exact commit
    ex.dragging = false
    ex.previewRun = null
    ex.status = 'stale'
    const effective = Object.keys(patch).length > 0 ? patch : ex.params
    for (const [k, v] of Object.entries(effective)) {
      ex.params[k] = v
      rt.module.redefine(k, v)
    }
    this.notify()
  }

  /** fork: clone params into a new explorer id */
  fork(srcId: string, newId: string): Explorer | null {
    const src = this.explorers.get(srcId)
    if (!src) return null
    const ex = this.create(newId, src.spec, src.compiled, src.run?.runId)
    this.setParams(newId, { ...src.params })
    return ex
  }

  /** Only settle a result for the requested parameters; never accept an old run. */
  waitForRun(id: string, timeoutMs = 4000): Promise<CurveRun> {
    const ex = this.get(id)
    if (!ex) return Promise.reject(new Error('Experiment not found'))
    const expected = { ...ex.params }
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {}
      const timer = setTimeout(() => { unsubscribe(); reject(new Error('Experiment timed out')) }, timeoutMs)
      const check = () => {
        const current = this.get(id)
        if (!current || !Object.entries(expected).every(([k, v]) => current.params[k] === v)) {
          clearTimeout(timer); unsubscribe(); reject(new Error('Experiment inputs changed during execution')); return
        }
        if (current.status === 'error') {
          clearTimeout(timer); unsubscribe(); reject(new Error(current.error)); return
        }
        const run = current.run
        if (current.status === 'resolved' && run?.result && Object.entries(expected).every(([k, v]) => run.spec.params[k] === v)) {
          clearTimeout(timer); unsubscribe(); resolve(run)
        }
      }
      unsubscribe = this.subscribe(check)
      check()
    })
  }

  dispose(id: string) {
    const rt = this.runtimes.get(id)
    rt?.runtime.dispose()
    this.runtimes.delete(id)
    this.explorers.delete(id)
    this.notify()
  }

  nextId(): string {
    return `explorer-${Date.now().toString(36)}-${(this.seq++).toString(36)}`
  }
}

export const explorerStore = new ExplorerStore()
