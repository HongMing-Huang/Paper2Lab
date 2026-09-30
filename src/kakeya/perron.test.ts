import { describe, expect, it } from 'vitest'
import { PERRON_TRIANGLE_AREA, perronTree } from './perron'

describe('perronTree', () => {
  it('produces 2^k triangles with unit-length medians', () => {
    const r = perronTree(3, 0.8)
    expect(r.triangles.length).toBe(8)
    for (const m of r.medians) {
      expect(Math.hypot(m.a.x - m.b.x, m.a.y - m.b.y)).toBeCloseTo(1, 12)
    }
  })

  it('α = 1 (no translation) reproduces the original triangle area', () => {
    const r = perronTree(2, 1)
    expect(r.computedArea).toBeGreaterThan(0.99 * r.triangleArea)
    expect(r.computedArea).toBeLessThan(1.01 * r.triangleArea)
  })

  it('computed union area shrinks with k (deeper merging)', () => {
    const a1 = perronTree(1, 0.8).computedArea
    const a2 = perronTree(2, 0.8).computedArea
    const a4 = perronTree(4, 0.8).computedArea
    expect(a1).toBeLessThan(PERRON_TRIANGLE_AREA)
    expect(a2).toBeLessThan(a1)
    expect(a4).toBeLessThan(a2)
  })

  it('computed union area shrinks with stronger overlap (smaller α)', () => {
    const aLo = perronTree(3, 0.62).computedArea
    const aHi = perronTree(3, 0.95).computedArea
    expect(aLo).toBeLessThan(aHi)
    expect(aHi).toBeLessThan(PERRON_TRIANGLE_AREA)
  })

  it('the theoretical bound is displayed alongside the computed value', () => {
    const r = perronTree(4, 0.75)
    expect(r.boundArea).toBeLessThan(r.triangleArea)
    expect(r.boundArea).toBeGreaterThan(0)
  })
})
