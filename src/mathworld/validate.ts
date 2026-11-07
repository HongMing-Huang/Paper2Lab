// WorldDefinition validation (CLI-129). Structural checks first, then a real
// compile through the same Cortex path the executor uses. A definition the
// registered kernels cannot honestly run is REJECTED with the reason — the
// page never silently swaps in a different model or ignores a parameter.
import {
  WORLD_SCHEMA,
  type AxisDecl,
  type ConstraintDecl,
  type ControlDecl,
  type FormulaModel,
  type KakeyaModel,
  type OdeModel,
  type ParamDecl,
  type WorldDefinition,
} from './definition'
import { compileFormulaExpression, compileOdeSystem, kakeyaTubes, sampleCurve } from './kernels'

export type ValidationResult =
  | { ok: true; world: WorldDefinition; warnings: string[] }
  | { ok: false; errors: string[]; unsupported: string[] }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const NAME = /^[A-Za-z][A-Za-z0-9]*$/

function checkParams(params: unknown, errors: string[], where: string): ParamDecl[] {
  if (!Array.isArray(params)) {
    errors.push(`${where}.params 必须是数组`)
    return []
  }
  const seen = new Set<string>()
  for (const p of params as ParamDecl[]) {
    if (!p || !isStr(p.name) || !NAME.test(p.name)) { errors.push(`${where}.params 含非法参数名 ${JSON.stringify(p?.name)}`); continue }
    if (seen.has(p.name)) errors.push(`参数 ${p.name} 重复声明`)
    seen.add(p.name)
    if (!isNum(p.min) || !isNum(p.max) || !(p.min < p.max)) errors.push(`参数 ${p.name} 的定义域 [min,max] 非法`)
    else if (!isNum(p.initial) || p.initial < p.min || p.initial > p.max) errors.push(`参数 ${p.name} 的初值必须在 [${p.min}, ${p.max}] 内`)
    if (p.step !== undefined && (!isNum(p.step) || p.step <= 0)) errors.push(`参数 ${p.name} 的 step 必须为正数`)
    if (typeof p.operable !== 'boolean') errors.push(`参数 ${p.name} 必须声明 operable（控制政策）`)
  }
  return params as ParamDecl[]
}

function checkAxis(axis: AxisDecl | undefined, name: string, sources: Set<string>, errors: string[], required: boolean) {
  if (!axis) {
    if (required) errors.push(`scene.axes.${name} 缺失`)
    return
  }
  if (!isStr(axis.source) || !sources.has(axis.source)) errors.push(`scene.axes.${name}.source 必须是 ${[...sources].join(' / ')} 之一`)
  if (!isNum(axis.min) || !isNum(axis.max) || !(axis.min < axis.max)) errors.push(`scene.axes.${name} 的 [min,max] 非法`)
  if (axis.length !== undefined && (!isNum(axis.length) || axis.length <= 0 || axis.length > 40)) errors.push(`scene.axes.${name}.length 需在 (0, 40]`)
}

