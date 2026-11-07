// Independent Goal evaluation (CLI-129). Reads ONLY frozen ExperimentRuns from
// the protocol history plus the frozen world definition and the action's
// frozen parameters. It never sees preview numbers or renderer state, and it
// re-checks that every run really answers THIS input before trusting it — a
// run for other parameters, an error run or a non-resolved run is invalid
// evidence, never a pass. Browser-local evaluation: not server-authoritative.
import { getExperimentRun, type ExperimentRun } from '../experiments/protocol'
import type {
  Assessment,
  AvoidBoxConstraint,
  ConstraintCheck,
  FinalRangeConstraint,
  FormulaModel,
  GateConstraint,
  KakeyaModel,
  KakeyaVolumeConstraint,
  OdeModel,
  QualityReport,
  ReachBallConstraint,
  SeriesMaxConstraint,
  WorldDefinition,
} from './definition'
import { kakeyaOffsetArray } from './kernels'

export const GOAL_EVALUATOR = 'mathworld-goal@0.1 · 浏览器本地判定（非服务端权威）'

export interface FormulaEvidence { kind: 'formula'; curveRunId: string; gateRunIds: Record<string, string> }
export interface OdeEvidence { kind: 'ode'; solveRunId: string; refineRunId: string }
export type Evidence = FormulaEvidence | OdeEvidence | KakeyaEvidence

export function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v)
  const a = Math.abs(v)
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2)
  return Number(v.toFixed(a < 1 ? 4 : 3)).toString()
}

class EvidenceError extends Error {}

