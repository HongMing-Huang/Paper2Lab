// Agent step runner — executes a plan's step ops STRICTLY through the
// registered skills (executeSkill), so a headless/server agent turn produces
// the same registry-validated, plan-gated, real-kernel ExperimentRuns the
// browser produces. Steps are the SOP/LLM planner vocabulary:
//   experiment.fork / formula.set|scale|plot / kakeya.halve-n|set|measure|sweep
//   ode.set|scale|solve / geometry.set|scale|plot / experiment.compare
//
// Semantics mirror src/skills/formulaExecutor.ts: parameter ops accumulate and
// materialise as an experiment.fork of the base (or last) run at the next
// terminal op — the agent never mutates an experiment in place (lineage is
// preserved), and every number comes back inside an ExperimentRun.
import { executeSkill } from './executor'
import type { ExperimentRun } from '../experiments/protocol'

export type DeskKind = 'formula' | 'kakeya' | 'ode' | 'geometry'

export interface StepOp {
  op: string
  param?: string
  value?: number
}

export interface AgentStepResult {
  status: 'ok' | 'error'
  runs: Array<{ runId: string; parentRunId?: string; metrics: Record<string, number> }>
  comparison: unknown
  targetRunId?: string
  summary: string
  message?: string
}

const TERMINAL_BY_DESK: Record<DeskKind, { skill: string; op: string }> = {
  formula: { skill: 'formula.plot', op: 'formula.plot' },
  kakeya: { skill: 'kakeya.measure', op: 'kakeya.measure' },
  ode: { skill: 'ode.solve', op: 'ode.solve' },
  geometry: { skill: 'geometry.2d', op: 'geometry.plot' },
}

/** where a parameter lives inside each skill's input (mirrors applyForkChanges) */
function readParam(desk: DeskKind, base: Record<string, unknown>, param: string): number | undefined {
  if (desk === 'formula') {
    const values = (base.values as Record<string, number>) ?? {}
    return values[param]
  }
  if (desk === 'ode') {
    const sys = base.system as { params?: Record<string, number>; kind?: string } | undefined
    const init = base.initialValues as Record<string, number> | undefined
    return sys?.params?.[param] ?? init?.[param]
  }
  if (desk === 'geometry') {
    const params = (base.params as Record<string, number>) ?? {}
    return params[param]
  }
  return base[param] as number | undefined // kakeya inputs are flat
}

function metricsOf(desk: DeskKind, result: unknown): Record<string, number> {
  const r = (result ?? {}) as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  if (desk === 'formula') {
    const peak = num(r.peak)
    const integral = num(r.integral)
    return { ...(peak !== undefined ? { peak } : {}), ...(integral !== undefined ? { integral } : {}) }
  }
  if (desk === 'kakeya') {
    const occupiedVolume = num(r.occupiedVolume)
    const maxMultiplicity = num(r.maxMultiplicity)
    return { ...(occupiedVolume !== undefined ? { occupiedVolume } : {}), ...(maxMultiplicity !== undefined ? { maxMultiplicity } : {}) }
  }
  if (desk === 'ode') {
    // result shape: { t: number[], y: { prey: number[], predator: number[] }, conservedDrift, conserved0 }
    const out: Record<string, number> = {}
    if (num(r.conservedDrift) !== undefined) out.conservedDrift = num(r.conservedDrift)!
    const y = r.y as { prey?: number[]; predator?: number[] } | undefined
    const prey = y?.prey
    const predator = y?.predator
    if (Array.isArray(prey) && prey.length > 0) {
      out.finalPrey = prey[prey.length - 1]
      out.minPrey = Math.min(...prey)
    }
    if (Array.isArray(predator) && predator.length > 0) {
      out.finalPredator = predator[predator.length - 1]
      out.maxPredator = Math.max(...predator)
    }
    return out
  }
  const computedArea = num(r.computedArea)
  const boundArea = num(r.boundArea)
  return { ...(computedArea !== undefined ? { computedArea } : {}), ...(boundArea !== undefined ? { boundArea } : {}) }
}

/**
 * Run the plan steps for one desk experiment.
 * `base` is the skill input of the experiment the user is looking at
 * (formula.plot / kakeya.measure / ode.solve / geometry.2d inputs).
 */