function validateFormula(m: FormulaModel, w: WorldDefinition, errors: string[], unsupported: string[], warnings: string[]) {
  if (!isStr(m.expression)) errors.push('model.expression 必须是非空 LaTeX 字符串')
  if (!isStr(m.independent) || !NAME.test(m.independent)) errors.push('model.independent 非法')
  if (!isStr(m.output)) errors.push('model.output 非法')
  if (!Array.isArray(m.range) || m.range.length !== 2 || !isNum(m.range[0]) || !isNum(m.range[1]) || !(m.range[0] < m.range[1])) errors.push('model.range 必须是 [x0, x1] 且 x0 < x1')
  if (!Number.isInteger(m.samples) || m.samples < 21 || m.samples > 2001) errors.push('model.samples 必须是 21…2001 的整数')
  const params = checkParams(m.params, errors, 'model')
  if (errors.length) return
  if (params.some((p) => p.name === m.independent)) errors.push(`自变量 ${m.independent} 不能同时是参数`)
  let compiled
  try {
    compiled = compileFormulaExpression(m.expression)
  } catch (err) {
    unsupported.push(err instanceof Error ? err.message : String(err))
    return
  }
  const declared = new Set([m.independent, ...params.map((p) => p.name)])
  const undeclared = compiled.freeSymbols.filter((s) => !declared.has(s))
  if (undeclared.length) unsupported.push(`表达式含未声明的自由符号 ${undeclared.join(', ')}：formula.plot 只接受一个自变量 ${m.independent} 加已声明参数`)
  const free = new Set(compiled.freeSymbols)
  // a declared knob the compiled expression never reads would record a
  // parameter that cannot change the numbers (e.g. Cortex folding \gamma to
  // the Euler constant) — refuse instead of shipping a dead control
  for (const p of params) if (!free.has(p.name)) unsupported.push(`参数 ${p.name} 不在编译后表达式的自由符号中（可能被 Cortex 当作常数折叠），它无法影响计算`)
  if (!free.has(m.independent)) warnings.push(`表达式不含自变量 ${m.independent}：曲线是常数`)
  if (unsupported.length) return
  const initial = Object.fromEntries(params.map((p) => [p.name, p.initial]))
  if (!sampleCurve(compiled, initial, m.independent, m.range, Math.min(m.samples, 241))) {
    unsupported.push('初始参数下曲线在区间内出现非有限值（奇点/越界）：世界不能以非法状态开局')
  }
  for (const c of w.controls ?? []) {
    if (c.kind !== 'curve-handle') { errors.push(`控制 ${c.id}：formula 世界只支持 curve-handle`); continue }
    const p = params.find((q) => q.name === c.param)
    if (!p) errors.push(`控制 ${c.id} 绑定的参数 ${c.param} 不存在`)
    else if (!p.operable) errors.push(`控制 ${c.id} 绑定的参数 ${c.param} 不可操作（operable=false）`)
    if (!isNum(c.atX) || c.atX < m.range[0] || c.atX > m.range[1]) errors.push(`控制 ${c.id} 的 atX 必须在 range 内`)
  }
  for (const k of w.goal.constraints) {
    if (k.kind === 'gate') {
      if (!isNum(k.x) || k.x < m.range[0] || k.x > m.range[1]) errors.push(`约束 ${k.id}：闸门 x 必须在 range 内`)
      if (!isNum(k.min) || !isNum(k.max) || !(k.min < k.max)) errors.push(`约束 ${k.id}：闸门开口 [min,max] 非法`)
    } else if (k.kind === 'avoid-box') {
      if (![k.xMin, k.xMax, k.yMin, k.yMax].every(isNum) || !(k.xMin < k.xMax) || !(k.yMin < k.yMax)) errors.push(`约束 ${k.id}：禁区盒子边界非法`)
    } else {
      errors.push(`约束 ${(k as ConstraintDecl).id}：formula 世界不支持 ${(k as ConstraintDecl).kind}`)
    }
  }
  const sources = new Set([m.independent, m.output])
  checkAxis(w.scene?.axes?.x, 'x', sources, errors, true)
  checkAxis(w.scene?.axes?.y, 'y', sources, errors, true)
  if (w.scene?.axes?.z) errors.push('formula 世界的场景只有 x/y 两轴（z 用于历史层）')
}