function readRun(runId: string | undefined, kind: string): ExperimentRun {
  if (!runId) throw new EvidenceError('缺少 Run 证据')
  const run = getExperimentRun(runId)
  if (!run) throw new EvidenceError(`Run ${runId} 不在本机 Run 记录中`)
  if (run.spec.kind !== kind) throw new EvidenceError(`Run ${runId} 的种类是 ${run.spec.kind}，不是 ${kind}`)
  if (run.status !== 'resolved' || run.errors.length > 0 || run.result === undefined) {
    throw new EvidenceError(`Run ${runId} 未成功（${run.status}${run.errors.length ? `：${run.errors[0]}` : ''}）`)
  }
  return run
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function requireBindings(run: ExperimentRun, recorded: Record<string, number> | undefined, expected: Record<string, number>, what: string) {
  for (const [k, v] of Object.entries(expected)) {
    if (!recorded || recorded[k] !== v) throw new EvidenceError(`Run ${run.runId} 记录的 ${what}.${k}=${recorded?.[k]} 与本次输入 ${v} 不符`)
  }
}

// ---- formula worlds ---------------------------------------------------------

function gateCheck(k: GateConstraint, model: FormulaModel, params: Record<string, number>, runId: string): ConstraintCheck {
  const run = readRun(runId, 'formula.value')
  const m = run.spec.model as { expression?: string; bindings?: Record<string, number> }
  if (m.expression !== model.expression) throw new EvidenceError(`闸门 ${k.id} 的 Run 表达式与世界模型不符`)
  requireBindings(run, m.bindings, { ...params, [model.independent]: k.x }, 'bindings')
  const y = (run.result as { value: number }).value
  const label = k.label ?? k.id
  const at = `${model.output}(${fmt(k.x)})`
  const base = {
    constraintId: k.id, label, kind: k.kind,
    measured: `${at} = ${fmt(y)}`,
    requirement: `${fmt(k.min)} ≤ ${at} ≤ ${fmt(k.max)}`,
    scope: 'formula.evaluate 单点求值（Cortex 编译为 JS，双精度）',
    runIds: [runId],
  }
  const margin = Math.min(y - k.min, k.max - y)
  const tiny = 1e-9 * Math.max(1, Math.abs(k.min), Math.abs(k.max))
  if (Math.abs(margin) <= tiny) {
    return { ...base, status: 'unknown', margin, explanation: `${at} 恰好贴在开口边缘（差距 ${fmt(margin)} 在浮点精度内），不判输赢` }
  }
  if (y < k.min) return { ...base, status: 'fail', margin, explanation: `${at} = ${fmt(y)} 低于开口下沿 ${fmt(k.min)}，还差 ${fmt(k.min - y)}` }
  if (y > k.max) return { ...base, status: 'fail', margin, explanation: `${at} = ${fmt(y)} 高于开口上沿 ${fmt(k.max)}，超出 ${fmt(y - k.max)}` }
  return { ...base, status: 'pass', margin, explanation: `${at} = ${fmt(y)} 在开口内，离最近边缘 ${fmt(margin)}` }
}

function avoidBoxCheck(k: AvoidBoxConstraint, model: FormulaModel, points: Array<[number, number]>, runId: string): ConstraintCheck {
  const label = k.label ?? k.id
  const base = {
    constraintId: k.id, label, kind: k.kind,
    requirement: `x∈[${fmt(k.xMin)}, ${fmt(k.xMax)}] 时 ${model.output} ∉ [${fmt(k.yMin)}, ${fmt(k.yMax)}]`,
    runIds: [runId],
  }
  const idx: number[] = []
  points.forEach(([x], i) => { if (x >= k.xMin && x <= k.xMax) idx.push(i) })
  const scope = `formula.plot 有限采样（区间内 ${idx.length} 点；样本之间未认证）`
  if (idx.length === 0) {
    return { ...base, scope, status: 'unknown', margin: null, measured: '禁区 x 范围内没有采样点', explanation: '采样没有覆盖禁区的 x 范围，无法判定' }
  }
  let inside = -1
  let insideCount = 0
  let clearance = Infinity
  for (const i of idx) {
    const y = points[i][1]
    if (y >= k.yMin && y <= k.yMax) {
      insideCount++
      if (inside < 0) inside = i
      continue
    }
    clearance = Math.min(clearance, y < k.yMin ? k.yMin - y : y - k.yMax)
  }
  if (inside >= 0) {
    const [x, y] = points[inside]
    return {
      ...base, scope, status: 'fail', margin: null,
      measured: `${insideCount} 个采样点落入禁区`,
      explanation: `x = ${fmt(x)} 处 ${model.output} = ${fmt(y)} 进入禁区（共 ${insideCount} 个采样点在里面）`,
    }
  }
  // heuristic inter-sample excursion: half the largest neighbour step around the box
  let gap = 0
  const lo = Math.max(0, idx[0] - 1)
  const hi = Math.min(points.length - 1, idx[idx.length - 1] + 1)
  for (let i = lo; i < hi; i++) gap = Math.max(gap, Math.abs(points[i + 1][1] - points[i][1]) / 2)
  if (clearance <= gap) {
    return {
      ...base, scope, status: 'unknown', margin: clearance,
      measured: `最小间隙 ${fmt(clearance)}`,
      explanation: `采样点都在禁区外，但最小间隙 ${fmt(clearance)} 不大于样本间可能的起伏 ${fmt(gap)}（启发式估计），无法确认没擦到`,
    }
  }
  return {
    // CLI-129 数值语义修复：邻样本差不是区间界——禁区检查明确采用【离散采样
    // 规则】：pass 只断言“N 个采样点都在禁区外且间隙大于局部起伏估计”，
    // 不声称采样点之间的连续区间避开了禁区（见 scope）。
    ...base,
    scope: `离散采样规则：区间内 ${idx.length} 个采样点逐点判定（样本之间的连续区间未认证；间隙 > 局部起伏估计 ${fmt(gap)}）`,
    status: 'pass', margin: clearance,
    measured: `最小间隙 ${fmt(clearance)}`,
    explanation: `区间内 ${idx.length} 个采样点都在禁区外，最小间隙 ${fmt(clearance)}（仅采样点判定，样本间未认证）`,
  }
}

function evaluateFormula(world: WorldDefinition, model: FormulaModel, params: Record<string, number>, ev: FormulaEvidence): Assessment {
  const curve = readRun(ev.curveRunId, 'formula.curve')
  const cm = curve.spec.model as { expression?: string; range?: unknown; samples?: number; values?: Record<string, number> }
  if (cm.expression !== model.expression) throw new EvidenceError('曲线 Run 的表达式与世界模型不符')
  if (!sameValue(cm.range, model.range) || cm.samples !== model.samples) throw new EvidenceError('曲线 Run 的采样区间/密度与世界模型不符')
  requireBindings(curve, cm.values, params, 'values')
  const points = (curve.result as { points: Array<[number, number]> }).points
  const checks = world.goal.constraints.map((k) => {
    if (k.kind === 'gate') return gateCheck(k, model, params, ev.gateRunIds[k.id])
    if (k.kind === 'avoid-box') return avoidBoxCheck(k, model, points, curve.runId)
    throw new EvidenceError(`formula 世界不支持约束 ${k.kind}`)
  })
  return summarize(checks)
}

// ---- ode worlds -------------------------------------------------------------

interface SolvedSeries { t: number[]; series: Array<{ state: string; values: number[] }>; steps: number }

function readSolve(runId: string, model: OdeModel, params: Record<string, number>, initial: Record<string, number>, steps: number): SolvedSeries {
  const run = readRun(runId, 'model.solved')
  const m = run.spec.model as { rhs?: unknown; params?: Record<string, number>; initialState?: Record<string, number>; tSpan?: unknown; steps?: number }
  if (!sameValue(m.rhs, model.rhs)) throw new EvidenceError(`Run ${runId} 的方程与世界模型不符`)
  if (!sameValue(m.tSpan, model.tSpan)) throw new EvidenceError(`Run ${runId} 的时间区间与世界模型不符`)
  if (m.steps !== steps) throw new EvidenceError(`Run ${runId} 的步数 ${m.steps} 不是预期的 ${steps}`)
  requireBindings(run, m.params, params, 'params')
  requireBindings(run, m.initialState, initial, 'initialState')
  return run.result as SolvedSeries
}

function seriesOf(s: SolvedSeries, state: string): number[] {
  const found = s.series.find((x) => x.state === state)
  if (!found) throw new EvidenceError(`Run 结果缺少状态 ${state}`)
  return found.values
}

function seriesMaxCheck(k: SeriesMaxConstraint, s: SolvedSeries, err: number, runIds: string[]): ConstraintCheck {
  const v = seriesOf(s, k.state)
  let at = 0
  for (let i = 1; i < v.length; i++) if (v[i] > v[at]) at = i
  const m = v[at]
  const gap = Math.max(at > 0 ? Math.abs(v[at] - v[at - 1]) : 0, at < v.length - 1 ? Math.abs(v[at + 1] - v[at]) : 0) / 2
  const label = k.label ?? k.id
  const base = {
    constraintId: k.id, label, kind: k.kind,
    measured: `max ${k.state} = ${fmt(m)}（t ≈ ${fmt(s.t[at])}）`,
    requirement: `max ${k.state} ≤ ${fmt(k.max)}`,
    scope: `model.solve 输出采样 ${v.length} 点的最大值；样本间可能更高（启发式 ±${fmt(gap)}），数值差 ±${fmt(err)}`,
    runIds,
  }
  if (m - err > k.max) return { ...base, status: 'fail', margin: k.max - m, explanation: `${k.state} 的峰值 ${fmt(m)} 出现在 t ≈ ${fmt(s.t[at])}，超过上限 ${fmt(k.max)} 共 ${fmt(m - k.max)}` }
  if (m + gap + err < k.max) return { ...base, status: 'pass', margin: k.max - m, explanation: `${k.state} 的峰值 ${fmt(m)}（t ≈ ${fmt(s.t[at])}）低于上限 ${fmt(k.max)}，余量 ${fmt(k.max - m)}` }
  return { ...base, status: 'unknown', margin: k.max - m, explanation: `${k.state} 的采样峰值 ${fmt(m)} 离上限 ${fmt(k.max)} 太近（在样本间起伏 + 数值差 ${fmt(gap + err)} 以内），不判输赢` }
}

function finalRangeCheck(k: FinalRangeConstraint, s: SolvedSeries, err: number, runIds: string[]): ConstraintCheck {
  const v = seriesOf(s, k.state)
  const f = v[v.length - 1]
  const t1 = s.t[s.t.length - 1]
  const label = k.label ?? k.id
  const req = [k.min !== undefined ? `${fmt(k.min)} ≤` : '', `${k.state}(${fmt(t1)})`, k.max !== undefined ? `≤ ${fmt(k.max)}` : ''].filter(Boolean).join(' ')
  const base = {
    constraintId: k.id, label, kind: k.kind,
    measured: `${k.state}(${fmt(t1)}) = ${fmt(f)}`,
    requirement: req,
    scope: `model.solve 终点值；步长加密差 ±${fmt(err)}`,
    runIds,
  }
  if (k.min !== undefined && f + err < k.min) return { ...base, status: 'fail', margin: f - k.min, explanation: `终点 ${k.state} = ${fmt(f)} 低于下限 ${fmt(k.min)}，还差 ${fmt(k.min - f)}` }
  if (k.max !== undefined && f - err > k.max) return { ...base, status: 'fail', margin: k.max - f, explanation: `终点 ${k.state} = ${fmt(f)} 高于上限 ${fmt(k.max)}，超出 ${fmt(f - k.max)}` }
  const lowOk = k.min === undefined || f - err >= k.min
  const highOk = k.max === undefined || f + err <= k.max
  const margin = Math.min(k.min !== undefined ? f - k.min : Infinity, k.max !== undefined ? k.max - f : Infinity)
  if (lowOk && highOk) return { ...base, status: 'pass', margin, explanation: `终点 ${k.state} = ${fmt(f)} 在要求范围内，余量 ${fmt(margin)}` }
  return { ...base, status: 'unknown', margin, explanation: `终点 ${k.state} = ${fmt(f)} 与边界相差在数值差 ${fmt(err)} 以内，不判输赢` }
}

function reachBallCheck(k: ReachBallConstraint, s: SolvedSeries, err: number, runIds: string[]): ConstraintCheck {
  const keys = Object.keys(k.center)
  const cols = keys.map((st) => seriesOf(s, st))
  const n = s.t.length
  let best = Infinity
  let at = 0
  let seg = 0
  for (let i = 0; i < n; i++) {
    let d2 = 0
    let s2 = 0
    keys.forEach((st, j) => {
      d2 += (cols[j][i] - k.center[st]) ** 2
      if (i > 0) s2 += (cols[j][i] - cols[j][i - 1]) ** 2
    })
    seg = Math.max(seg, Math.sqrt(s2) / 2)
    if (Math.sqrt(d2) < best) { best = Math.sqrt(d2); at = i }
  }
  const label = k.label ?? k.id
  const base = {
    constraintId: k.id, label, kind: k.kind,
    measured: `最近距离 ${fmt(best)}（t ≈ ${fmt(s.t[at])}）`,
    requirement: `轨迹进入半径 ${fmt(k.radius)} 的目标球`,
    scope: `model.solve 输出采样 ${n} 点；样本间路径未认证（±${fmt(seg)}），数值差 ±${fmt(err)}`,
    runIds,
  }
  if (best + err <= k.radius) return { ...base, status: 'pass', margin: k.radius - best, explanation: `t ≈ ${fmt(s.t[at])} 时轨迹进入目标球，最近距离 ${fmt(best)} ≤ 半径 ${fmt(k.radius)}` }
  if (best - seg - err > k.radius) return { ...base, status: 'fail', margin: k.radius - best, explanation: `轨迹离目标中心最近 ${fmt(best)}（t ≈ ${fmt(s.t[at])}），比半径 ${fmt(k.radius)} 远 ${fmt(best - k.radius)}` }
  return { ...base, status: 'unknown', margin: k.radius - best, explanation: `轨迹最近距离 ${fmt(best)} 与半径 ${fmt(k.radius)} 的差在采样/数值不确定度内，不判输赢` }
}

function evaluateOde(world: WorldDefinition, model: OdeModel, params: Record<string, number>, initial: Record<string, number>, ev: OdeEvidence): Assessment {
  const solve = readSolve(ev.solveRunId, model, params, initial, model.steps)
  const refine = readSolve(ev.refineRunId, model, params, initial, model.steps * 2)
  if (solve.t.length !== refine.t.length) throw new EvidenceError('加密对照 Run 的输出采样点数不一致')
  let maxDiff = 0
  for (let i = 0; i < solve.t.length; i++) {
    if (Math.abs(solve.t[i] - refine.t[i]) > 1e-9 * Math.max(1, Math.abs(solve.t[i]))) throw new EvidenceError('加密对照 Run 的输出时刻不一致')
    for (const st of solve.series) {
      const other = seriesOf(refine, st.state)
      maxDiff = Math.max(maxDiff, Math.abs(st.values[i] - other[i]))
    }
  }
  const tol = model.refineCheck.tol
  const quality: QualityReport = {
    method: 'step-refinement',
    steps: [model.steps, model.steps * 2],
    maxDiff,
    tol,
    status: maxDiff <= tol ? 'provisional' : 'unknown',
    runIds: [ev.solveRunId, ev.refineRunId],
    note: '定步长 RK4 与 2 倍步数重算的最大差，是收敛估计而非严格误差界',
  }
  const runIds = [ev.solveRunId, ev.refineRunId]
  if (quality.status === 'unknown') {
    const checks: ConstraintCheck[] = world.goal.constraints.map((k) => ({
      constraintId: k.id, label: k.label ?? k.id, kind: k.kind, status: 'unknown', measured: '—', requirement: '—', margin: null,
      explanation: `数值不确定：两种步长结果相差 ${fmt(maxDiff)}，超过容差 ${fmt(tol)}，本次不判输赢`,
      scope: '步长加密对照未通过', runIds,
    }))
    return { ...summarize(checks), quality }
  }
  const err = maxDiff
  const checks = world.goal.constraints.map((k) => {
    if (k.kind === 'series-max') return seriesMaxCheck(k, solve, err, runIds)
    if (k.kind === 'final-range') return finalRangeCheck(k, solve, err, runIds)
    if (k.kind === 'reach-ball') return reachBallCheck(k, solve, err, runIds)
    throw new EvidenceError(`ode 世界不支持约束 ${k.kind}`)
  })
  return { ...summarize(checks), quality }
}

// ---- kakeya worlds (方向之室 · CLI-149) -------------------------------------

export interface KakeyaEvidence {
  kind: 'kakeya'
  /** kakeya.measure at the model's scoring resolution */
  measureRunId: string
  /** kakeya.measure at refineRes — the convergence estimate (never a second score) */
  refineRunId: string
}

interface VoxelResultShape { occupiedVolume: number; res: number }

/** read one kakeya.voxel run and re-bind it to THIS layout: family
 *  (deltaExp/nTubes/packing), resolution and the full offsets array must match
 *  the action's input, or the evidence is invalid — a run for another
 *  arrangement can never score this one */
function readMeasure(runId: string, model: KakeyaModel, offsets: Array<{ x: number; y: number; z: number }>, res: number, what: string): VoxelResultShape {
  const run = readRun(runId, 'kakeya.voxel')
  if (run.spec.kind !== 'kakeya.voxel') throw new EvidenceError(`${what} 的种类是 ${run.spec.kind}`)
  const m = run.spec.model as { deltaExp?: number; nTubes?: number; packing?: number; res?: number; length?: number; offsets?: unknown }
  if (m.deltaExp !== model.deltaExp || m.nTubes !== model.nTubes || m.packing !== model.packing) {
    throw new EvidenceError(`${what} 的管族（deltaExp/nTubes/packing）与本局不符`)
  }
  if ((m.length ?? 1) !== model.length) {
    throw new EvidenceError(`${what} 的管长 ${m.length ?? 1} ≠ 本局的 ${model.length}`)
  }
  if (m.res !== res) throw new EvidenceError(`${what} 的分辨率 ${m.res} ≠ 要求的 ${res}`)
  if (JSON.stringify(m.offsets ?? null) !== JSON.stringify(offsets.length ? offsets : null)) {
    throw new EvidenceError(`${what} 记录的管簇偏移与本局输入不符（布局不同，不能互用证据）`)
  }
  const r = run.result as { occupiedVolume?: number }
  if (typeof r.occupiedVolume !== 'number' || !Number.isFinite(r.occupiedVolume)) throw new EvidenceError(`${what} 缺少有效的 occupiedVolume`)
  return { occupiedVolume: r.occupiedVolume, res }
}

function evaluateKakeya(world: WorldDefinition, model: KakeyaModel, ev: KakeyaEvidence, offsets: Array<{ x: number; y: number; z: number }>): Assessment {
  const runIds = [ev.measureRunId, ev.refineRunId]
  const k = world.goal.constraints.find((c): c is KakeyaVolumeConstraint => c.kind === 'kakeya-volume')
  const v = readMeasure(ev.measureRunId, model, offsets, model.res, '计分 Run')
  const v2 = readMeasure(ev.refineRunId, model, offsets, model.refineRes, '加密对照 Run')
  const label = k?.label ?? k?.id ?? '并集体积'
  const maxVolume = k?.maxVolume ?? 1
  const convTol = k?.convTol ?? 0.02
  const delta = 2 ** -model.deltaExp
  const base = {
    constraintId: k?.id ?? 'kakeya-volume', label, kind: 'kakeya-volume' as const,
    measured: `|⋃T| ≈ ${(v.occupiedVolume * 100).toFixed(2)}% 立方体`,
    requirement: `|⋃T| ≤ ${(maxVolume * 100).toFixed(2)}%（res ${model.res} 体素估计，${model.refineRes} 加密对照）`,
    scope: `kakeya.measure 有限体素估计（res=${model.res}/${model.refineRes}，δ=${fmt(delta)}）；有限尺度，非解析体积`,
    runIds,
  }
  // radius finer than ~half a voxel: the grid cannot resolve the tube — never score
  if (2 * delta * model.res < 0.5) {
    return { ...summarize([{
      ...base, status: 'unknown', margin: null,
      explanation: `管半径 δ=${fmt(delta)} 相对网格太细（2δ·res = ${fmt(2 * delta * model.res)} < 0.5 个体素），粗网格不能给这个布局计分，不判输赢`,
    }]) }
  }
  const conv = Math.abs(v.occupiedVolume - v2.occupiedVolume)
  const quality: QualityReport = {
    method: 'step-refinement',
    steps: [model.res, model.refineRes],
    maxDiff: conv,
    tol: convTol,
    status: conv <= convTol ? 'provisional' : 'unknown',
    runIds: [ev.measureRunId, ev.refineRunId] as [string, string],
    note: '两种分辨率体素估计的体积差，是收敛估计而非严格误差界',
  }
  if (quality.status === 'unknown') {
    return {
      ...summarize([{
        ...base, status: 'unknown', margin: maxVolume - v.occupiedVolume,
        explanation: `数值不确定：res ${model.res} 与 ${model.refineRes} 的体积相差 ${fmt(conv)}，超过容差 ${fmt(convTol)}，本次不判输赢（不能拿粗网格计分）`,
      }]), quality,
    }
  }
  const margin = maxVolume - v.occupiedVolume
  const tiny = 1e-4 // volume is a fraction of the unit cube; a hair-thin margin is not a pass
  if (Math.abs(margin) <= tiny) {
    return { ...summarize([{
      ...base, status: 'unknown', margin,
      explanation: `体积 ${(v.occupiedVolume * 100).toFixed(3)}% 贴着上限 ${(maxVolume * 100).toFixed(2)}%（差 ${fmt(Math.abs(margin))}），在估计精度内不判输赢`,
    }]), quality }
  }
  if (margin < 0) {
    return { ...summarize([{
      ...base, status: 'fail', margin,
      explanation: `并集体积 ${(v.occupiedVolume * 100).toFixed(2)}% 超过上限 ${(maxVolume * 100).toFixed(2)}%，还需收拢 ${((-margin) * 100).toFixed(2)} 个百分点——试着把可动簇往别的管密集处叠`,
    }]), quality }
  }
  return { ...summarize([{
    ...base, status: 'pass', margin,
    explanation: `并集体积 ${(v.occupiedVolume * 100).toFixed(2)}% ≤ 上限 ${(maxVolume * 100).toFixed(2)}%，余量 ${(margin * 100).toFixed(2)} 个百分点（有限尺度估计）`,
  }]), quality }
}

// ---- shared -----------------------------------------------------------------

function summarize(checks: ConstraintCheck[]): Assessment {
  const fails = checks.filter((c) => c.status === 'fail')
  const unknowns = checks.filter((c) => c.status === 'unknown')
  if (fails.length) {
    return { outcome: 'fail', checks, evaluator: GOAL_EVALUATOR, summary: `${fails.length} 项未满足：${fails.map((c) => c.label).join('、')}` }
  }
  if (unknowns.length) {
    return { outcome: 'unknown', checks, evaluator: GOAL_EVALUATOR, summary: `没有违反，但 ${unknowns.length} 项数值上无法确定：${unknowns.map((c) => c.label).join('、')}` }
  }
  return { outcome: 'success', checks, evaluator: GOAL_EVALUATOR, summary: `全部 ${checks.length} 项约束满足` }
}

/** evaluate the frozen goal against frozen evidence; never throws */
export function evaluateGoal(
  world: WorldDefinition,
  params: Record<string, number>,
  initial: Record<string, number>,
  evidence: Evidence,
): Assessment {
  try {
    if (world.model.kind === 'formula' && evidence.kind === 'formula') return evaluateFormula(world, world.model, params, evidence)
    if (world.model.kind === 'ode' && evidence.kind === 'ode') return evaluateOde(world, world.model, params, initial, evidence)
    if (world.model.kind === 'kakeya' && evidence.kind === 'kakeya') {
      // rebind: params carry the cluster offsets this action froze
      const offsets = kakeyaOffsetArray(world.model, clusterOffsetsOf(world.model, params))
      return evaluateKakeya(world, world.model, evidence, offsets)
    }
    throw new EvidenceError('证据类型与世界模型不匹配')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { outcome: 'invalid', checks: [], evaluator: GOAL_EVALUATOR, summary: `证据无效，不能判定：${message}` }
  }
}

/** cluster id → current offset, from the session's frozen numeric params
 *  (each axis is the tunable `${clusterId}.x/.y/.z`) */
function clusterOffsetsOf(model: KakeyaModel, params: Record<string, number>): Record<string, { x: number; y: number; z: number }> {
  const out: Record<string, { x: number; y: number; z: number }> = {}
  for (const c of model.clusters) {
    out[c.id] = {
      x: params[`${c.id}.x`] ?? 0,
      y: params[`${c.id}.y`] ?? 0,
      z: params[`${c.id}.z`] ?? 0,
    }
  }
  return out
}
