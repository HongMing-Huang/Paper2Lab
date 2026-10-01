// v3 layout: the desk STARTS as the paper itself (Question + Theorem + Live
// Experiment). Lab nodes and research material grow on demand (AGENTS.md §0).
import type { Edge, Node } from '@xyflow/react'

const inkEdge = {
  type: 'straight',
  style: { stroke: 'rgba(107, 97, 84, 0.35)', strokeWidth: 1, strokeDasharray: '2 5' },
} as const

/** the initial desk = the paper */
export const initialNodes: Node[] = [
  { id: 'paper-mode', type: 'paperMode', position: { x: -160, y: -80 }, data: {} },
]

export const initialEdges: Edge[] = []

/** lab cluster spawned by "展开实验" — parameters live INSIDE the experiment sheet */
export function buildLabNodes(origin: { x: number; y: number }): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    { id: 'exp-3d', type: 'experiment3d', position: { x: origin.x, y: origin.y }, data: {} },
    { id: 'chart-multiplicity', type: 'chartMultiplicity', position: { x: origin.x + 460, y: origin.y - 20 }, data: {} },
    { id: 'chart-union', type: 'chartUnion', position: { x: origin.x + 460, y: origin.y + 320 }, data: {} },
    { id: 'observation', type: 'observation', position: { x: origin.x + 880, y: origin.y - 20 }, data: {} },
    { id: 'perron-exp', type: 'perron', position: { x: origin.x + 880, y: origin.y + 380 }, data: {} },
  ]
  const edges: Edge[] = [
    { id: 'lab-e1', source: 'exp-3d', target: 'chart-multiplicity', ...inkEdge },
    { id: 'lab-e2', source: 'exp-3d', target: 'chart-union', ...inkEdge },
    { id: 'lab-e3', source: 'chart-multiplicity', target: 'observation', ...inkEdge },
  ]
  return { nodes, edges }
}

/** research material (progressive disclosure — never the initial view) */
export function buildLibraryNodes(origin: { x: number; y: number }): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    { id: 'paper-main', type: 'paperPage', position: { x: origin.x, y: origin.y }, data: {} },
    { id: 'thm-1.1', type: 'theorem', position: { x: origin.x + 540, y: origin.y }, data: { refId: 'thm-1.1' } },
    { id: 'thm-1.2', type: 'theorem', position: { x: origin.x + 540, y: origin.y + 330 }, data: { refId: 'thm-1.2' } },
    { id: 'def-kakeya', type: 'theorem', position: { x: origin.x + 540, y: origin.y + 760 }, data: { refId: 'def-kakeya-set' } },
    { id: 'f-union', type: 'formula', position: { x: origin.x + 940, y: origin.y + 20 }, data: { refId: 'f-union-bound' } },
    { id: 'f-capsule', type: 'formula', position: { x: origin.x + 940, y: origin.y + 300 }, data: { refId: 'f-capsule' } },
    { id: 'f-dim', type: 'formula', position: { x: origin.x + 940, y: origin.y + 560 }, data: { refId: 'f-dim-3' } },
    { id: 'sandbox', type: 'formulaSandbox', position: { x: origin.x + 940, y: origin.y + 800 }, data: {} },
    { id: 'c-history', type: 'concept', position: { x: origin.x, y: origin.y + 700 }, data: { refId: 'c-history' } },
    { id: 'c-perron', type: 'concept', position: { x: origin.x, y: origin.y + 1000 }, data: { refId: 'c-perron' } },
    { id: 'f-perron', type: 'formula', position: { x: origin.x + 420, y: origin.y + 1060 }, data: { refId: 'f-perron-bound' } },
    { id: 'whatif-sticky', type: 'whatif', position: { x: origin.x + 420, y: origin.y + 1400 }, data: { refId: 'w-go-sticky' } },
    { id: 'whatif-delta', type: 'whatif', position: { x: origin.x + 800, y: origin.y + 1400 }, data: { refId: 'w-halve-delta' } },
    { id: 'source', type: 'source', position: { x: origin.x, y: origin.y + 1300 }, data: {} },
    { id: 'runtime-graph', type: 'runtimeGraph', position: { x: origin.x + 1340, y: origin.y + 20 }, data: {} },
  ]
  const edges: Edge[] = [
    { id: 'lib-e1', source: 'paper-main', target: 'thm-1.1', ...inkEdge },
    { id: 'lib-e2', source: 'paper-main', target: 'thm-1.2', ...inkEdge },
    { id: 'lib-e3', source: 'thm-1.2', target: 'f-union', ...inkEdge },
    { id: 'lib-e4', source: 'thm-1.1', target: 'f-dim', ...inkEdge },
    { id: 'lib-e5', source: 'c-perron', target: 'f-perron', ...inkEdge },
  ]
  return { nodes, edges }
}