function validateOde(m: OdeModel, w: WorldDefinition, errors: string[], unsupported: string[]) {
  if (!Array.isArray(m.states) || m.states.length < 1 || m.states.length > 6) { errors.push('model.states 需 1…6 个状态'); return }
  const names = new Set<string>()
  for (const s of m.states) {
    if (!s || !isStr(s.name) || !NAME.test(s.name)) { errors.push(`非法状态名 ${JSON.stringify(s?.name)}`); continue }
    if (names.has(s.name)) errors.push(`状态 ${s.name} 重复`)
    names.add(s.name)
    if (!isNum(s.initial)) errors.push(`状态 ${s.name} 需要有限初值`)
    if (s.operable) {
      if (!isNum(s.min) || !isNum(s.max) || !(s.min! < s.max!)) errors.push(`可操作状态 ${s.name} 需声明 [min,max]`)
      else if (s.initial < s.min! || s.initial > s.max!) errors.push(`状态 ${s.name} 初值超出 [min,max]`)
    }
  }
  const params = checkParams(m.params, errors, 'model')
  for (const p of params) if (names.has(p.name)) errors.push(`符号 ${p.name} 同时是状态与参数`)
  if (!m.rhs || typeof m.rhs !== 'object') errors.push('model.rhs 缺失')
  else for (const s of m.states) if (!isStr(m.rhs[s.name])) errors.push(`状态 ${s.name} 缺少右端 LaTeX`)
  if (!Array.isArray(m.tSpan) || m.tSpan.length !== 2 || !isNum(m.tSpan[0]) || !isNum(m.tSpan[1]) || !(m.tSpan[1] > m.tSpan[0])) errors.push('model.tSpan 必须是 [t0, t1] 且 t1 > t0')
  if (!Number.isInteger(m.steps) || m.steps < 240 || m.steps > 10000) errors.push('model.steps 必须是 240…10000 的整数')
  if (!m.refineCheck || !isNum(m.refineCheck.tol) || m.refineCheck.tol <= 0) errors.push('model.refineCheck.tol 必须为正数（加密对照容差）')
  if (errors.length) return
  let sys
  try {
    sys = compileOdeSystem(m.states.map((s) => s.name), m.rhs, params.map((p) => p.name))
  } catch (err) {
    unsupported.push(err instanceof Error ? err.message : String(err))
    return
  }
  if (sys.unknownSymbols.length) {
    const t = sys.unknownSymbols.includes('t')
    unsupported.push(
      t
        ? '右端显含时间 t：当前 model.solve 只支持自主系统 dy/dt = f(y)，拒绝而不是假算'
        : `右端含未声明的符号 ${sys.unknownSymbols.join(', ')}：每个常数都必须在 params 中声明`,
    )
  }
  for (const c of w.controls ?? []) {
    if (c.kind !== 'initial-point') { errors.push(`控制 ${(c as ControlDecl).id}：ode 世界只支持 initial-point`); continue }
    for (const sn of c.states) {
      const s = m.states.find((q) => q.name === sn)
      if (!s) errors.push(`控制 ${c.id} 引用的状态 ${sn} 不存在`)
      else if (!s.operable) errors.push(`控制 ${c.id}：状态 ${sn} 的初值不可操作（operable 未开启）`)
    }
  }
  for (const k of w.goal.constraints) {
    if (k.kind === 'series-max') {
      if (!names.has(k.state) || !isNum(k.max)) errors.push(`约束 ${k.id}：series-max 需要已知状态与有限上界`)
    } else if (k.kind === 'final-range') {
      if (!names.has(k.state)) errors.push(`约束 ${k.id}：未知状态 ${k.state}`)
      if (k.min === undefined && k.max === undefined) errors.push(`约束 ${k.id}：final-range 至少给出 min 或 max`)
      if ((k.min !== undefined && !isNum(k.min)) || (k.max !== undefined && !isNum(k.max))) errors.push(`约束 ${k.id}：边界必须是有限数`)
    } else if (k.kind === 'reach-ball') {
      const keys = Object.keys(k.center ?? {})
      if (!keys.length || keys.some((s) => !names.has(s) || !isNum(k.center[s]))) errors.push(`约束 ${k.id}：reach-ball 的中心必须由已知状态的有限值组成`)
      if (!isNum(k.radius) || k.radius <= 0) errors.push(`约束 ${k.id}：半径必须为正`)
    } else {
      errors.push(`约束 ${(k as ConstraintDecl).id}：ode 世界不支持 ${(k as ConstraintDecl).kind}`)
    }
  }
  const sources = new Set([...names, 't'])
  checkAxis(w.scene?.axes?.x, 'x', sources, errors, true)
  checkAxis(w.scene?.axes?.y, 'y', sources, errors, true)
  checkAxis(w.scene?.axes?.z, 'z', sources, errors, false)
}

