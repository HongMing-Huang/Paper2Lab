// 搬针过弯（needle-through-corridor）— canonical math model (CLI-129, 2026-11-07 slice).
//
// TypeScript port of the isolated PoC at
// docs/research/playable-mathematics-2026-11-02/mathworld/geometry-proof/PROOF.md
// (same math, same numeric policy): a closed capsule (centreline half-length
// h, radius r) on a bounded plane with closed rectangular walls. The ONLY
// position truth is the canonical state {cx, cy, k}; endpoints, display
// geometry, collision queries and the exit check are all DERIVED from it —
// React, Three and any solver read the same derivation, none owns a copy.
//
// Walls / thickness / exit / budget are GAME RULES for this teaching variant
// of moving a fixed-length needle. They are not the Wang–Zahl model and
// clearing the level proves no theorem.
//
// Self-contained module: the shared definition.ts/validate.ts are currently
// the integration owner's active files (Kakeya slice), so the needle world
// types live here and unification into MathModel is a serial minimal patch.

/** closed rectangular wall / block (game rule, not paper geometry) */
export interface NeedleWall { x0: number; y0: number; x1: number; y1: number }

/** the needle world's math model (data-driven: JSON in
 *  public/assets/mathworld/needle/, editable in the page) */
export interface NeedleModel {
  kind: 'needle'
  bounds: { width: number; height: number }
  /** lattice step for positions (centre at i·cell) */
  cell: number
  /** closed rectangular walls inside the bounds */
  walls: NeedleWall[]
  /** the exit docking region (convex rectangle) */
  exit: NeedleWall
  /** undirected axis vertical (k=4) is required to clear */
  exitOrientation: 'vertical'
  /** centreline half-length h and capsule radius r */
  halfLen: number
  radius: number
  start: { x: number; y: number; k: number }
  /** accepted actions allowed per attempt */
  actionBudget: number
  /** bisection interval budget for one whole-segment certification */
  sweepBudget: number
}

/** needle world file (its own schema until the shared union takes it in) */
export interface NeedleWorldDef {
  schema: 'paper2lab.mathworld.needle/v1'
  id: string
  title: string
  origin: { kind: 'dev-sample' | 'edited'; note: string }
  premise: string
  objective: string
  model: NeedleModel
  rules?: string[]
}

export const NEEDLE_GEOM_VERSION = 'needle-geom@0.1'
/** numeric safety policy of the PoC: clearances ≤ this are not certified safe
 *  (contact), and certified-whole-segment requires strict margin above it.
 *  Plain binary64 — conservative policy, not a machine-verified error bound. */
export const SAFETY_EPS = 1e-9
/** angle notches: k ∈ 0..7, θ = k·π/8, axis is UNDIRECTED (θ ≡ θ+π) */
export const ANGLE_STEPS = 8

export interface NeedleState {
  cx: number
  cy: number
  k: number
}

export interface Point { x: number; y: number }

export type NeedleAction =
  | { type: 'move'; dx: number; dy: number }
  | { type: 'rotate'; dir: 1 | -1 }

export const NEEDLE_ACTIONS: Array<{ id: string; action: NeedleAction; label: string }> = [
  { id: 'left', action: { type: 'move', dx: -1, dy: 0 }, label: '← 左移' },
  { id: 'right', action: { type: 'move', dx: 1, dy: 0 }, label: '→ 右移' },
  { id: 'up', action: { type: 'move', dx: 0, dy: 1 }, label: '↑ 上移' },
  { id: 'down', action: { type: 'move', dx: 0, dy: -1 }, label: '↓ 下移' },
  { id: 'ccw', action: { type: 'rotate', dir: 1 }, label: 'Q 逆旋' },
  { id: 'cw', action: { type: 'rotate', dir: -1 }, label: 'E 顺旋' },
]

export function actionById(id: string): NeedleAction | null {
  const found = NEEDLE_ACTIONS.find((a) => a.id === id)
  return found ? found.action : null
}

// ---- canonical state helpers -------------------------------------------------

export function angleOf(k: number): number {
  return (k * Math.PI) / ANGLE_STEPS
}

