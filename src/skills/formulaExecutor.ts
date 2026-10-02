import { explorerStore } from '../desk/explorerStore'
import { executeSkill } from './executor'
import { validateSkillInput } from './registry'

function requireSkill(name: string, input: unknown) {
  const checked = validateSkillInput(name, input)
  if (!checked.ok) throw new Error(checked.error)
}

/** Shared execution path for server actions and the local planner. */
export async function executeFormulaSteps(
  sourceId: string,
  steps: Array<Record<string, unknown>>,
  canvas: { fork: (id: string) => string | null; compare: () => void },
) {
  const source = explorerStore.get(sourceId)
  if (!source) throw new Error('Selected experiment no longer exists')
  const proposed = { ...source.params }
  const allowed = new Set(['experiment.fork', 'formula.set', 'formula.scale', 'formula.plot', 'experiment.compare'])
  // Validate the entire sequence before a Fork or parameter mutation.
  for (const step of steps) {
    if (!allowed.has(String(step.op))) throw new Error(`Unsupported scientific operation: ${step.op}`)
    if (step.op === 'formula.set' || step.op === 'formula.scale') {
      const param = source.spec.parameters.find((p) => p.name === step.param)
      if (!param || typeof step.value !== 'number' || !Number.isFinite(step.value)) throw new Error('Invalid formula parameter')
      const value = step.op === 'formula.scale' ? proposed[param.name] * step.value : step.value
      if (!Number.isFinite(value) || value < param.min || value > param.max) throw new Error(`Parameter ${param.name} exceeds its range`)
      proposed[param.name] = value
    }
  }
  const baseRun = await explorerStore.waitForRun(sourceId)
  let targetId = sourceId
  const runs = []
  let comparison: unknown = null
  for (const step of steps) {
    if (step.op === 'experiment.fork') {
      requireSkill('experiment.fork', { sourceRunId: baseRun.runId })
      const id = canvas.fork(targetId)
      if (!id) throw new Error('Canvas could not create the fork')
      targetId = id
    } else if (step.op === 'formula.set' || step.op === 'formula.scale') {
      const name = String(step.param)
      const current = explorerStore.get(targetId)!.params[name]
      explorerStore.setParams(targetId, { [name]: step.op === 'formula.set' ? Number(step.value) : current * Number(step.value) })
    } else if (step.op === 'formula.plot') {
      const target = explorerStore.get(targetId)!
      requireSkill('formula.plot', target.plan.inputs)
      const run = await explorerStore.waitForRun(targetId)
      runs.push({ runId: run.runId, parentRunId: run.parentRunId, metrics: { peak: run.result!.peak, integral: run.result!.integral }, durationMs: run.durationMs })
    } else if (step.op === 'experiment.compare') {
      const child = await explorerStore.waitForRun(targetId)
      // compare goes through the registered skill (which uses the Run
      // Repository's explicit two-run diff — never "everything in the store")
      const out = await executeSkill('experiment.compare', { runA: baseRun.runId, runB: child.runId })
      if (out.status !== 'ok') throw new Error(out.status === 'error' ? out.message : `experiment.compare returned ${out.status}`)
      comparison = out.payload
      canvas.compare()
    }
  }
  return { runs, comparison, targetId, summary: `实验完成，结果引用 run ${baseRun.runId} 与 ${explorerStore.get(targetId)?.run?.runId}` }
}
