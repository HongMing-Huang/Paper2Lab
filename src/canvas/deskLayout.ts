// Initial desk layout — the Wang–Zahl paper "spread out" on the desk:
// paper strip (left), knowledge clippings (middle), living lab (right),
// 2D Perron bench (bottom-left). Edges are annotation-style (dashed ink),
// never flowchart arrows.
import type { Edge, Node } from '@xyflow/react'

const inkEdge = {
  type: 'straight',
  style: { stroke: 'rgba(107, 97, 84, 0.35)', strokeWidth: 1, strokeDasharray: '2 5' },
} as const

export const initialNodes: Node[] = [
  { id: 'paper-main', type: 'paperPage', position: { x: 0, y: 0 }, data: {}, draggable: true },

  { id: 'thm-1.1', type: 'theorem', position: { x: 520, y: -30 }, data: { refId: 'thm-1.1' } },
  { id: 'thm-1.2', type: 'theorem', position: { x: 520, y: 330 }, data: { refId: 'thm-1.2' } },
  { id: 'def-kakeya', type: 'theorem', position: { x: 520, y: 760 }, data: { refId: 'def-kakeya-set' } },
  { id: 'f-union', type: 'formula', position: { x: 900, y: 20 }, data: { refId: 'f-union-bound' } },
  { id: 'f-capsule', type: 'formula', position: { x: 900, y: 300 }, data: { refId: 'f-capsule' } },
  { id: 'f-dim', type: 'formula', position: { x: 900, y: 560 }, data: { refId: 'f-dim-3' } },
  { id: 'sandbox', type: 'formulaSandbox', position: { x: 900, y: 800 }, data: {} },

  { id: 'params', type: 'params', position: { x: 1290, y: 800 }, data: {} },
  { id: 'exp-3d', type: 'experiment3d', position: { x: 1290, y: -40 }, data: {} },
  { id: 'chart-multiplicity', type: 'chartMultiplicity', position: { x: 1290, y: 480 }, data: {} },
  { id: 'chart-union', type: 'chartUnion', position: { x: 1760, y: -40 }, data: {} },
  { id: 'observation', type: 'observation', position: { x: 1760, y: 480 }, data: {} },
  { id: 'runtime-graph', type: 'runtimeGraph', position: { x: 1290, y: 1180 }, data: {} },

  { id: 'c-history', type: 'concept', position: { x: 0, y: 700 }, data: { refId: 'c-history' } },
  { id: 'perron-exp', type: 'perron', position: { x: 0, y: 1040 }, data: {} },
  { id: 'c-perron', type: 'concept', position: { x: 440, y: 1060 }, data: { refId: 'c-perron' } },
  { id: 'f-perron', type: 'formula', position: { x: 820, y: 1160 }, data: { refId: 'f-perron-bound' } },
  { id: 'whatif-sticky', type: 'whatif', position: { x: 440, y: 1400 }, data: { refId: 'w-go-sticky' } },
  { id: 'whatif-delta', type: 'whatif', position: { x: 800, y: 1400 }, data: { refId: 'w-halve-delta' } },
  { id: 'source', type: 'source', position: { x: 0, y: 1720 }, data: {} },
]

export const initialEdges: Edge[] = [
  { id: 'e1', source: 'paper-main', target: 'thm-1.1', ...inkEdge },
  { id: 'e2', source: 'paper-main', target: 'thm-1.2', ...inkEdge },
  { id: 'e3', source: 'thm-1.2', target: 'f-union', ...inkEdge },
  { id: 'e4', source: 'thm-1.1', target: 'f-dim', ...inkEdge },
  { id: 'e5', source: 'c-perron', target: 'f-perron', ...inkEdge },
  { id: 'e6', source: 'exp-3d', target: 'chart-multiplicity', ...inkEdge },
]