// ---- kakeya worlds (方向之室 · CLI-149) -------------------------------------

function validateKakeya(m: KakeyaModel, w: WorldDefinition, errors: string[], unsupported: string[], warnings: string[]) {
  if (!Number.isInteger(m.nTubes) || m.nTubes < 3 || m.nTubes > 512) errors.push('model.nTubes 需为 3…512 的整数')
  if (!isNum(m.deltaExp) || m.deltaExp < 2 || m.deltaExp > 8) errors.push('model.deltaExp 需在 [2, 8]（δ = 2^-deltaExp）')
  if (!isNum(m.length) || m.length <= 0.3 || m.length > 1) errors.push('model.length 需在 [0.3, 1]')
  if (!isNum(m.packing) || m.packing < 0 || m.packing > 1) errors.push('model.packing 需在 [0, 1]')
  if (errors.length) return
  // a near-axis direction cannot fit a unit capsule: require the WHOLE capsule
  // to fit for EVERY direction, or some tubes are unplaceable (and the level
  // would depend on which directions happened to land near the axes)
  if (2 * (2 ** -m.deltaExp) + m.length > 1) {
    errors.push(`model 不满足 2δ + length ≤ 1（δ=${(2 ** -m.deltaExp).toFixed(4)}，length=${m.length}）：轴向管的胶囊放不进计分域，请缩短管或减小 δ`)
  }
  for (const key of ['res', 'refineRes'] as const) {
    if (!Number.isInteger(m[key]) || m[key] < 16 || m[key] > 256) errors.push(`model.${key} 需为 16…256 的整数`)
  }
  if (errors.length) return
  if (m.refineRes <= m.res) errors.push(`model.refineRes (${m.refineRes}) 必须大于 res (${m.res}) — 收敛对照要更细`)
  const delta = 2 ** -m.deltaExp
  if (delta * m.res < 0.5) warnings.push(`半径相对网格偏细（δ·res = ${(delta * m.res).toFixed(3)}）：正式计分会标 unknown，建议加大 res 或减小 deltaExp`)
  if (delta >= 0.25) warnings.push('δ ≥ 0.25 的管几乎填满单位立方体，关卡会退化')
  // clusters: indices in range, no tube in two clusters, partition not required
  // (unclustered tubes simply stay at the base layout — they are part of the
  // fixed scene the movable clusters must negotiate with)
  const claimed = new Map<number, string>()
  if (!Array.isArray(m.clusters) || m.clusters.length === 0) { errors.push('model.clusters 至少一组'); return }
  const seenIds = new Set<string>()
  for (const c of m.clusters) {
    if (!c || !isStr(c.id) || !/^[a-z][a-z0-9-]{0,24}$/.test(c.id)) { errors.push(`簇 id ${JSON.stringify(c?.id)} 需为小写字母/数字/连字符`); continue }
    if (seenIds.has(c.id)) errors.push(`簇 id ${c.id} 重复`)
    seenIds.add(c.id)
    if (!Array.isArray(c.tubes) || c.tubes.length === 0) { errors.push(`簇 ${c.id} 的 tubes 不能为空`); continue }
    for (const i of c.tubes) {
      if (!Number.isInteger(i) || i < 0 || i >= m.nTubes) { errors.push(`簇 ${c.id} 引用了不存在的管下标 ${JSON.stringify(i)}`); continue }
      const other = claimed.get(i)
      if (other) errors.push(`第 ${i} 根管同时属于簇 ${other} 和 ${c.id}`)
      claimed.set(i, c.id)
    }
    if (c.offset && (![c.offset.x, c.offset.y, c.offset.z].every(isNum))) errors.push(`簇 ${c.id} 的初始偏移必须是有限数`)
  }
  if (errors.length) return
  // the declared layout must be LEGAL: every capsule (with offsets) inside the
  // scoring cube — a starting position the kernel would refuse is not a level
  try {
    const tubes = kakeyaTubes(m, Object.fromEntries(m.clusters.map((c) => [c.id, c.offset ?? { x: 0, y: 0, z: 0 }])))
    if (tubes.length !== m.nTubes) unsupported.push('管族构建结果与 nTubes 不符')
  } catch (err) {
    unsupported.push(`声明的簇布局非法：${err instanceof Error ? err.message : String(err)}`)
  }
  for (const c of w.controls ?? []) {
    if (c.kind !== 'cluster-drag') { errors.push(`控制 ${(c as ControlDecl).id}：kakeya 世界只支持 cluster-drag`); continue }
    const cl = m.clusters.find((q) => q.id === c.cluster)
    if (!cl) errors.push(`控制 ${c.id} 绑定的簇 ${c.cluster} 不存在`)
    else if (cl.operable === false) errors.push(`控制 ${c.id}：簇 ${c.cluster} 是固定簇（operable=false），不能拖动`)
  }
  const movable = m.clusters.filter((c) => c.operable !== false)
  if (movable.length === 0) errors.push('至少要有一组可拖动的簇（否则无解可寻）')
  // review M4: the Goal evaluator judges ONE kakeya-volume per world — a
  // second (e.g. looser) constraint would render in the goal card but never
  // be judged, silently relaxing the level. Refuse the definition instead.
  const volumeConstraints = w.goal.constraints.filter((k) => k.kind === 'kakeya-volume')
  if (volumeConstraints.length !== 1) errors.push(`kakeya 世界恰好需要 1 条 kakeya-volume 约束（当前 ${volumeConstraints.length} 条：判定器逐条独立评估，多条会被静默漏判，请合并为一条）`)
  for (const k of w.goal.constraints) {
    if (k.kind !== 'kakeya-volume') { errors.push(`约束 ${(k as ConstraintDecl).id}：kakeya 世界只支持 kakeya-volume`); continue }
    if (!isNum(k.maxVolume) || k.maxVolume <= 0 || k.maxVolume >= 1) errors.push(`约束 ${k.id}：maxVolume 需在 (0,1)（单位立方体的占比）`)
    if (!isNum(k.convTol) || k.convTol <= 0) errors.push(`约束 ${k.id}：convTol 需为正数（两次分辨率体积差的容差）`)
  }
  const sources = new Set(['x', 'y', 'z'])
  checkAxis(w.scene?.axes?.x, 'x', sources, errors, true)
  checkAxis(w.scene?.axes?.y, 'y', sources, errors, true)
  checkAxis(w.scene?.axes?.z, 'z', sources, errors, true)
}

