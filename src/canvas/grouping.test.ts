import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import { buildGroup, dissolveGroup } from './grouping'

const node = (id: string, x: number, y: number, w = 300, h = 200): Node => ({
  id,
  type: 'theorem',
  position: { x, y },
  data: {},
  measured: { width: w, height: h },
})

describe('grouping transforms', () => {
  it('reparents children with parent-relative coordinates and sizes the group', () => {
    const a = node('a', 100, 200)
    const b = node('b', 400, 600, 360, 400)
    const { nodes } = buildGroup([a, b], ['a', 'b'], 'g1')
    const g = nodes.find((n) => n.id === 'g1')!
    expect(g.type).toBe('group')
    expect(g.position).toEqual({ x: 100 - 26, y: 200 - 26 })
    expect(g.style?.width).toBe(360 + 400 - 100 + 52)
    expect(g.style?.height).toBe(600 + 400 - 200 + 52)
    const na = nodes.find((n) => n.id === 'a')!
    const nb = nodes.find((n) => n.id === 'b')!
    expect(na.parentId).toBe('g1')
    expect(na.extent).toBe('parent')
    expect(na.position).toEqual({ x: 26, y: 26 })
    expect(nb.position).toEqual({ x: 400 - (100 - 26), y: 600 - (200 - 26) })
  })

  it('round-trips: dissolve restores absolute positions', () => {
    const a = node('a', 100, 200)
    const b = node('b', 400, 600)
    const grouped = buildGroup([a, b], ['a', 'b'], 'g1').nodes
    const restored = dissolveGroup(grouped, 'g1')
    expect(restored.find((n) => n.id === 'g1')).toBeUndefined()
    expect(restored.find((n) => n.id === 'a')!.position).toEqual({ x: 100, y: 200 })
    expect(restored.find((n) => n.id === 'b')!.position).toEqual({ x: 400, y: 600 })
    expect(restored.find((n) => n.id === 'a')!.parentId).toBeUndefined()
  })

  it('never groups group nodes themselves', () => {
    const a = node('a', 0, 0)
    const g: Node = { id: 'g0', type: 'group', position: { x: 0, y: 0 }, data: {} }
    const { nodes } = buildGroup([a, g], ['a', 'g0'], 'g1')
    expect(nodes.find((n) => n.id === 'g0')!.parentId).toBeUndefined()
  })

  it('throws when nothing to group', () => {
    expect(() => buildGroup([node('a', 0, 0)], [], 'g')).toThrow(/no nodes/)
  })
})