/** centreline endpoints derived from the canonical state (the single truth) */
export function endpointsOf(m: NeedleModel, s: NeedleState): [Point, Point] {
  const θ = angleOf(s.k)
  const dx = m.halfLen * Math.cos(θ)
  const dy = m.halfLen * Math.sin(θ)
  return [
    { x: s.cx + dx, y: s.cy + dy },
    { x: s.cx - dx, y: s.cy - dy },
  ]
}

export function stateKey(s: NeedleState): string {
  return `${s.cx},${s.cy},${s.k}`
}

/** lattice gate: exact grid positions and angle notches only (finite graph) */
export function isOnLattice(m: NeedleModel, s: { cx: number; cy: number; k: number }): string | null {
  if (!Number.isInteger(s.k) || s.k < 0 || s.k >= ANGLE_STEPS) return `朝向档 k=${s.k} 不是 0…${ANGLE_STEPS - 1} 的整数`
  for (const [name, v, bound] of [['cx', s.cx, m.bounds.width], ['cy', s.cy, m.bounds.height]] as const) {
    if (!Number.isFinite(v)) return `${name} 不是有限数`
    const units = v / m.cell
    if (Math.abs(units - Math.round(units)) > 1e-9) return `${name}=${v} 不在 ${m.cell} 的格点上`
    if (v < -1e-9 || v > bound + 1e-9) return `${name}=${v} 超出世界边界`
  }
  return null
}

/** the target state an action would produce (no legality check here) */
export function nextState(m: NeedleModel, s: NeedleState, a: NeedleAction): NeedleState {
  if (a.type === 'move') return { cx: s.cx + a.dx * m.cell, cy: s.cy + a.dy * m.cell, k: s.k }
  return { cx: s.cx, cy: s.cy, k: (((s.k + (a.dir === 1 ? 1 : -1)) % ANGLE_STEPS) + ANGLE_STEPS) % ANGLE_STEPS }
}

/** unwrapped target angle for interpolation: rotating +1 from k=7 crosses π */
export function unwrappedTargetAngle(s: NeedleState, dir: 1 | -1): number {
  return angleOf(s.k) + (dir * Math.PI) / ANGLE_STEPS
}

// ---- static geometry: exact segment ↔ closed AABB distance -------------------

interface Box { x0: number; y0: number; x1: number; y1: number }

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function pointBoxDistance2(p: Point, b: Box): number {
  const dx = clamp(p.x, b.x0, b.x1) - p.x
  const dy = clamp(p.y, b.y0, b.y1) - p.y
  return dx * dx + dy * dy
}

function pointSegmentDistance2(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const len2 = abx * abx + aby * aby
  let t = 0
  if (len2 > 0) t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / len2, 0, 1)
  const dx = a.x + t * abx - p.x
  const dy = a.y + t * aby - p.y
  return dx * dx + dy * dy
}

/** segment–AABB intersection via the slab method (touching counts) */
function segmentIntersectsBox(a: Point, b: Point, box: Box): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  let tmin = 0
  let tmax = 1
  // x slab
  if (Math.abs(dx) < 1e-15) {
    if (a.x < box.x0 || a.x > box.x1) return false
  } else {
    let t1 = (box.x0 - a.x) / dx
    let t2 = (box.x1 - a.x) / dx
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
    tmin = Math.max(tmin, t1)
    tmax = Math.min(tmax, t2)
    if (tmin > tmax) return false
  }
  // y slab
  if (Math.abs(dy) < 1e-15) {
    if (a.y < box.y0 || a.y > box.y1) return false
  } else {
    let t1 = (box.y0 - a.y) / dy
    let t2 = (box.y1 - a.y) / dy
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
    tmin = Math.max(tmin, t1)
    tmax = Math.min(tmax, t2)
    if (tmin > tmax) return false
  }
  return true
}

export interface StaticClearance {
  /** signed distance from the capsule (centreline ⊕ r) to the nearest
   *  obstacle; negative = penetration depth of the deepest centreline point */
  clearance: number
  /** closest point ON THE CENTRELINE (for contact display); null never
   *  happens in practice — kept optional for the JSON boundary */
  contact: Point | null
  /** which obstacle produced the minimum */
  source: string
}

