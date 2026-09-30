// Finite-scale voxel (cube) coverage computation — the demo's real numbers.
// Deterministic, dependency-free: runs identically in a Web Worker, in Node
// (offline precompute script) and in vitest.
import type { Tube3 } from './tubes'

export interface VoxelMetrics {
  /** grid resolution (grid is res³ over the unit cube) */
  res: number
  /** |⋃T ∩ [0,1]³| estimated by voxel counting (fraction of unit cube) */
  occupiedVolume: number
  /** Σ|T ∩ [0,1]³| (computed, not analytic) — equals Σ multiplicities × h³ */
  sumTubeVolume: number
  /** max #tubes covering one voxel */
  maxMultiplicity: number
  /** mean multiplicity over occupied voxels */
  avgMultiplicity: number
  /** histogram[m] = #voxels covered exactly m times, m = 0..max */
  histogram: number[]
  /** analytic per-tube reference πδ²·1 + caps (capsule), for sanity display */
  analyticPerTube: number
}

export interface VoxelResult extends VoxelMetrics {
  /** optional low-res multiplicity grid for 3D occupancy visualisation */
  visGrid?: { res: number; data: Uint16Array }
}

/**
 * Count, for every voxel of a res³ grid on [0,1]³, how many tubes cover its
 * centre (distance from voxel centre to the tube's core segment ≤ δ).
 * Tube voxel volume ≈ πδ²·(1/res)⁻³ grows like (res·δ)², so cost stays low.
 */
export function computeVoxelCoverage(
  tubes: Tube3[],
  res: number,
  visRes = 0,
): VoxelResult {
  const coverage = new Uint16Array(res * res * res)
  const h = 1 / res
  let sumTubeVoxels = 0

  for (const t of tubes) {
    const d = t.dir
    const r = t.radius
    const c = t.center
    // segment endpoints c ± d/2; bounding box expanded by radius
    const minx = Math.max(0, Math.floor((c.x - (Math.abs(d.x) / 2 + r)) * res))
    const maxx = Math.min(res - 1, Math.ceil((c.x + (Math.abs(d.x) / 2 + r)) * res))
    const miny = Math.max(0, Math.floor((c.y - (Math.abs(d.y) / 2 + r)) * res))
    const maxy = Math.min(res - 1, Math.ceil((c.y + (Math.abs(d.y) / 2 + r)) * res))
    const minz = Math.max(0, Math.floor((c.z - (Math.abs(d.z) / 2 + r)) * res))
    const maxz = Math.min(res - 1, Math.ceil((c.z + (Math.abs(d.z) / 2 + r)) * res))
    let tubeVoxels = 0
    for (let i = minx; i <= maxx; i++) {
      const px = (i + 0.5) * h - c.x
      for (let j = miny; j <= maxy; j++) {
        const py = (j + 0.5) * h - c.y
        // quick axis-aligned rejection on the xy disc projection
        for (let k = minz; k <= maxz; k++) {
          const pz = (k + 0.5) * h - c.z
          // t-param along unit direction, clamped to segment of half-length 1/2
          let s = px * d.x + py * d.y + pz * d.z
          if (s < -0.5) s = -0.5
          else if (s > 0.5) s = 0.5
          const qx = px - s * d.x
          const qy = py - s * d.y
          const qz = pz - s * d.z
          if (qx * qx + qy * qy + qz * qz <= r * r) {
            coverage[(i * res + j) * res + k]++
            tubeVoxels++
          }
        }
      }
    }
    sumTubeVoxels += tubeVoxels
  }

  let occupied = 0
  let maxM = 0
  for (let idx = 0; idx < coverage.length; idx++) {
    const m = coverage[idx]
    if (m > 0) {
      occupied++
      if (m > maxM) maxM = m
    }
  }
  const histogram = new Array<number>(maxM + 1).fill(0)
  for (let idx = 0; idx < coverage.length; idx++) histogram[coverage[idx]]++

  const delta = tubes[0]?.radius ?? 0
  const result: VoxelResult = {
    res,
    occupiedVolume: occupied / (res * res * res),
    sumTubeVolume: (sumTubeVoxels / (res * res * res)) * 1,
    maxMultiplicity: maxM,
    avgMultiplicity: occupied > 0 ? sumTubeVoxels / occupied : 0,
    histogram,
    analyticPerTube: Math.PI * delta * delta * 1 + (4 / 3) * Math.PI * (delta ** 3) / 2,
  }

  if (visRes > 0 && visRes <= res && res % visRes === 0) {
    const factor = res / visRes
    const vis = new Uint16Array(visRes * visRes * visRes)
    for (let i = 0; i < res; i++) {
      for (let j = 0; j < res; j++) {
        const base = (i * res + j) * res
        const vbase = (Math.floor(i / factor) * visRes + Math.floor(j / factor)) * visRes
        for (let k = 0; k < res; k++) {
          const m = coverage[base + k]
          const vk = vbase + Math.floor(k / factor)
          if (m > vis[vk]) vis[vk] = m
        }
      }
    }
    result.visGrid = { res: visRes, data: vis }
  }
  return result
}
