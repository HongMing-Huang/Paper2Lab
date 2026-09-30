import { describe, expect, it } from 'vitest'
import { fibonacciDirections, minAngularSeparation } from './directions'

describe('fibonacciDirections', () => {
  it('produces unit vectors', () => {
    for (const p of fibonacciDirections(97)) {
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1, 10)
    }
  })

  it('is deterministic', () => {
    expect(fibonacciDirections(32)).toEqual(fibonacciDirections(32))
  })

  it('gives well-separated directions that refine as n grows', () => {
    const sep64 = minAngularSeparation(fibonacciDirections(64))
    const sep256 = minAngularSeparation(fibonacciDirections(256))
    expect(sep64).toBeGreaterThan(0.15) // ≳ δ-separation quality for δ ≈ 1/6
    expect(sep256).toBeLessThan(sep64)
    expect(sep256).toBeGreaterThan(0.07)
  })
})