/**
 * Clearance of the capsule for an arbitrary pose (centre + centreline
 * half-vector). Lattice states go through endpointsOf() → same routine, so
 * the canonical state stays the single derivation. For a DISJOINT segment
 * and closed convex polygon the closest pair is always (segment endpoint ↔
 * box) or (box corner ↔ segment); intersection is detected first. Plain
 * binary64 with the 1e-9 policy — exact in the PoC's documented sense.
 */
export function clearanceOfCapsule(
  m: NeedleModel,
  cx: number,
  cy: number,
  hx: number,
  hy: number,
): StaticClearance {
  const boxes: Array<{ name: string; box: Box }> = [
    ...m.walls.map((w, i) => ({ name: `墙 ${i + 1}`, box: w })),
    { name: '左边界', box: { x0: -1e6, y0: -1e6, x1: 0, y1: m.bounds.height + 1e6 } },
    { name: '右边界', box: { x0: m.bounds.width, y0: -1e6, x1: 1e6, y1: m.bounds.height + 1e6 } },
    { name: '下边界', box: { x0: -1e6, y0: -1e6, x1: m.bounds.width + 1e6, y1: 0 } },
    { name: '上边界', box: { x0: -1e6, y0: m.bounds.height, x1: 1e6, y1: 1e6 } },
  ]
  const p0 = { x: cx + hx, y: cy + hy }
  const p1 = { x: cx - hx, y: cy - hy }
  let best = Infinity
  let contact: Point | null = null
  let source = ''
  for (const { name, box } of boxes) {
    let clear: number
    let cp: Point
    if (segmentIntersectsBox(p0, p1, box)) {
      // centreline pierces the closed box → penetration (negative clearance)
      const dA = Math.sqrt(pointBoxDistance2(p0, box))
      const dB = Math.sqrt(pointBoxDistance2(p1, box))
      if (dA <= dB) { clear = -dA - m.radius; cp = p0 } else { clear = -dB - m.radius; cp = p1 }
    } else {
      // disjoint: min over endpoint↔box and corner↔segment pairs
      let d2 = Infinity
      cp = p0
      const corners: Point[] = [
        { x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 },
        { x: box.x0, y: box.y1 }, { x: box.x1, y: box.y1 },
      ]
      let cand = pointBoxDistance2(p0, box)
      if (cand < d2) { d2 = cand; cp = p0 }
      cand = pointBoxDistance2(p1, box)
      if (cand < d2) { d2 = cand; cp = p1 }
      for (const c of corners) {
        cand = pointSegmentDistance2(c, p0, p1)
        if (cand < d2) { d2 = cand; cp = c }
      }
      clear = Math.sqrt(d2) - m.radius
    }
    if (clear < best) { best = clear; contact = cp; source = name }
  }
  return { clearance: best, contact, source }
}

/** clearance of the capsule at a canonical lattice state */
export function staticClearance(m: NeedleModel, s: NeedleState): StaticClearance {
  const θ = angleOf(s.k)
  return clearanceOfCapsule(m, s.cx, s.cy, Math.cos(θ) * m.halfLen, Math.sin(θ) * m.halfLen)
}

// ---- whole-segment action certification (motion bound) -----------------------

export interface SweepCertificate {
  status: 'safe' | 'blocked' | 'unknown'
  /** minimum CERTIFIED clearance over the whole action (safe); clearance at
   *  the blocking sample (blocked); last unresolved midpoint (unknown) */
  minClearance: number
  /** bisection intervals evaluated (cost evidence) */
  intervals: number
  /** blocking sample location t∈[0,1] + contact + obstacle, when blocked */
  blockedAt: { t: number; contact: Point; source: string } | null
  computeMs: number
}

/**
 * Certify the WHOLE action path q0→q1 (centre translation Δc + unwrapped
 * rotation Δθ). Every centreline point moves at most L = ‖Δc‖ + h·|Δθ| per
 * unit t, so clearance to fixed obstacles is 1-Lipschitz along the path: for
 * a subinterval [a,b] the midpoint clearance d bounds the whole subinterval
 * below by d − L(b−a)/2. Subdivide until a subinterval is certified
 * (bound > SAFETY_EPS), a sample actually collides (blocked, with contact),
 * or the bisection budget is spent (unknown — never "probably fine").
 * Endpoints are evaluated explicitly so a touching end pose is never missed.
 */