export function validateWorld(raw: unknown): ValidationResult {
  const errors: string[] = []
  const unsupported: string[] = []
  const warnings: string[] = []
  const w = raw as WorldDefinition
  if (!w || typeof w !== 'object') return { ok: false, errors: ['世界定义必须是 JSON 对象'], unsupported }
  if (w.schema !== WORLD_SCHEMA) errors.push(`schema 必须是 "${WORLD_SCHEMA}"`)
  if (!isStr(w.id) || !/^[a-z0-9][a-z0-9-]{1,48}$/.test(w.id)) errors.push('id 需为 2…49 位小写字母/数字/连字符')
  if (!isStr(w.title)) errors.push('title 缺失')
  if (!w.origin || (w.origin.kind !== 'dev-sample' && w.origin.kind !== 'edited') || !isStr(w.origin.note)) {
    errors.push('origin 必须是 { kind: "dev-sample" | "edited", note } —— 来源必须如实标注')
  }
  if (w.paperRef !== undefined) {
    const p = w.paperRef as { url?: unknown; title?: unknown; anchor?: unknown }
    if (!isStr(p.url) || !/^(https?:\/\/|\/)/.test(p.url) || /[\s]/.test(p.url)) {
      errors.push('paperRef.url 必须是 http(s):// 或站内以 / 开头的无空格链接')
    }
    if (!isStr(p.title)) errors.push('paperRef.title 必须是非空字符串')
    const a = p.anchor
    if (a !== undefined) {
      if (isStr(a)) {
        errors.push('paperRef.anchor 请用结构化 { page, bbox?, note? }（页码定位），纯文字说明放 note')
      } else if (a && typeof a === 'object') {
        const anchor = a as { page?: unknown; bbox?: { x?: unknown; y?: unknown; w?: unknown; h?: unknown }; note?: unknown }
        if (!Number.isInteger(anchor.page) || (anchor.page as number) < 1) errors.push('paperRef.anchor.page 需为 ≥1 的整数页码')
        if (anchor.bbox !== undefined) {
          const b = anchor.bbox as { x: unknown; y: unknown; w: unknown; h: unknown }
          const [bx, by, bw, bh]: number[] = [b.x, b.y, b.w, b.h] as number[]
          if (![bx, by, bw, bh].every(isNum) || bx < 0 || by < 0 || bw <= 0 || bh <= 0 || bx + bw > 1.0001 || by + bh > 1.0001) {
            errors.push('paperRef.anchor.bbox 需为页内归一化 [0,1] 的 {x,y,w,h}（x+w、y+h ≤ 1）')
          }
        }
        if (anchor.note !== undefined && !isStr(anchor.note)) errors.push('paperRef.anchor.note 必须是字符串')
      } else {
        errors.push('paperRef.anchor 必须是 { page, bbox?, note? } 对象')
      }
    }
  }
  if (!isStr(w.objective)) errors.push('objective（目标一句话）缺失')
  if (!w.goal || !Array.isArray(w.goal.constraints) || w.goal.constraints.length === 0) errors.push('goal.constraints 至少一条')
  else {
    const ids = new Set<string>()
    for (const k of w.goal.constraints) {
      if (!k || typeof k !== 'object') { errors.push('goal.constraints 含非法元素（null 或非对象）'); continue }
      if (typeof k.kind !== 'string') { errors.push('每条约束需要 kind 字符串'); continue }
      if (!isStr(k.id)) errors.push('每条约束需要 id')
      else if (ids.has(k.id)) errors.push(`约束 id ${k.id} 重复`)
      else ids.add(k.id)
    }
  }
  if (!w.goal || !Number.isInteger(w.goal.attempts) || w.goal.attempts < 1 || w.goal.attempts > 50) errors.push('goal.attempts 需为 1…50 的整数')
  if (!Array.isArray(w.controls)) errors.push('controls 必须是数组（可为空）')
  else {
    // structural guard BEFORE any kind-narrowing: a null element or a missing
    // kind used to reach `c.id` in the per-model validators as a TypeError
    for (const c of w.controls) {
      if (!c || typeof c !== 'object') { errors.push('controls 含非法元素（null 或非对象）'); continue }
      if (typeof c.kind !== 'string') errors.push('controls 的每个元素需要 kind 字符串')
      if (!isStr((c as ControlDecl).id)) errors.push('controls 的每个元素需要 id')
    }
  }
  if (!w.model || (w.model.kind !== 'formula' && w.model.kind !== 'ode' && w.model.kind !== 'kakeya')) {
    unsupported.push('model.kind 只支持 "formula"（显式函数 → formula.plot/evaluate）、"ode"（自主 N 态系统 → model.solve）或 "kakeya"（δ-管族重排 → kakeya.measure）')
  }
  if (errors.length || unsupported.length) return { ok: false, errors, unsupported }
  if (w.model.kind === 'formula') validateFormula(w.model, w, errors, unsupported, warnings)
  else if (w.model.kind === 'ode') validateOde(w.model, w, errors, unsupported)
  else validateKakeya(w.model, w, errors, unsupported, warnings)
  if (errors.length || unsupported.length) return { ok: false, errors, unsupported }
  return { ok: true, world: w, warnings }
}
