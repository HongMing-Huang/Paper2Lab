// δ-tubes in the unit cube [0,1]³ for the Wang–Zahl Kakeya experiment.
// A tube = radius-δ neighbourhood of a unit line segment (a "capsule");
// |T| ≈ πδ²·1 up to cap corrections, matching the paper's δ-tube volume ~δ².
import type { Vec3 } from './directions'

export interface Tube3 {
  /** unit direction of the segment */
  dir: Vec3
  /** midpoint of the unit segment */
  center: Vec3
  /** tube radius δ */
  radius: number
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
): Tube3[] {
  const rand = mulberry32(seed)
  const p = clamp(packing, 0, 1)
  const tubes: Tube3[] = []
  for (const dir of dirs) {
    const ax = Math.abs(dir.x)
    const ay = Math.abs(dir.y)
    const az = Math.abs(dir.z)
    const lo = { x: ax / 2, y: ay / 2, z: az / 2 }
    const hi = { x: 1 - ax / 2, y: 1 - ay / 2, z: 1 - az / 2 }
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
    })
  }
  return tubes
}

/** Endpoints of a tube's core segment. */
export function segmentOf(t: Tube3): { a: Vec3; b: Vec3 } {
  return {
    a: {
      x: t.center.x - t.dir.x / 2,
      y: t.center.y - t.dir.y / 2,
      z: t.center.z - t.dir.z / 2,
    },
    b: {
      x: t.center.x + t.dir.x / 2,
      y: t.center.y + t.dir.y / 2,
      z: t.center.z + t.dir.z / 2,
    },
  }
}