export function certifyAction(
  m: NeedleModel,
  q0: NeedleState,
  a: NeedleAction,
  opts: { sweepBudget?: number } = {},
): SweepCertificate & { next: NeedleState } {
  const t0 = performance.now()
  const budget = opts.sweepBudget ?? m.sweepBudget
  const next = nextState(m, q0, a)
  const dθ = a.type === 'rotate' ? unwrappedTargetAngle(q0, a.dir) - angleOf(q0.k) : 0
  const Δc = Math.hypot(next.cx - q0.cx, next.cy - q0.cy)
  const L = Δc + m.halfLen * Math.abs(dθ)
  const θ0 = angleOf(q0.k)

  const clearAt = (t: number): StaticClearance => {
    const cx = q0.cx + (next.cx - q0.cx) * t
    const cy = q0.cy + (next.cy - q0.cy) * t
    const θ = θ0 + dθ * t
    return clearanceOfCapsule(m, cx, cy, Math.cos(θ) * m.halfLen, Math.sin(θ) * m.halfLen)
  }

  let intervals = 0
  let minCertified = Infinity
  // explicit endpoints first (a touching end pose blocks immediately)
  for (const t of [0, 1]) {
    const d = clearAt(t)
    intervals++
    if (d.clearance <= SAFETY_EPS) {
      return { status: 'blocked', minClearance: d.clearance, intervals, blockedAt: { t, contact: d.contact ?? { x: q0.cx, y: q0.cy }, source: d.source }, computeMs: performance.now() - t0, next }
    }
    minCertified = Math.min(minCertified, d.clearance)
  }

  const stack: Array<[number, number]> = [[0, 1]]
  while (stack.length > 0) {
    const [aa, bb] = stack.pop()!
    intervals++
    const mid = (aa + bb) / 2
    const d = clearAt(mid)
    if (d.clearance <= SAFETY_EPS) {
      return { status: 'blocked', minClearance: d.clearance, intervals, blockedAt: { t: mid, contact: d.contact ?? { x: q0.cx, y: q0.cy }, source: d.source }, computeMs: performance.now() - t0, next }
    }
    const bound = d.clearance - (L * (bb - aa)) / 2
    if (bound > SAFETY_EPS) {
      minCertified = Math.min(minCertified, bound)
      continue
    }
    if (intervals >= budget) {
      return { status: 'unknown', minClearance: d.clearance, intervals, blockedAt: null, computeMs: performance.now() - t0, next }
    }
    stack.push([aa, mid], [mid, bb])
  }
  return { status: 'safe', minClearance: minCertified, intervals, blockedAt: null, computeMs: performance.now() - t0, next }
}

// ---- the goal (independent of any transition) ---------------------------------

export interface GoalCheck {
  contained: boolean
  oriented: boolean
  endpoints: [Point, Point]
  /** per-endpoint containment margins in the shrunk region (negative = outside) */
  margins: [number, number]
  orientationK: number
  requiredK: number
}

/** whole capsule inside the exit region: both centreline endpoints inside
 *  exit ⊖ r (valid because the region is a convex rectangle and the capsule
 *  is centreline ⊕ r — endpoint-in-UNSHRUNK-box would let the round caps
 *  overhang), AND the undirected axis vertical (k=4). */
export function checkGoal(m: NeedleModel, s: NeedleState): GoalCheck {
  const [e0, e1] = endpointsOf(m, s)
  const inner = {
    x0: m.exit.x0 + m.radius,
    x1: m.exit.x1 - m.radius,
    y0: m.exit.y0 + m.radius,
    y1: m.exit.y1 - m.radius,
  }
  const marginOf = (p: Point): number =>
    Math.min(p.x - inner.x0, inner.x1 - p.x, p.y - inner.y0, inner.y1 - p.y)
  const m0 = marginOf(e0)
  const m1 = marginOf(e1)
  return {
    contained: m0 >= -SAFETY_EPS && m1 >= -SAFETY_EPS,
    oriented: s.k === 4,
    endpoints: [e0, e1],
    margins: [m0, m1],
    orientationK: s.k,
    requiredK: 4,
  }
}
