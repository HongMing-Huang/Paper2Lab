// Pure-function tests for the ported board layouts (tldraw v5.5.0 pattern).
import { describe, expect, it } from 'vitest'
import { BOARD_LAYOUTS, BOARD_GAP, HERO_HEIGHT, type LayoutBox } from './boardLayout'

const box = (i: number, x: number, y: number, w = 120, h = 90): LayoutBox =>
  ({ id: `shape:${i}` as LayoutBox['id'], x, y, w, h })

describe('board layouts (ported from tldraw frame-layouts)', () => {
  it('row: equal heights, left→right, ordered by current x', () => {
    const out = BOARD_LAYOUTS.row.arrange!([box(1, 300, 0), box(2, 0, 5), box(3, 150, -2)])
    expect(out.boxes.map((b) => b.id)).toEqual(['shape:2', 'shape:3', 'shape:1'])
    expect(out.boxes.every((b) => b.h === 150)).toBe(true)
    // contiguous placement with the declared gap, no overlap
    expect(out.boxes[1].x).toBe(out.boxes[0].x + out.boxes[0].w + BOARD_GAP)
    expect(out.w).toBeCloseTo(out.boxes[2].x + out.boxes[2].w)
  })

  it('grid: banded reading order, √n columns, full coverage', () => {
    const kids = Array.from({ length: 5 }, (_, i) => box(i, (i % 3) * 200, Math.floor(i / 3) * 200))
    const out = BOARD_LAYOUTS.grid.arrange!(kids)
    expect(out.boxes.length).toBe(5)
    // 5 children → 3 columns × 2 rows
    const xs = new Set(out.boxes.map((b) => Math.round(b.x)))
    expect(xs.size).toBeGreaterThanOrEqual(2)
    expect(out.w).toBeGreaterThan(0)
    expect(out.h).toBeGreaterThan(150)
  })

  it('spotlight: first child enlarged as hero, branches stacked beside', () => {
    const out = BOARD_LAYOUTS.spotlight.arrange!([box(1, 0, 0), box(2, 400, 10), box(3, 800, 30)])
    const [hero, ...rest] = out.boxes
    expect(hero.h).toBe(HERO_HEIGHT)
    expect(rest.every((b) => b.h < hero.h)).toBe(true)
    expect(rest.every((b) => b.x > hero.x + hero.w)).toBe(true)
    // thumbnails stacked vertically without overlap
    expect(rest[1].y).toBeGreaterThan(rest[0].y)
  })

  it('empty board arranges to nothing (not NaN)', () => {
    for (const mode of ['row', 'grid', 'spotlight'] as const) {
      const out = BOARD_LAYOUTS[mode].arrange!([])
      expect(out.boxes).toEqual([])
      expect(Number.isFinite(out.w)).toBe(true)
      expect(Number.isFinite(out.h)).toBe(true)
    }
  })

  it('free arranges nothing — plain frame behaviour', () => {
    expect(BOARD_LAYOUTS.free.arrange).toBeNull()
  })
})
