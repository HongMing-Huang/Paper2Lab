// Explorer store — one instance per formula experiment. Parameter cells live
// in an Observable Runtime module (CAScad-style dependency graph): dragging a
// chip calls module.redefine(param), the `curveRun` cell recomputes the
// sampled curve through the Cortex-compiled JS function, and the result is
// wrapped as an ExperimentRun (v4 traceability: every visible number — LOCAL
// CALC badge, peak, integral — comes from a run, never from the model).
import { Runtime, type Module } from '@observablehq/runtime'
import { ENGINES, executeSpec, type ExperimentRun } from '../experiments/protocol'
import type { CompiledFormula } from '../formula/compile'
import type { FormulaExplorerSpec } from '../formula/spec'

/** registered config (AGENTS.md §2 v5 audit): sampling density of the curve */
export const CURVE_SAMPLES = 361

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
}

export type FormulaCell = (name: string) => {
  pending: () => void
  fulfilled: (value: unknown) => void
  rejected: (error: Error) => void
}

class ExplorerStore {
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
  create(id: string, spec: FormulaExplorerSpec, compiled: CompiledFormula | null): Explorer {
    const params = Object.fromEntries(spec.parameters.map((p) => [p.name, p.default]))
    const ex: Explorer = { id, spec, compiled, params, run: null }
    this.explorers.set(id, ex)

    const runtime = new Runtime()
    const module = runtime.module()
    const paramNames = spec.parameters.map((p) => p.name)
    for (const p of spec.parameters) {
      module.variable().define(p.name, p.default)
    }
    const indep = spec.independent.name
    module
      .variable({
        fulfilled: (value: unknown) => {
          const ex0 = this.explorers.get(id)
          if (ex0) {
            ex0.run = value as CurveRun
            this.notify()
          }
        },
        rejected: (err: Error) => {
          console.error('[explorerStore] curveRun rejected', err)
        },
      })
      .define(
        'curveRun',
        compiled ? [...paramNames] : [],
        compiled
          ? async (...values: number[]) => {
              const paramsNow = Object.fromEntries(paramNames.map((n, i) => [n, values[i]]))
              return executeSpec<CurveResult>(
                {
                  kind: 'formula.curve',
                  params: { ...paramsNow },
                  seed: 0,
                },
                ENGINES.cortexJs,
                () => {
                  const [x0, x1] = spec.independent.range
                  const points: Array<[number, number]> = []
                  let peak = 0
                  let integral = 0
                  let prevAbs = 0
                  for (let i = 0; i < CURVE_SAMPLES; i++) {
                    const x = x0 + ((x1 - x0) * i) / (CURVE_SAMPLES - 1)
                    const y = compiled.run({ ...paramsNow, [indep]: x })
                    if (Number.isFinite(y)) {
                      points.push([x, y])
                      peak = Math.max(peak, Math.abs(y))
                      if (i > 0) integral += (Math.abs(y) + prevAbs) * (x - (x0 + ((x1 - x0) * (i - 1)) / (CURVE_SAMPLES - 1))) / 2
                      prevAbs = Math.abs(y)
                    }
                  }
                  return { points, peak, integral }
                },
              )
            }
          : () => null,
      )
    this.runtimes.set(id, { runtime, module })
    this.notify()
    return ex
  }

  /** drag-time param update: redefine the observable cell, chart follows */
  setParams(id: string, patch: Record<string, number>) {
    const ex = this.explorers.get(id)
    const rt = this.runtimes.get(id)
    if (!ex || !rt) return
    for (const [k, v] of Object.entries(patch)) {
      ex.params[k] = v
      rt.module.redefine(k, v)
    }
    this.notify()
  }

  /** fork: clone params into a new explorer id */
  fork(srcId: string, newId: string): Explorer | null {
    const src = this.explorers.get(srcId)
    if (!src) return null
    const ex = this.create(newId, src.spec, src.compiled)
    this.setParams(newId, { ...src.params })
    return ex
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
