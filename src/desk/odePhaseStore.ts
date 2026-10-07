// ODE phase-plane experiment store (#24) — one instance per uploaded ODE
// paper's lab. The system (states + paper LaTeX right-hand sides) comes from
// the ROUTER'S binding (odeSystemOf), never invented here. Drag contract
// mirrors #23: pointer MOVE runs a local coarse preview through the SAME
// compiled kernels; pointer UP commits the exact run through the unified
// executor (ode.phase, RK4 2400 steps) — phase plane, time series and period
// all read from that ONE run. Every released initial point is kept in
// history so the agent (and the user) can compare trajectories.
import type { ExperimentRun } from '../experiments/protocol'
import { analyzeFormula } from '../formula/analyze'
import { compileFormula, type CompiledFormula } from '../formula/compile'
import { executeSkill } from '../skills/executor'
import { buildPlan, type PlayPlan } from '../skills/playPlan'

/** registered config (#24): preview integration steps during a drag */
export const ODE_PREVIEW_STEPS = 400

export interface OdePhaseResult {
  t: number[]
  s0: number[]
  s1: number[]
  period0: number | null
  maxAbs0: number
  maxAbs1: number
}
export type OdePhaseRun = ExperimentRun<OdePhaseResult>

export interface OdePhaseExperiment {
  id: string
  states: [string, string]
  /** paper LaTeX per state (RHS only, no LHS) — recorded into every run spec */
  rhs: [string, string]
  /** constant symbols beyond the two states, bound from the paper/binding */
  params: Record<string, number>
  initial: [number, number]
  tSpan: [number, number]
  /** exact committed run (the evidence) */
  run: OdePhaseRun | null
  /** drag-time preview trajectory (local kernels, coarse) — not evidence */
  preview: { initial: [number, number]; t: number[]; s0: number[]; s1: number[] } | null
  status: 'stale' | 'computing' | 'resolved' | 'error'
  error?: string
  /** every released initial point with its run id (Data → Experiment) */
  history: Array<{ initial: [number, number]; runId: string }>
}

/** compile a paper RHS into (x, y) → f (same Cortex path the executor uses) */
export function compileRhsFn(latex: string, states: [string, string]): ((x: number, y: number) => number) | null {
  const a = analyzeFormula(latex)
  if (!a.ok) return null
  const compiled: CompiledFormula | null = compileFormula(a.rhs)
  if (!compiled) return null
  const [s0, s1] = states
  return (x: number, y: number) => {
    const raw = compiled.run({ [s0]: x, [s1]: y })
    return typeof raw === 'number' ? raw : Number(raw)
  }
}

/** coarse local RK4 for drag previews (same kernels, fewer steps) */
export function previewTrajectory(
  f0: (x: number, y: number) => number,
  f1: (x: number, y: number) => number,
  initial: [number, number],
  tSpan: [number, number],
): { t: number[]; s0: number[]; s1: number[] } {
  const [t0, t1] = tSpan
  const h = (t1 - t0) / ODE_PREVIEW_STEPS
  let x = initial[0]
  let y = initial[1]
  const t: number[] = [t0]
  const s0: number[] = [x]
  const s1: number[] = [y]
  for (let i = 1; i <= ODE_PREVIEW_STEPS; i++) {
    const k1x = f0(x, y), k1y = f1(x, y)
    const k2x = f0(x + (h / 2) * k1x, y + (h / 2) * k1y), k2y = f1(x + (h / 2) * k1x, y + (h / 2) * k1y)
    const k3x = f0(x + (h / 2) * k2x, y + (h / 2) * k2y), k3y = f1(x + (h / 2) * k2x, y + (h / 2) * k2y)
    const k4x = f0(x + h * k3x, y + h * k3y), k4y = f1(x + h * k3x, y + h * k3y)
    x += (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x)
    y += (h / 6) * (k1y + 2 * k2y + 2 * k3y + k4y)
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e8 || Math.abs(y) > 1e8) break
    t.push(t0 + i * h)
    s0.push(x)
    s1.push(y)
  }
  return { t, s0, s1 }
}

export class OdePhaseStore {
  private experiments = new Map<string, OdePhaseExperiment>()
  private kernels = new Map<string, { f0: (x: number, y: number) => number; f1: (x: number, y: number) => number }>()
  private plans = new Map<string, PlayPlan>()
  private listeners = new Set<() => void>()
  private version = 0
  private seq = 0
  /** latest-wins guard: only the newest released initial commits (#23 rule) */
  private commitSeq = new Map<string, number>()

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getVersion = () => this.version
  getSnapshot = () => this.version
  private notify() {
    this.version++
    for (const l of this.listeners) l()
  }

