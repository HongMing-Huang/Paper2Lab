import { getExperimentRun } from '../experiments/protocol'
import type { ConstraintDecl, WorldDefinition } from '../mathworld/definition'
import type { Session } from '../mathworld/host'
import { evaluateGoal, type Evidence } from '../mathworld/goal'
import { executeSkill } from '../skills/executor'

/** Player-created target from the last verified observation; never a paper claim. */
export async function challengeFromRun(s: Session): Promise<{ world: WorldDefinition } | { error: string }> {
  if (s.pending || !s.committed || s.committed.assessment.outcome === 'invalid') return { error: '请先完成一次有效操作的计算' }
  const latest = s.attempts.filter((a) => a.status === 'committed' && !a.fromFile).at(-1)
  if (!latest || latest.actor === 'init' || latest.actor === 'restore') return { error: '先改变一次条件，再把你的结果设成目标' }
  const ev = s.committed.evidence
  const runId = ev.kind === 'formula' ? ev.curveRunId : ev.kind === 'ode' ? ev.solveRunId : null
  const run = runId ? getExperimentRun(runId) : null
  if (!run || run.status !== 'resolved' || run.errors.length) return { error: '没有可追溯的正式结果' }
  const world = structuredClone(s.world)
  const constraints: ConstraintDecl[] = []
  if (ev.kind === 'formula' && world.model.kind === 'formula') {
    const points = (run.result as { points: Array<[number, number]> }).points
    const point = points[Math.floor((points.length - 1) * .75)]
    const ys = points.map((p) => p[1]); const tolerance = Math.max((Math.max(...ys) - Math.min(...ys)) * .05, 1e-6)
    constraints.push({ kind: 'gate', id: 'player-target', label: '你刚才的曲线目标', x: point[0], min: point[1] - tolerance, max: point[1] + tolerance })
  } else if (ev.kind === 'ode' && world.model.kind === 'ode') {
    if (s.committed.assessment.quality?.status !== 'provisional') return { error: '这次积分的加密对照尚不够稳定，先缩短时间或调整条件' }
    const series = (run.result as { series: Array<{ state: string; values: number[] }> }).series
    for (const row of series) {
      const target = row.values.at(-1)!
      const tolerance = Math.max((Math.max(...row.values) - Math.min(...row.values)) * .05, 1e-6)
      constraints.push({ kind: 'final-range', id: `target-${row.state}`, label: `复现 ${row.state} 的落点`, state: row.state, min: target - tolerance, max: target + tolerance })
    }
  } else return { error: '当前模型尚未接入结果目标转换' }
  if (!constraints.length) return { error: '当前结果没有可以设定的目标' }
  world.id = `${world.id.slice(0, 45)}-target-${Date.now().toString(36)}`
  world.goal = { mode: 'challenge', constraints, attempts: s.world.goal.attempts }
  world.objective = '回到原来的条件，试着让结果重新进入你刚才标出的目标区域'
  world.origin = { kind: 'edited', note: `你基于真实 Run ${runId} 创建的挑战。窗口宽度是结果变化范围的5%（至少1e-6），属于游戏设置，不是论文结论。` }
  const model = world.model
  const params = Object.fromEntries(model.params.map((p) => [p.name, s.params[p.name]]))
  const initial = model.kind === 'ode' ? Object.fromEntries(model.states.map((st) => [st.name, st.operable ? s.params[st.name] : st.initial])) : {}
  let witnessEvidence: Evidence = ev
  if (model.kind === 'formula' && ev.kind === 'formula') {
    const gate = constraints[0]
    if (gate.kind !== 'gate') return { error: '目标类型不匹配' }
    const value = await executeSkill('formula.evaluate', {
      expression: model.expression, bindings: { ...params, [model.independent]: gate.x },
    }, { planId: s.planIds[1], source: { kind: 'player-target-witness', baseRunId: runId, worldId: s.world.id, revision: s.revision } })
    if (value.status !== 'ok' || !value.run || value.run.status !== 'resolved') return { error: '目标处的正式求值未完成，不能发布挑战' }
    witnessEvidence = { ...ev, gateRunIds: { [gate.id]: value.run.runId } }
  }
  const witness = evaluateGoal(world, params, initial, witnessEvidence)
  if (witness.outcome !== 'success') return { error: `目标尚不能可靠复现：${witness.summary}。请调整条件后再试。` }
  world.rules = [...(world.rules ?? []), `目标的已验证见证来自 Run ${runId}，条件 ${JSON.stringify(s.params)}；这是有界数值见证，不是论文证明。`]
  return { world }
}
