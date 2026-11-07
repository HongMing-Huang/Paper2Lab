// δ-tubes in the unit cube [0,1]³ for the Wang–Zahl Kakeya experiment.
// A tube = radius-δ neighbourhood of a unit line segment (a "capsule");
// |T| ≈ πδ²·1 up to cap corrections, matching the paper's δ-tube volume ~δ².
import type { Vec3 } from './directions'

export interface Tube3 {
  /** unit direction of the segment */
  dir: Vec3
  /** midpoint of the segment */
  center: Vec3
  /** tube radius δ */
  radius: number
  /** segment length (1 in the classic experiment; the playable room may shorten
   *  the family so EVERY direction's capsule fits inside [0,1]³) */
  length: number
}

// mulberry32 — tiny deterministic PRNG so "spread" origins are reproducible.
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * Build N tubes with directions from the Fibonacci sphere.
 *
 * `packing` ∈ [0,1] interpolates every tube's midpoint between a reproducible
 * quasi-spread position (0 = "separated": tubes mostly disjoint) and the cube
 * centre (1 = "packed/sticky": all tubes pass through one point — the sticky
 * Kakeya configuration).
 *
 * Midpoints are constrained so the whole unit segment stays inside [0,1]³:
 * center_i ∈ [|dir_i|/2, 1-|dir_i|/2].
 */
export function makeTubes(
  dirs: Vec3[],
  delta: number,
  packing: number,
  seed = 20250224,
  length = 1,
): Tube3[] {
  const rand = mulberry32(seed)
  const p = clamp(packing, 0, 1)
  // the classic experiment (length = 1) keeps its published layout EXACTLY:
  // the segment stays in [0,1]³ and the measurement clips the capsule to the
  // cube. A playable family (length < 1) must instead keep the WHOLE capsule
  // inside — the base layout is generated inside the radius-shrunk box so the
  // starting position is always a legal, scoreable arrangement.
  const shrink = length < 1 ? delta : 0
  const tubes: Tube3[] = []
  for (const dir of dirs) {
    const ax = (Math.abs(dir.x) * length) / 2 + shrink
    const ay = (Math.abs(dir.y) * length) / 2 + shrink
    const az = (Math.abs(dir.z) * length) / 2 + shrink
    const lo = { x: ax, y: ay, z: az }
    const hi = { x: 1 - ax, y: 1 - ay, z: 1 - az }
    // spread origin: uniform in the admissible box, seeded/deterministic
    const spread = {
      x: lo.x + (hi.x - lo.x) * rand(),
      y: lo.y + (hi.y - lo.y) * rand(),
      z: lo.z + (hi.z - lo.z) * rand(),
    }
    const sticky = { x: 0.5, y: 0.5, z: 0.5 }
    tubes.push({
      dir,
      center: {
        x: spread.x + (sticky.x - spread.x) * p,
        y: spread.y + (sticky.y - spread.y) * p,
        z: spread.z + (sticky.z - spread.z) * p,
      },
      radius: delta,
      length,
    })
  }
  return tubes
}

/** Endpoints of a tube's core segment. */
export function segmentOf(t: Tube3): { a: Vec3; b: Vec3 } {
  return {
    a: {
      x: t.center.x - (t.dir.x * t.length) / 2,
      y: t.center.y - (t.dir.y * t.length) / 2,
      z: t.center.z - (t.dir.z * t.length) / 2,
    },
    b: {
      x: t.center.x + (t.dir.x * t.length) / 2,
      y: t.center.y + (t.dir.y * t.length) / 2,
      z: t.center.z + (t.dir.z * t.length) / 2,
    },
  }
}

// ---- per-tube offsets (Kakeya 可玩 MVP · CLI-149) --------------------------
// The playable world moves tube CLUSTERS: the direction, length and radius of
// every tube stay frozen (the Kakeya contract — you rearrange a fixed tube
// family, you never edit a tube). An offset moves a tube's centre; the whole
// capsule (segment ± δ) must stay inside the scoring domain [0,1]³, otherwise
// a player could park tubes half outside the measurement box and shrink the
// measured union without actually packing — cheating the score.

export interface Offset3 { x: number; y: number; z: number }

/** the centre box that keeps the tube's WHOLE capsule inside [0,1]³ */
export function centerBoxOf(t: Tube3): { min: Offset3; max: Offset3 } {
  const r = t.radius
  const ex = (Math.abs(t.dir.x) * t.length) / 2 + r
  const ey = (Math.abs(t.dir.y) * t.length) / 2 + r
  const ez = (Math.abs(t.dir.z) * t.length) / 2 + r
  return {
    min: { x: ex, y: ey, z: ez },
    max: { x: 1 - ex, y: 1 - ey, z: 1 - ez },
  }
}

/** apply one offset per tube (same order as the family). Throws with the
 *  tube's index and the violated bound when any capsule would leave the
 *  scoring domain — callers surface that as an invalid action, never as a
 *  smaller measured volume. */
export function applyOffsets(tubes: Tube3[], offsets: Offset3[] | undefined): Tube3[] {
  if (offsets === undefined) return tubes
  if (offsets.length !== tubes.length) {
    throw new Error(`offsets 数量 ${offsets.length} 与管束数 ${tubes.length} 不符（每根管一个偏移）`)
  }
  return tubes.map((t, i) => {
    const o = offsets[i]
    const box = centerBoxOf(t)
    const c = { x: t.center.x + o.x, y: t.center.y + o.y, z: t.center.z + o.z }
    for (const axis of ['x', 'y', 'z'] as const) {
      if (c[axis] < box.min[axis] || c[axis] > box.max[axis]) {
        throw new Error(
          `第 ${i} 根管的胶囊会越出计分域 [0,1]³（${axis} 方向中心 ${c[axis].toFixed(4)} 超出 [${box.min[axis].toFixed(4)}, ${box.max[axis].toFixed(4)}]，含半径 δ=${t.radius.toFixed(4)}），拒绝——不能把管移出测量盒刷体积`,
        )
      }
    }
    return { ...t, center: c }
  })
}

