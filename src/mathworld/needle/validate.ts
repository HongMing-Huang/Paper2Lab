// Needle world validation (CLI-129). Structural checks plus the REAL
// geometry gate: the start pose must be lattice and statically safe — a
// level that opens in collision is refused, never silently nudged.
import {
  isOnLattice,
  staticClearance,
  SAFETY_EPS,
  type NeedleWall,
  type NeedleWorldDef,
} from './model'

export const NEEDLE_SCHEMA = 'paper2lab.mathworld.needle/v1'

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0

function checkRect(w: unknown, where: string, errors: string[]): NeedleWall | null {
  const r = w as NeedleWall
  if (!r || ![r.x0, r.y0, r.x1, r.y1].every(isNum)) {
    errors.push(`${where} 需要有限数字 x0/y0/x1/y1`)
    return null
  }
  if (!(r.x0 < r.x1 && r.y0 < r.y1)) {
    errors.push(`${where} 必须满足 x0<x1 且 y0<y1（退化矩形非法）`)
    return null
  }
  return r
}

export type NeedleValidation =
  | { ok: true; world: NeedleWorldDef; warnings: string[] }
  | { ok: false; errors: string[] }

export function validateNeedleWorld(raw: unknown): NeedleValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const w = raw as NeedleWorldDef
  if (!w || typeof w !== 'object') return { ok: false, errors: ['世界定义必须是 JSON 对象'] }
  if (w.schema !== NEEDLE_SCHEMA) errors.push(`schema 必须是 "${NEEDLE_SCHEMA}"`)
  if (!isStr(w.id) || !/^[a-z0-9][a-z0-9-]{1,48}$/.test(w.id)) errors.push('id 需为 2…49 位小写字母/数字/连字符')
  if (!isStr(w.title)) errors.push('title 缺失')
  if (!w.origin || (w.origin.kind !== 'dev-sample' && w.origin.kind !== 'edited') || !isStr(w.origin.note)) {
    errors.push('origin 必须是 { kind: "dev-sample" | "edited", note } —— 来源必须如实标注')
  }
  if (!isStr(w.premise)) errors.push('premise 缺失')
  if (!isStr(w.objective)) errors.push('objective 缺失')
  const m = w.model
  if (!m || m.kind !== 'needle') {
    errors.push('model.kind 必须是 "needle"')
    return { ok: false, errors }
  }
  const W = m.bounds?.width
  const H = m.bounds?.height
  if (!isNum(W) || !isNum(H) || W <= 0 || H <= 0) errors.push('bounds.width/height 必须为正')
  if (!isNum(m.cell) || m.cell <= 0) errors.push('cell 必须为正')
  else {
    const nx = (W ?? 0) / m.cell
    const ny = (H ?? 0) / m.cell
    if (Math.abs(nx - Math.round(nx)) > 1e-9 || Math.abs(ny - Math.round(ny)) > 1e-9) errors.push('bounds 必须能被 cell 整除（格点有限图）')
    if (Math.round(nx) > 60 || Math.round(ny) > 60) errors.push('格点每轴不超过 60（有限图求解预算）')
  }
  if (!isNum(m.halfLen) || m.halfLen <= 0) errors.push('halfLen 必须为正')
  if (!isNum(m.radius) || m.radius <= 0) errors.push('radius 必须为正')
  if (isNum(m.halfLen) && isNum(m.cell) && m.halfLen <= m.cell) warnings.push('杆半长不大于一格：多数旋转可能天然安全，难度偏低')
  if (!Array.isArray(m.walls)) errors.push('walls 必须是数组')
  else {
    for (let i = 0; i < m.walls.length; i++) {
      const r = checkRect(m.walls[i], `walls[${i}]`, errors)
      if (r && (isNum(W) && isNum(H)) && (r.x1 <= 0 || r.x0 >= W || r.y1 <= 0 || r.y0 >= H)) errors.push(`walls[${i}] 在世界边界之外没有意义`)
    }
  }
  const exit = checkRect(m.exit, 'exit', errors)
  if (exit && isNum(W) && isNum(H)) {
    if (exit.x0 < -1e-9 || exit.y0 < -1e-9 || exit.x1 > W + 1e-9 || exit.y1 > H + 1e-9) errors.push('exit 必须在世界边界内')
    if (isNum(m.radius) && (exit.x1 - exit.x0 < 2 * m.radius || exit.y1 - exit.y0 < 2 * m.radius)) {
      errors.push('exit 区域按半径 r 内缩后为空：整杆不可能完全进入，关卡无解')
    }
    if (isNum(m.halfLen) && isNum(m.radius) && exit.y1 - exit.y0 < 2 * m.halfLen + 2 * m.radius + 2e-9) errors.push('exit 高度不足以竖直容纳整根杆（h 与 r 内缩后）')
  }
  if (m.exitOrientation !== 'vertical') errors.push('exitOrientation 当前只支持 "vertical"')
  if (!Number.isInteger(m.actionBudget) || m.actionBudget < 4 || m.actionBudget > 2000) errors.push('actionBudget 需为 4…2000 的整数')
  if (!Number.isInteger(m.sweepBudget) || m.sweepBudget < 16 || m.sweepBudget > 4096) errors.push('sweepBudget 需为 16…4096 的整数（整段认证二分预算）')
  const s = m.start
  if (!s || !isNum(s.x) || !isNum(s.y) || !Number.isInteger(s.k)) errors.push('start 需要 x/y 有限数与整数 k')
  if (errors.length) return { ok: false, errors }
  // geometry gates
  const latticeErr = isOnLattice(m, { cx: s.x, cy: s.y, k: s.k })
  if (latticeErr) {
    errors.push(`起点不在合法格点/朝向：${latticeErr}`)
    return { ok: false, errors }
  }
  const clearance = staticClearance(m, { cx: s.x, cy: s.y, k: s.k })
  if (clearance.clearance <= SAFETY_EPS) {
    errors.push(`起点本身与${clearance.source}接触或穿透（净距 ${clearance.clearance.toFixed(4)}）：关卡不能以非法状态开局`)
  }
  return errors.length ? { ok: false, errors } : { ok: true, world: w, warnings }
}