export async function runAgentSteps(
  desk: DeskKind,
  steps: StepOp[],
  base: Record<string, unknown>,
  planId: string,
): Promise<AgentStepResult> {
  const terminal = TERMINAL_BY_DESK[desk]
  const out: AgentStepResult = { status: 'ok', runs: [], comparison: null, summary: '' }
  try {
    // the base run anchors every comparison (registry + PlayPlan gated)
    const baseOut = await executeSkill(terminal.skill, base, { planId })
    if (baseOut.status !== 'ok' || !baseOut.run) {
      return { ...out, status: 'error', message: baseOut.status === 'error' ? baseOut.message : `base skill returned ${baseOut.status}` }
    }
    let current: ExperimentRun = baseOut.run
    const changes: Record<string, number> = {}
    let changed = false
    let forked = false

    const materialise = async (skillName: string, input: Record<string, unknown>) => {
      if (!changed) return current
      const forkOut = await executeSkill(
        'experiment.fork',
        { sourceRunId: current.runId, parameterChanges: changes },
        { planId },
      )
      if (forkOut.status !== 'ok' || !forkOut.run) {
        throw new Error(forkOut.status === 'error' ? forkOut.message : `fork returned ${forkOut.status}`)
      }
      current = forkOut.run
      forked = true
      changed = false
      void skillName
      void input
      return current
    }

    for (const step of steps) {
      const op = step.op
      if (op === 'experiment.fork') {
        await materialise(terminal.skill, base) // apply pending changes as the fork itself
        // an explicit fork with no pending changes still creates a lineage child
        if (!forked) {
          const forkOut = await executeSkill('experiment.fork', { sourceRunId: current.runId, parameterChanges: {} }, { planId })
          if (forkOut.status === 'ok' && forkOut.run) current = forkOut.run
        }
        forked = true
      } else if (op.endsWith('.set') || op === 'kakeya.set') {
        if (!step.param || typeof step.value !== 'number') throw new Error(`${op} requires param and value`)
        changes[step.param] = step.value
        changed = true
      } else if (op.endsWith('.scale') || op === 'formula.scale') {
        if (!step.param || typeof step.value !== 'number') throw new Error(`${op} requires param and value`)
        const from = changes[step.param] ?? readParam(desk, base, step.param)
        if (from === undefined) throw new Error(`unknown parameter for ${op}: ${step.param}`)
        changes[step.param] = from * step.value
        changed = true
      } else if (op === 'kakeya.halve-n') {
        const n = changes.nTubes ?? readParam(desk, base, 'nTubes')
        if (n === undefined) throw new Error('base input has no nTubes to halve')
        changes.nTubes = Math.max(8, Math.floor(n / 2))
        changed = true
      } else if (op === terminal.op || op === 'kakeya.sweep') {
        const skillName = op === 'kakeya.sweep' ? 'kakeya.sweep' : terminal.skill
        const run = await materialise(skillName, base)
        const r = op === 'kakeya.sweep'
          ? (await executeSkill('kakeya.sweep', { ...(base as Record<string, unknown>), ...changes, param: 'nTubes', values: [16, 32, 64, 96, 128] , res: Math.min(Number(base.res ?? 24), 24) }, { planId }))
          : { status: 'ok' as const, run }
        if (r.status !== 'ok' || !('run' in r) || !r.run) throw new Error(`terminal op ${op} failed`)
        out.runs.push({
          runId: r.run.runId,
          parentRunId: r.run.parentRunId,
          metrics: metricsOf(desk, r.run.result),
        })
      } else if (op === 'experiment.compare') {
        await materialise(terminal.skill, base)
        const cmp = await executeSkill('experiment.compare', { runA: baseOut.run!.runId, runB: current.runId }, { planId })
        if (cmp.status !== 'ok') throw new Error(cmp.status === 'error' ? cmp.message : `compare returned ${cmp.status}`)
        out.comparison = cmp.payload
      } else {
        throw new Error(`unknown step op: ${op}`)
      }
    }
    // pending changes after the last explicit terminal/compare still land as a run
    if (changed) {
      const run = await materialise(terminal.skill, base)
      out.runs.push({ runId: run.runId, parentRunId: run.parentRunId, metrics: metricsOf(desk, run.result) })
    }
    out.targetRunId = current.runId
    out.summary = `实验完成：base ${baseOut.run.runId} → target ${current.runId}（全部为注册 skill 真实执行的 ExperimentRun）`
    return out
  } catch (err) {
    return { ...out, status: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}
