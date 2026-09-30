import { describe, expect, it } from 'vitest'
import { fibonacciDirections } from './directions'
import { makeTubes, segmentOf } from './tubes'

describe('makeTubes', () => {
  const dirs = fibonacciDirections(24)

  it('packing=1 puts every segment through the cube centre (sticky)', () => {
    const tubes = makeTubes(dirs, 0.05, 1)
    for (const t of tubes) {
      expect(t.center.x).toBeCloseTo(0.5, 12)
      expect(t.center.y).toBeCloseTo(0.5, 12)
      expect(t.center.z).toBeCloseTo(0.5, 12)
    }
  })

  it('keeps whole unit segments inside [0,1]³ for any packing', () => {
    for (const packing of [0, 0.37, 1]) {
      for (const t of makeTubes(dirs, 0.05, packing)) {
        const { a, b } = segmentOf(t)
        for (const p of [a, b]) {
          expect(p.x).toBeGreaterThanOrEqual(-1e-9)
          expect(p.x).toBeLessThanOrEqual(1 + 1e-9)
          expect(p.y).toBeGreaterThanOrEqual(-1e-9)
          expect(p.y).toBeLessThanOrEqual(1 + 1e-9)
          expect(p.z).toBeGreaterThanOrEqual(-1e-9)
          expect(p.z).toBeLessThanOrEqual(1 + 1e-9)
        }
      }
    }
  })

  it('is deterministic per seed and spread for packing=0', () => {
    const t1 = makeTubes(dirs, 0.05, 0, 42)
    const t2 = makeTubes(dirs, 0.05, 0, 42)
    expect(t1).toEqual(t2)
    const centers = new Set(t1.map((t) => `${t.center.x.toFixed(9)},${t.center.y.toFixed(9)},${t.center.z.toFixed(9)}`))
    expect(centers.size).toBe(dirs.length)
  })

  it('carries the requested radius', () => {
    expect(makeTubes(dirs, 0.125, 0)[0].radius).toBe(0.125)
  })
})