  get(id: string): OdePhaseExperiment | undefined {
    return this.experiments.get(id)
  }

  kernelsOf(id: string) {
    return this.kernels.get(id)
  }

  /** create from a routed paper binding: paper latex RHS, paper initials */
  create(
    id: string,
    init: {
      states: [string, string]
      rhs: [string, string]
      params?: Record<string, number>
      initial: [number, number]
      tSpan?: [number, number]
    },
  ): OdePhaseExperiment {
    if (this.experiments.has(id)) return this.experiments.get(id)!
    const ex: OdePhaseExperiment = {
      id,
      states: init.states,
      rhs: init.rhs,
      params: init.params ?? {},
      initial: init.initial,
      tSpan: init.tSpan ?? [0, 20],
      run: null,
      preview: null,
      status: 'stale',
      history: [],
    }
    const f0 = compileRhsFn(init.rhs[0], init.states)
    const f1 = compileRhsFn(init.rhs[1], init.states)
    if (!f0 || !f1) throw new Error('ODE 右端编译失败——论文公式无法执行')
    this.kernels.set(id, { f0, f1 })
    this.plans.set(id, buildPlan({
      skill: 'ode.phase',
      goal: `从论文初值 (${init.initial[0]}, ${init.initial[1]}) 出发积分论文方程，观察轨迹/周期随初值的变化`,
      metrics: ['trajectory', 'period0'],
      inputs: { states: init.states, rhs: init.rhs, tSpan: init.tSpan ?? [0, 20] },
    }))
    this.experiments.set(id, ex)
    void this.commit(id, [...ex.initial])
    return ex
  }

  /** drag MOVE: local coarse preview through the same kernels — no executor */
  setPreviewInitial(id: string, x: number, y: number) {
    const ex = this.experiments.get(id)
    const k = this.kernels.get(id)
    if (!ex || !k) return
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    ex.initial = [x, y]
    try {
      const traj = previewTrajectory(k.f0, k.f1, [x, y], ex.tSpan)
      ex.preview = { initial: [x, y], ...traj }
      ex.status = 'stale'
      ex.error = undefined
    } catch {
      ex.preview = null
    }
    this.notify()
  }

  /** drag RELEASE (or programmatic set): the EXACT run via the executor */
  async release(id: string, x?: number, y?: number): Promise<OdePhaseRun | null> {
    const ex = this.experiments.get(id)
    if (!ex) return null
    if (x !== undefined && y !== undefined) ex.initial = [x, y]
    return this.commit(id, [...ex.initial] as [number, number])
  }

  private async commit(id: string, initial: [number, number]): Promise<OdePhaseRun | null> {
    const ex = this.experiments.get(id)
    if (!ex) return null
    const seq = (this.commitSeq.get(id) ?? 0) + 1
    this.commitSeq.set(id, seq)
    ex.status = 'computing'
    ex.preview = null
    this.notify()
    const [s0name, s1name] = ex.states
    try {
      const outcome = await executeSkill<OdePhaseResult>(
        'ode.phase',
        {
          system: { kind: 'generic2', states: ex.states, rhs: { [s0name]: ex.rhs[0], [s1name]: ex.rhs[1] }, params: ex.params },
          initialState: { [s0name]: initial[0], [s1name]: initial[1] },
          tSpan: ex.tSpan,
        },
        { planId: this.plans.get(id)?.planId ?? `ode-phase-${id}` },
      )
      if (this.commitSeq.get(id) !== seq) return null // superseded by a newer release
      if (outcome.status !== 'ok' || !outcome.run?.result) {
        throw new Error(outcome.status === 'error' ? outcome.message : `ode.phase returned ${outcome.status}`)
      }
      ex.run = outcome.run as OdePhaseRun
      ex.initial = initial
      ex.status = 'resolved'
      ex.error = undefined
      ex.history.push({ initial, runId: outcome.run.runId })
      this.notify()
      return ex.run
    } catch (err) {
      if (this.commitSeq.get(id) !== seq) return null
      ex.status = 'error'
      ex.error = err instanceof Error ? err.message : String(err)
      this.notify()
      return null
    }
  }

  nextId(): string {
    return `ode-${Date.now().toString(36)}-${(this.seq++).toString(36)}`
  }
}

export const odePhaseStore = new OdePhaseStore()
