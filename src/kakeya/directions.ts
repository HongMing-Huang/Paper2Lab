// Fibonacci-hemisphere direction sampling for δ-tubes.
// Tube directions are unoriented lines (d and -d are the same direction), so
// the correct domain is the projective hemisphere — sampling the full sphere
// would create near-antipodal pairs that fold to the same direction.
// Deterministic (no RNG): the golden-angle spiral gives an even, reproducible
// distribution of N unit vectors on the upper hemisphere.
export interface Vec3 {
  x: number
  y: number
  z: number
}

export function fibonacciDirections(n: number): Vec3[] {
  const pts: Vec3[] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const y = 1 - (i + 0.5) / n // y ∈ (0,1), upper hemisphere only
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * i
    pts.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r })
  }
  return pts
}

/** Smallest angular distance (radians) between any pair, as unoriented lines. */
export function minAngularSeparation(dirs: Vec3[]): number {
  let best = Infinity
  for (let i = 0; i < dirs.length; i++) {
    for (let j = i + 1; j < dirs.length; j++) {
      const d = dirs[i]
      const e = dirs[j]
      const dot = Math.max(-1, Math.min(1, d.x * e.x + d.y * e.y + d.z * e.z))
      const ang = Math.acos(dot)
      const unoriented = Math.min(ang, Math.PI - ang)
      if (unoriented < best) best = unoriented
    }
  }
  return best
}
