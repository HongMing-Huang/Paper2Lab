// Perron tree — the classical 2D Kakeya/Besicovitch construction (Besicovitch
// 1919, simplified by Perron). Reference for the merge move used here: the
// "sliding triangles" lemma (area ≤ (α² + 2(1-α)²)·area(T) per elementary
// move; total ≤ (α^{2k} + 2(1-α))·area(T)), as presented in Yuval Wigderson's
// Kakeya notes and Alan Chang's MathCamp notes on the needle problem.
//
// Construction: equilateral triangle of height 1 (area 1/√3, Pál's optimal
// convex set), base cut into 2^k equal sub-triangles sharing the apex. In
// stage r = 1..k, adjacent groups of 2^(r-1) sub-triangles are merged: the
// right group is translated left (parallel to the base) so that the two
// groups' bases overlap in ratio α. Translations accumulate; directions of
// the covered unit segments are preserved (translations preserve direction).
// Area is MEASURED by rasterisation — the reported number is computed, not
// taken from the bound.
export interface Pt {
  x: number
  y: number
}

export interface PerronTri {
  apex: Pt
  base0: Pt // left base corner (y = 0)
  base1: Pt // right base corner (y = 0)
}

export interface PerronResult {
  k: number
  alpha: number
  /** translated sub-triangles */
  triangles: PerronTri[]
  /** unit needle segments: apex → base midpoint of each translated triangle */
  medians: { a: Pt; b: Pt }[]
  /** area of the original equilateral triangle = 1/√3 */
  triangleArea: number
  /** rasterised area of the union of translated triangles */
  computedArea: number
  /** theoretical upper bound (α^{2k} + 2(1-α))·A from the cited notes */
  boundArea: number
  /** rasterisation resolution along the bounding-box width */
  raster: number
}

export const PERRON_TRIANGLE_AREA = 1 / Math.sqrt(3)

export function perronTree(k: number, alpha: number, raster = 900): PerronResult {
  if (k < 0 || k > 6) throw new Error('k must be in [0,6] (2^k ≤ 64 triangles)')
  if (alpha <= 0.5 || alpha > 1) throw new Error('alpha must be in (0.5, 1]')

  const W = 2 / Math.sqrt(3) // equilateral base for height 1
  const apex: Pt = { x: W / 2, y: 1 }
  const n = 2 ** k
  const bSub = W / n

  // cumulative x-offset per sub-triangle (all points of a triangle share it)
  const offsets = new Float64Array(n)
  for (let r = 1; r <= k; r++) {
    const g = 2 ** (r - 1) // sub-triangles per group
    // heart width after r-1 stages: 2^{r-1}·bSub·α^{r-1}; lemma translation = 2·heartWidth·(1-α)
    const heartWidth = g * bSub * alpha ** (r - 1)
    const t = 2 * heartWidth * (1 - alpha)
    for (let m = 0; m < n / (2 * g); m++) {
      // right group of pair m: indices [m·2g + g, (m+1)·2g)
      for (let i = m * 2 * g + g; i < (m + 1) * 2 * g; i++) offsets[i] -= t
    }
  }

  const triangles: PerronTri[] = []
  const medians: { a: Pt; b: Pt }[] = []
  for (let i = 0; i < n; i++) {
    const x0 = (i * bSub) + offsets[i]
    const x1 = ((i + 1) * bSub) + offsets[i]
    const a = { x: apex.x + offsets[i], y: 1 }
    triangles.push({ apex: a, base0: { x: x0, y: 0 }, base1: { x: x1, y: 0 } })
    // unit needle: from the apex, step length 1 toward the base midpoint.
    // The full apex→base-mid segment has length √(1+Δx²) ≥ 1, so its unit
    // prefix lies inside the triangle by convexity — an honest unit needle.
    const bx = (x0 + x1) / 2
    const len = Math.hypot(bx - a.x, 1)
    medians.push({ a, b: { x: a.x + (bx - a.x) / len, y: a.y - 1 / len } })
  }

  // rasterise the union; square cells sized by bbox width / raster
  let minX = Infinity
  let maxX = -Infinity
  for (const t of triangles) {
    minX = Math.min(minX, t.base0.x, t.apex.x)
    maxX = Math.max(maxX, t.base1.x, t.apex.x)
  }
  const cell = (maxX - minX) / raster
  const rows = Math.max(1, Math.ceil(1 / cell) + 1)
  const grid = new Uint8Array(raster * rows)
  for (const t of triangles) {
    const ax = t.apex.x
    for (let j = 0; j < rows; j++) {
      const y = (j + 0.5) * cell
      if (y >= 1) break
      const f = 1 - y // 0 at apex, 1 at base
      const left = ax + (t.base0.x - ax) * f
      const right = ax + (t.base1.x - ax) * f
      const i0 = Math.max(0, Math.floor((left - minX) / cell))
      const i1 = Math.min(raster - 1, Math.ceil((right - minX) / cell) - 1)
      for (let i = i0; i <= i1; i++) {
        const cx = minX + (i + 0.5) * cell
        if (cx >= left && cx <= right) grid[j * raster + i] = 1
      }
    }
  }
  let count = 0
  for (let idx = 0; idx < grid.length; idx++) count += grid[idx]
  const computedArea = count * cell * cell

  return {
    k,
    alpha,
    triangles,
    medians,
    triangleArea: PERRON_TRIANGLE_AREA,
    computedArea,
    boundArea: (alpha ** (2 * k) + 2 * (1 - alpha)) * PERRON_TRIANGLE_AREA,
    raster,
  }
}
