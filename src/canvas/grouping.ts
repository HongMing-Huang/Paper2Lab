// Pure grouping transforms (unit-tested): reparent nodes into a group node
// with parent-relative coordinates, and release them back with absolute
// coordinates. React Flow v12 semantics: child.position is parent-relative.
import type { Node } from '@xyflow/react'

export interface GroupResult {
  nodes: Node[]
  groupId: string
}

/** create a group node containing `ids`; children become parentId-relative */
export function buildGroup(nodes: Node[], ids: string[], groupId: string, pad = 26): GroupResult {
  const idSet = new Set(ids)
  const selected = nodes.filter((n) => idSet.has(n.id) && n.type !== 'group')
  if (selected.length === 0) throw new Error('no nodes to group')
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of selected) {
    const w = n.measured?.width ?? (typeof n.style?.width === 'number' ? n.style.width : 320)
    const h = n.measured?.height ?? (typeof n.style?.height === 'number' ? n.style.height : 240)
    minX = Math.min(minX, n.position.x)
    minY = Math.min(minY, n.position.y)
    maxX = Math.max(maxX, n.position.x + w)
    maxY = Math.max(maxY, n.position.y + h)
  }
  const origin = { x: minX - pad, y: minY - pad }
  const group: Node = {
    id: groupId,
    type: 'group',
    position: origin,
    data: { label: '分组' },
    style: { width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 },
    selectable: true,
    draggable: true,
  }
  const next = nodes.map((n) =>
    idSet.has(n.id) && n.type !== 'group'
      ? {
          ...n,
          parentId: groupId,
          extent: 'parent' as const,
          position: { x: n.position.x - origin.x, y: n.position.y - origin.y },
        }
      : n,
  )
  return { nodes: [...next, group], groupId }
}

/** dissolve the given group; children return to absolute coordinates */
export function dissolveGroup(nodes: Node[], groupId: string): Node[] {
  const group = nodes.find((n) => n.id === groupId)
  if (!group) return nodes
  return nodes
    .map((n) => {
      if (n.parentId === groupId) {
        return {
          ...n,
          parentId: undefined,
          extent: undefined,
          position: { x: group.position.x + n.position.x, y: group.position.y + n.position.y },
        }
      }
      return n
    })
    .filter((n) => n.id !== groupId)
}
