// The infinite research desk: warm paper + faint dots, freely zoomable and
// pannable; asking a question expands research objects onto the desk instead
// of opening a chat.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react'
import { RuntimeProvider, useCell } from '../runtime/react'
import { kakeya } from '../paper/kakeyaGraph'
import { deskNodeTypes } from './nodes'
import { initialEdges, initialNodes } from './deskLayout'
import { originBelow, packToNodes } from './expansions'
import { EXPANSION_PACKS, findPack } from '../paper/wangZahl'

kakeya.param('desk.showVoxels', 0)

function FocusListener() {
  const focus = useCell<{ nodeId: string; nonce: number } | null>('desk.focusNode')
  const { fitView } = useReactFlow()
  const lastNonce = useRef(0)
  useEffect(() => {
    const f = focus.value
    if (f && f.nonce !== lastNonce.current) {
      lastNonce.current = f.nonce
      void fitView({ nodes: [{ id: f.nodeId }], duration: 650, maxZoom: 1.1, padding: 0.25 })
    }
  }, [focus.value?.nonce, focus.value, fitView])
  return null
}

function QuestionBar({ onExpand }: { onExpand: (packId: string) => void }) {
  const [q, setQ] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const submit = () => {
    const pack = findPack(q)
    if (pack) {
      onExpand(pack.id)
      setNote(`已在纸面展开：${pack.title}`)
    } else {
      setNote('还没有这个主题的展开包；试试下面的示例问题。')
    }
    setTimeout(() => setNote(null), 3200)
  }
  return (
    <Panel position="top-center" className="question-panel">
      <div className="question-bar nodrag nowheel">
        <span className="question-icon">✎</span>
        <input
          name="paper2lab-question"
          value={q}
          placeholder="问一个关于论文的问题，AI 在纸面上展开研究对象…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <button type="button" onClick={submit}>
          展开
        </button>
      </div>
      <div className="question-chips">
        {EXPANSION_PACKS.map((p) => (
          <button key={p.id} type="button" className="chip" onClick={() => onExpand(p.id)}>
            {p.title}
          </button>
        ))}
      </div>
      {note && <div className="question-note">{note}</div>}
    </Panel>
  )
}

export function DeskCanvas() {
  const [nodes, setNodes] = useState<Node[]>(initialNodes)
  const [edges, setEdges] = useState<Edge[]>(initialEdges)

  const onExpand = useCallback((packId: string) => {
    const pack = EXPANSION_PACKS.find((p) => p.id === packId)
    if (!pack) return
    setNodes((cur) => {
      const { nodes: added, edges: addedEdges } = packToNodes(
        pack,
        originBelow(cur),
        new Set(cur.map((n) => n.id)),
      )
      if (addedEdges.length) {
        setEdges((es) => {
          const ids = new Set(es.map((e) => e.id))
          const fresh = addedEdges.filter((e) => !ids.has(e.id))
          return fresh.length ? [...es, ...fresh] : es
        })
      }
      return added.length ? [...cur, ...added] : cur
    })
  }, [])

  return (
    <RuntimeProvider runtime={kakeya}>
      <div className="desk-root">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={deskNodeTypes}
          onNodesChange={(chg) => setNodes((ns) => applyNodeChanges(chg, ns))}
          onEdgesChange={(chg) => setEdges((es) => applyEdgeChanges(chg, es))}
          minZoom={0.12}
          maxZoom={4}
          fitView
          fitViewOptions={{ padding: 0.1, maxZoom: 0.85 }}
          nodesConnectable={false}
          deleteKeyCode={null}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={26}
            size={1.5}
            color="#d8cfc0"
            bgColor="#faf6ee"
          />
          <MiniMap
            pannable
            zoomable
            bgColor="#f2ecdf"
            maskColor="rgba(250, 246, 238, 0.72)"
            nodeColor="#b0a89a"
            nodeStrokeColor="#8d8375"
            style={{ border: '1px solid #d9d0bf', borderRadius: 2 }}
          />
          <Controls showInteractive={false} position="bottom-right" />
          <FocusListener />
          <QuestionBar onExpand={onExpand} />
        </ReactFlow>
      </div>
    </RuntimeProvider>
  )
}
