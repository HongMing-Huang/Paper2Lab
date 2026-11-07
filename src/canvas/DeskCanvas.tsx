// v3 desk: starts as the paper (Paper Mode). "展开实验" grows the Lab Canvas;
// questions run the Skills Agent (structured actions, never prose). All modes
// share one reactive runtime (AGENTS.md §0–§4).
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
import { buildLabNodes, buildLibraryNodes, initialEdges, initialNodes } from './deskLayout'
import { buildGroup, dissolveGroup } from './grouping'
import { originBelow } from './expansions'
import {
  deskBus,
  requestAddNode,
  type ForkSnapshot,
} from '../paper/forks'
import { runSkill } from '../skills/types'
import { agentStore } from '../skills/agentStore'
import type { ExperimentPlan } from '../skills/planner'
import '../skills'
import { DemoGuide } from './DemoGuide'

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

/** wait for a cell to settle (resolved), bounded */
async function awaitSettled(cellId: string, timeoutMs = 8000): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (kakeya.get(cellId).status === 'resolved') return true
    await new Promise((r) => setTimeout(r, 120))
  }
  return kakeya.get(cellId).status === 'resolved'
}

export function DeskCanvas({ onExit, demo = false }: { onExit?: () => void; demo?: boolean }) {
  const [nodes, setNodes] = useState<Node[]>(initialNodes)
  const [edges, setEdges] = useState<Edge[]>(initialEdges)
  const [note, setNote] = useState<string | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const message = useCallback((m: string) => setNote(m), [])
  const slotRef = useRef(0) // deterministic placement jitter (not crypto)

  /** the Skills Agent: execute a structured plan; grow the canvas as it runs */
  const runPlan = useCallback(
    async (plan: ExperimentPlan) => {
      agentStore.start(plan)
      message(`本地实验指令执行中：${plan.title}`)
      let forkA: ForkSnapshot | null = null
      try {
        for (let i = 0; i < plan.actions.length; i++) {
          const action = plan.actions[i]
          agentStore.setStatus(i, 'running')
          if (action.skill === 'fork_experiment') {
            forkA = (await runSkill<ForkSnapshot>('fork_experiment', { label: `A · ${String(action.args.label ?? '')}`.replace('A · A', 'A') })) ?? null
            if (forkA) {
              const slot = slotRef.current++
              requestAddNode({ id: `forkcard-${forkA.id}`, type: 'fork', position: { x: 2400, y: 200 + slot * 90 }, data: { forkId: forkA.id } })
            }
          } else if (action.skill === 'compare_experiments') {
            await awaitSettled('kakeya.voxel')
            const forkB = await runSkill<ForkSnapshot>('fork_experiment', { label: 'B · 变更后' })
            requestAddNode({ id: `forkcard-${forkB.id}`, type: 'fork', position: { x: 2400, y: 560 }, data: { forkId: forkB.id } })
            if (forkA?.metrics && forkB.metrics) {
              await runSkill('compare_experiments', { a: forkA.metrics, b: forkB.metrics })
              requestAddNode({
                id: `compare-${forkA.id}-${forkB.id}`,
                type: 'compare',
                position: { x: 2760, y: 300 },
                data: { aId: forkA.id, bId: forkB.id },
              })
            }
          } else if (action.skill === 'explain_result') {
            await awaitSettled('kakeya.voxel')
            const m = (kakeya.get('kakeya.voxel').value as { result?: { occupiedVolume: number; sumTubeVolume: number; maxMultiplicity: number; avgMultiplicity: number } } | undefined)?.result
            if (m) {
              const out = await runSkill<{ reading: string }>('explain_result', {
                occupiedVolume: m.occupiedVolume,
                sumTubeVolume: m.sumTubeVolume,
                maxMultiplicity: m.maxMultiplicity,
                avgMultiplicity: m.avgMultiplicity,
                packing: (kakeya.get('kakeya.packing').value as number) ?? 0,
                delta: (kakeya.get('kakeya.delta').value as number) ?? 0,
              })
              agentStore.finish(out.reading)
            }
          } else {
            await runSkill(action.skill, action.args)
          }
          agentStore.setStatus(i, 'done')
        }
        message(`本地实验指令完成：${plan.title}（实验纸与对比卡已生长）`)
      } catch (err) {
        message(`本地实验指令出错：${String((err as Error).message).slice(0, 80)}`)
        agentStore.finish(null)
      }
    },
    [message],
  )

  useEffect(() => {
    const unsubscribe = deskBus.subscribe((a) => {
      if (a.type === 'add-node' && a.node) {
        const node = a.node
        setNodes((cur) => {
          if (cur.some((n) => n.id === node.id)) return cur
          const origin = originBelow(cur)
          return [...cur, { ...node, position: node.position.x === 0 && node.position.y === 0 ? origin : node.position }]
        })
      } else if (a.type === 'focus-node' && a.nodeId) {
        kakeya.setParam('desk.focusNode', { nodeId: a.nodeId, nonce: Date.now() })
      } else if (a.type === 'expand-lab' || a.type === 'expand-library') {
        // pure, idempotent updaters (StrictMode double-invokes reducers; no
        // setState-inside-updater side effects)
        const lab = a.type === 'expand-lab'
        const { nodes: added, edges: addedEdges } = lab
          ? buildLabNodes({ x: -160, y: 680 })
          : buildLibraryNodes({ x: -160, y: 1560 })
        const probeId = lab ? 'exp-3d' : 'paper-main'
        setNodes((cur) => (cur.some((n) => n.id === probeId) ? cur : [...cur, ...added]))
        setEdges((cur) => {
          const ids = new Set(cur.map((e) => e.id))
          const fresh = addedEdges.filter((e) => !ids.has(e.id))
          return fresh.length ? [...cur, ...fresh] : cur
        })
        message(lab ? '实验已展开到 Lab Canvas（参数就长在实验纸里）' : '研究材料已铺开（定理/公式/概念/来源）')
      } else if (a.type === 'run-plan' && a.plan) {
        void runPlan(a.plan as ExperimentPlan)
      } else if (a.type === 'open-ode') {
        setNodes((cur) =>
          cur.some((n) => n.id === 'ode-sheet')
            ? cur
            : [...cur, { id: 'ode-sheet', type: 'odeSheet', position: { x: -160, y: 1560 }, data: {} }],
        )
        message('第二篇论文已铺开：Lotka–Volterra via Pyodide/scipy（首次加载约 10s）')
      }
    })
    return unsubscribe
  }, [runPlan, message])

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
          fitViewOptions={{ padding: 0.16, maxZoom: 0.9 }}
          nodesConnectable={false}
          deleteKeyCode={null}
          multiSelectionKeyCode="Shift"
          panOnDrag={!selectMode}
          selectionOnDrag={selectMode}
        >
          <Background variant={BackgroundVariant.Dots} gap={26} size={1.5} color="#d8cfc0" bgColor="#faf6ee" />
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
          {demo && <DemoGuide />}
          <DeskToolbar
            message={message}
            selectMode={selectMode}
            onToggleSelectMode={() => {
              setSelectMode((s) => !s)
              message(selectMode ? '已切回平移模式' : '框选模式：空白处拖动框选节点')
            }}
          />
          {onExit && (
            <Panel position="top-left" className="desk-toolbar desk-exit">
              <button type="button" onClick={onExit}>
                ← 返回首页
              </button>
              <button type="button" onClick={() => window.location.reload()}>
                ↺ 重置桌面
              </button>
            </Panel>
          )}
          {note && (
            <Panel position="top-right" className="question-note">
              {note}
            </Panel>
          )}
        </ReactFlow>
      </div>
    </RuntimeProvider>
  )
}
