// question → expansion packs placed on the desk
import type { Edge, Node } from '@xyflow/react'
import type { ExpansionPack } from '../paper/wangZahl'

function specToType(kind: ExpansionPack['nodes'][number]['kind'], refId: string): string {
  if (kind === 'experiment') return refId === 'perron-2d' ? 'perron' : 'experiment3d'
  if (kind === 'chart') return 'chartMultiplicity'
  return kind
}

export function packToNodes(
  pack: ExpansionPack,
  origin: { x: number; y: number },
  existingIds: Set<string>,
  existingEdgeIds: Set<string> = new Set(),
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  let prevId: string | null = null
  for (const spec of pack.nodes) {
    const id = `${pack.id}:${spec.refId}`
    if (existingIds.has(id)) {
      prevId = null // never chain edges through pre-existing nodes
      continue
    }
    nodes.push({
      id,
      type: specToType(spec.kind, spec.refId),
      position: { x: origin.x + spec.offset[0], y: origin.y + spec.offset[1] },
      data: { refId: spec.refId },
    })
    if (prevId) {
      const edgeId = `e-${prevId}-${id}`
      if (!existingEdgeIds.has(edgeId)) {
        existingEdgeIds.add(edgeId)
        edges.push({
          id: edgeId,
          source: prevId,
          target: id,
          type: 'straight',
          style: { stroke: 'rgba(154, 59, 46, 0.3)', strokeWidth: 1, strokeDasharray: '2 5' },
        })
      }
    }
    prevId = id
  }
  return { nodes, edges }
}

/** find a free origin below the current content: bottom-left of node bbox */
export function originBelow(nodes: Node[]): { x: number; y: number } {
  let minY = Infinity
  let minX = Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.position.x)
    minY = Math.min(minY, n.position.y)
  }
  let maxY = -Infinity
  for (const n of nodes) maxY = Math.max(maxY, n.position.y + 420)
  if (!Number.isFinite(minX)) return { x: 0, y: 0 }
  return { x: minX, y: maxY + 80 }
}
