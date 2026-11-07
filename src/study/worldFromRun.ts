// CLI-151 结果三的最小缺口：把一条已确认的候选 + 它真实提交的 Run 变成
// MathWorld 的世界定义（W1 Host 执行：拖动预览、松手正式 Run、独立 Goal）。
// 来源边界：方程、初值、参数名义值全部来自候选（论文原句或用户提供）；
// 参数可调范围、可拖动的初值与目标是**用户声明的游戏规则**，不是论文结论，
// origin 与 rules 文案如实写明。显示轴范围取自这条真实 Run 的 min/max。
import {
  WORLD_SCHEMA,
  type AxisDecl,
  type ConstraintDecl,
  type ControlDecl,
  type ParamDecl,
  type StateDecl,
  type WorldDefinition,
} from '../mathworld/definition'
import type { MathRequestCandidate } from './requestCandidate'

export interface GameRules {
  /** player-adjustable range per parameter; absent → the parameter stays fixed */
  ranges: Record<string, { min: number; max: number }>
  /** exactly two states the player may drag the starting point of (or none) */
  draggable: [string, string] | null
  /** drag range per draggable state */
  initialRanges: Record<string, { min: number; max: number }>
  goal: ConstraintDecl[]
  attempts: number
}

export interface SolvedRun {
  runId: string
  perState: Array<{ state: string; min: number; max: number }>
}

export interface Provenance {
  fileName: string
  fileSha256: string
  pages: number[]
}

function padded(min: number, max: number): [number, number] {
  const span = max - min || Math.max(1, Math.abs(max))
  return [min - 0.12 * span, max + 0.12 * span]
}

/** autonomous ODE candidate (status ready) + its solved Run → world definition.
 *  Returns the definition or the reasons it cannot be built — the world's own
 *  validator (validateWorld) still runs when the host activates it. */
export function worldFromOdeCandidate(
  c: MathRequestCandidate,
  run: SolvedRun,
  rules: GameRules,
  prov: Provenance,
): { world: WorldDefinition } | { errors: string[] } {
  const errors: string[] = []
  if (c.structure !== 'autonomous-ode' || c.status !== 'ready' || !c.span.value) errors.push('只有"可执行"的自治方程组候选能生成世界')
  if (rules.goal.length === 0) errors.push('至少设定一条目标——没有目标的世界无法判定成败')
  const value = new Map([...c.params, ...c.initials].map((f) => [f.name, f.value]))
  const params: ParamDecl[] = c.params.map((p) => {
    const r = rules.ranges[p.name]
    const initial = p.value as number
    if (r && !(r.min <= initial && initial <= r.max)) errors.push(`参数 ${p.name} 的可调范围 [${r.min}, ${r.max}] 必须包含论文值 ${initial}`)
    return {
      name: p.name,
      label: `${p.name}（${p.source.kind === 'paper' ? `论文第 ${p.source.page} 页` : '你提供'}）`,
      initial,
      min: r ? r.min : initial,
      max: r ? r.max : initial,
      step: r ? Number(((r.max - r.min) / 200).toPrecision(2)) : 0.01,
      operable: Boolean(r),
    }
  })
  const states: StateDecl[] = c.states.map((s) => {
    const r = rules.draggable?.includes(s) ? rules.initialRanges[s] : undefined
    const initial = value.get(s) as number
    if (rules.draggable?.includes(s) && !r) errors.push(`可拖动初值 ${s} 需要拖动范围`)
    if (r && !(r.min <= initial && initial <= r.max)) errors.push(`状态 ${s} 的拖动范围必须包含初值 ${initial}`)
    return { name: s, label: s, initial, ...(r ? { operable: true, min: r.min, max: r.max } : {}) }
  })
  const controls: ControlDecl[] = rules.draggable ? [{ kind: 'initial-point', id: 'start', states: rules.draggable, label: '起点' }] : []
  const range = (s: string): [number, number] => {
    const ps = run.perState.find((p) => p.state === s)
    return ps ? padded(ps.min, ps.max) : [-1, 1]
  }
  const [t0, t1] = c.span.value ?? [0, 1]
  const axis = (source: string, length: number): AxisDecl =>
    source === 't' ? { source: 't', min: t0, max: t1, length, label: 't' } : { source, min: range(source)[0], max: range(source)[1], length, label: source }
  const axes =
    c.states.length >= 2
      ? { x: axis(c.states[0], 9), y: axis(c.states[1], 6), ...(c.states[2] ? { z: axis(c.states[2], 8) } : { z: axis('t', 8) }) }
      : { x: axis('t', 10), y: axis(c.states[0], 6) }
  if (errors.length) return { errors }
  const world: WorldDefinition = {
    schema: WORLD_SCHEMA,
    id: `study-${prov.fileSha256.slice(0, 10)}-${run.runId.slice(-8)}`,
    title: `${prov.fileName.replace(/\.pdf$/i, '')} · ${c.states.join('/')} 方程组`,
    origin: {
      kind: 'edited',
      note: `由论文研究空间生成（非 AI）：${prov.fileName}（sha256 ${prov.fileSha256.slice(0, 10)}…，第 ${prov.pages.join(',')} 页），方程与取值见候选来源；参数可调范围、可拖动初值与目标是你设定的游戏规则，不是论文结论。起始 Run ${run.runId}`,
    },
    premise: `${c.equations.map((e) => e.latex).join('；')}。来源：${prov.fileName} 第 ${prov.pages.join(',')} 页。`,
    objective: rules.goal.map((g) => g.label ?? g.id).join('；'),
    model: {
      kind: 'ode',
      states,
      rhs: Object.fromEntries(c.equations.map((e) => [e.state as string, e.latex.slice(e.latex.indexOf('=') + 1).trim()])),
      params,
      tSpan: [t0, t1],
      steps: 2400,
      refineCheck: { tol: 1e-6 },
    },
    controls,
    goal: { constraints: rules.goal, attempts: rules.attempts },
    scene: { axes },
    rules: [
      '方程、初值与参数名义值来自论文研究空间的候选（论文原句或你提供的实验假设）。',
      '参数可调范围、可拖动初值与目标是你设定的游戏规则，不代表论文结论。',
      '拖动只做同方程粗步长预览，不计分；松手提交正式 model.solve，并以 2 倍步数加密对照，差异超过容差判为不确定。',
    ],
  }
  return { world }
}
