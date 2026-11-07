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
import { requestInput, type MathRequestCandidate } from './requestCandidate'

export interface GameRules {
  /** player-adjustable range per parameter; absent → the parameter stays fixed */
  ranges: Record<string, { min: number; max: number }>
  /** exactly two states the player may drag the starting point of (or none) */
  draggable: [string, string] | null
  /** drag range per draggable state */
  initialRanges: Record<string, { min: number; max: number }>
  goal: ConstraintDecl[]
  attempts: number
  mode?: 'explore' | 'challenge'
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
  if (rules.goal.length === 0 && rules.mode !== 'explore') errors.push('至少设定一条目标——没有目标的世界无法判定成败')
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
  const draggable = rules.draggable ?? (rules.mode === 'explore' && c.states.length >= 2 ? [c.states[0], c.states[1]] as [string, string] : null)
  const states: StateDecl[] = c.states.map((s) => {
    const r = rules.mode === 'explore' || draggable?.includes(s) ? rules.initialRanges[s] : undefined
    const initial = value.get(s) as number
    if (draggable?.includes(s) && !r) errors.push(`可拖动初值 ${s} 需要拖动范围`)
    if (r && !(r.min <= initial && initial <= r.max)) errors.push(`状态 ${s} 的拖动范围必须包含初值 ${initial}`)
    return { name: s, label: s, initial, ...(r ? { operable: true, min: r.min, max: r.max } : {}) }
  })
  const controls: ControlDecl[] = draggable ? [{ kind: 'initial-point', id: 'start', states: draggable, label: '起点' }] : []
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
    objective: rules.mode === 'explore' ? '改变条件，释放轨迹，观察方程会怎样响应' : rules.goal.map((g) => g.label ?? g.id).join('；'),
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
    goal: { mode: rules.mode ?? 'challenge', constraints: rules.mode === 'explore' ? [] : rules.goal, attempts: rules.attempts },
    scene: { axes },
    rules: [
      '方程、初值与参数名义值来自论文研究空间的候选（论文原句或你提供的实验假设）。',
      '参数可调范围、可拖动初值与目标是你设定的游戏规则，不代表论文结论。',
      '拖动只做同方程粗步长预览，不计分；松手提交正式 model.solve，并以 2 倍步数加密对照，差异超过容差判为不确定。',
    ],
  }
  return { world }
}

/** Explicit functions use the same real curve Run, not a shipped room. */
export function worldFromFormulaCandidate(
  c: MathRequestCandidate,
  run: { runId: string; points: Array<[number, number]> },
  rules: GameRules,
  prov: Provenance,
): { world: WorldDefinition } | { errors: string[] } {
  if (c.structure !== 'explicit-function' || c.status !== 'ready' || !c.span.value) return { errors: ['需要一条可执行的显式函数与已计算的曲线'] }
  const points = run.points
  if (!Array.isArray(points) || points.length < 2 || points.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) return { errors: ['Run 缺少有限曲线数据'] }
  const [x0, x1] = c.span.value
  const params: ParamDecl[] = c.params.map((p) => {
    const range = rules.ranges[p.name]
    return { name: p.name, label: p.name, initial: p.value as number, min: range?.min ?? (p.value as number), max: range?.max ?? (p.value as number), operable: Boolean(range), step: range ? (range.max - range.min) / 200 : 0.01 }
  })
  const ys = points.map((p) => p[1])
  const yRange = padded(Math.min(...ys), Math.max(...ys))
  const raw = String(requestInput(c).expression)
  const expression = raw.includes('=') ? raw.slice(raw.indexOf('=') + 1).trim() : raw
  return { world: {
    schema: WORLD_SCHEMA,
    id: `study-${prov.fileSha256.slice(0, 10)}-${run.runId.slice(-8)}`,
    title: `${prov.fileName} · 公式游玩台`,
    origin: { kind: 'edited', note: `当前论文第 ${prov.pages.join(',')} 页的候选；起始计算 ${run.runId}。操作范围是探索设置，不是论文定理。` },
    premise: raw,
    objective: '拖动曲线控制点或公式参数，看看曲线怎样改变',
    model: { kind: 'formula', expression, independent: c.independent, output: 'y', range: [x0, x1], samples: points.length, params },
    controls: params.filter((p) => p.operable).map((p, i) => ({ kind: 'curve-handle', id: `handle-${p.name}`, param: p.name, atX: x0 + (x1 - x0) * (i + 1) / (params.length + 1), label: p.name })),
    goal: { mode: 'explore', constraints: [], attempts: rules.attempts },
    scene: { axes: { x: { source: c.independent, min: x0, max: x1, length: 10, label: c.independent }, y: { source: 'y', min: yRange[0], max: yRange[1], length: 6, label: 'y' } } },
    rules: ['当前为自由探索：不计分、不宣称证明；松手后由同一数学执行器重新计算。'],
  } }
}
