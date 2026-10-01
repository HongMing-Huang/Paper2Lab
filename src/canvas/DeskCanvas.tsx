// The infinite research desk: warm paper + faint dots, freely zoomable and
// pannable; asking a question expands research objects onto the desk instead
// of opening a chat (interaction contract: experiment > computation >
// visualization > explanation). P0: selection (shift box), grouping,
// experiment forks, spatial comparison, evidence trace.
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
import { deskBus, forkStore, requestAddNode, snapshotCurrentFork, type ForkSnapshot } from '../paper/forks'
import { runSkill } from '../skills/types'
import { buildGroup, dissolveGroup } from './grouping'
import '../skills'

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

/** group/ungroup toolbar — P0 canvas capability */
function DeskToolbar({
  message,
  selectMode,
  onToggleSelectMode,
}: {
  message: (m: string) => void
  selectMode: boolean
  onToggleSelectMode: () => void
}) {
  const { getNodes, setNodes } = useReactFlow()

  const groupSelected = useCallback(() => {
    const selected = getNodes().filter((n) => n.selected && n.type !== 'group')
    if (selected.length < 2) {
      message('请先按住 Shift 框选/多选至少两个节点（或开启框选模式）')
      return
    }
    const groupId = `group-${Date.now().toString(36)}`
    setNodes((ns) => buildGroup(ns, selected.map((n) => n.id), groupId).nodes)
    message(`已创建分组（${selected.length} 个节点）`)
  }, [getNodes, setNodes, message])

  const ungroupSelected = useCallback(() => {
    const groups = getNodes().filter((n) => n.type === 'group' && n.selected)
    if (groups.length === 0) {
      message('请先选中一个分组（点分组边框）')
      return
    }
    setNodes((ns) => {
      let out = ns
      for (const g of groups) out = dissolveGroup(out, g.id)
      return out
    })
    message('已拆散分组')
  }, [getNodes, setNodes, message])

  return (
    <Panel position="bottom-left" className="desk-toolbar">
      <button type="button" className={selectMode ? 'on-mode' : ''} onClick={onToggleSelectMode}>
        ▭ 框选模式{selectMode ? '（开）' : ''}
      </button>
      <button type="button" onClick={groupSelected}>📎 成组所选</button>
      <button type="button" onClick={ungroupSelected}>✂️ 拆组</button>
    </Panel>
  )
}

function QuestionBar({
  onExpand,
  onCompareSticky,
  message,
}: {
  onExpand: (packId: string) => void
  onCompareSticky: () => void
  message: (m: string) => void
}) {
  const [q, setQ] = useState('')
  const submit = () => {
    const pack = findPack(q)
    if (pack) {
      onExpand(pack.id)
      message(`已在纸面展开：${pack.title}`)
    } else if (q.trim()) {
      onCompareSticky()
      message('暂无该主题的展开包；已为你运行 separated vs sticky 对比实验')
    } else {
      onCompareSticky()
    }
    setTimeout(() => message(''), 3200)
  }
  return (
    <Panel position="top-center" className="question-panel">
      <div className="question-bar nodrag nowheel">
        <span className="question-icon">✎</span>
        <input
          name="paper2lab-question"
          value={q}
          placeholder="问一个可运行的科研问题 — 优先做实验，而不是给文本…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <button type="button" onClick={submit}>
          运行/展开
        </button>
      </div>
      <div className="question-chips">
        {EXPANSION_PACKS.map((p) => (
          <button key={p.id} type="button" className="chip" onClick={() => onExpand(p.id)}>
            {p.title}
          </button>
        ))}
        <button type="button" className="chip chip-run" onClick={onCompareSticky}>
          ⚖️ 对比 separated vs sticky（自动 fork）
        </button>
      </div>
    </Panel>
  )
}

function addForkNode(fork: ForkSnapshot, x: number, y: number) {
  requestAddNode({ id: `forkcard-${fork.id}`, type: 'fork', position: { x, y }, data: { forkId: fork.id } })
}

export function DeskCanvas() {
  const [nodes, setNodes] = useState<Node[]>(initialNodes)
  const [edges, setEdges] = useState<Edge[]>(initialEdges)
  const [note, setNote] = useState<string | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const message = useCallback((m: string) => setNote(m), [])

  // nodes request canvas actions through the desk bus (no prop drilling)
  useEffect(() => {
    const unsubscribe = deskBus.subscribe((a) => {
      if (a.type === 'add-node' && a.node) {
        const node = a.node
        setNodes((cur) => {
          const exists = cur.some((n) => n.id === node.id)
          if (exists) {
            kakeya.setParam('desk.focusNode', { nodeId: node.id, nonce: Date.now() })
            return cur
          }
          // avoid dropping a new node on top of existing cards
          const origin = originBelow(cur)
          return [...cur, { ...node, position: node.position.x === 0 && node.position.y === 0 ? origin : node.position }]
        })
      } else if (a.type === 'focus-node' && a.nodeId) {
        kakeya.setParam('desk.focusNode', { nodeId: a.nodeId, nonce: Date.now() })
      }
    })
    return unsubscribe
  }, [])

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

  /** experiment > explanation: auto-fork A, compute B via skill, compare card */
  const onCompareSticky = useCallback(async () => {
    const forkA = snapshotCurrentFork('A · 当前参数')
    forkStore.add(forkA)
    const deltaExp = (kakeya.get('kakeya.deltaExp').value as number) ?? 4
    const nTubes = (kakeya.get('kakeya.nTubes').value as number) ?? 96
    const res = (kakeya.get('kakeya.voxelRes').value as number) ?? 48
    const delta = 2 ** -deltaExp
    const sim = await runSkill<{
      tubeCount: number
      metrics: { occupiedVolume: number; sumTubeVolume: number; maxMultiplicity: number; avgMultiplicity: number; res: number }
    }>('simulate.kakeya_tubes', { delta, nTubes, packing: 1, res })
    const metrics = sim.metrics
    const forkB: ForkSnapshot = {
      ...forkA,
      id: `fork-${Date.now().toString(36)}-b`,
      label: 'B · packing=1（sticky，技能直接计算）',
      params: { ...forkA.params, 'kakeya.packing': 1 },
      metrics: {
        delta,
        nTubes,
        packing: 1,
        res: metrics.res,
        occupiedVolume: metrics.occupiedVolume,
        sumTubeVolume: metrics.sumTubeVolume,
        maxMultiplicity: metrics.maxMultiplicity,
        avgMultiplicity: metrics.avgMultiplicity,
      },
      synthetic: true,
    }
    forkStore.add(forkB)
    addForkNode(forkA, 2210, 320)
    addForkNode(forkB, 2210, 700)
    requestAddNode({
      id: `compare-${forkA.id}-${forkB.id}`,
      type: 'compare',
      position: { x: 2560, y: 320 },
      data: { aId: forkA.id, bId: forkB.id },
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
          multiSelectionKeyCode="Shift"
          panOnDrag={!selectMode}
          selectionOnDrag={selectMode}
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
          <DeskToolbar
            message={message}
            selectMode={selectMode}
            onToggleSelectMode={() => {
              setSelectMode((s) => !s)
              message(selectMode ? '已切回平移模式（拖动=平移画布）' : '框选模式：在空白处拖动框选节点，然后点"成组所选"')
            }}
          />
          <QuestionBar onExpand={onExpand} onCompareSticky={onCompareSticky} message={message} />
          {note && <Panel position="top-right" className="question-note">{note}</Panel>}
        </ReactFlow>
      </div>
    </RuntimeProvider>
  )
}
