// Paper Mode — the paper itself: question, theorem, inline-manipulable
// formula, and the Live Experiment embedded in the page. "展开实验" detaches
// the experiment onto the Lab Canvas. This is the initial desk (AGENTS.md §1).
import { useState, useSyncExternalStore } from 'react'
import { Handle, Position } from '@xyflow/react'
import { useCell, useRuntime } from '../runtime/react'
import {
  tubesCell,
  voxelCell,
  voxelPreviewCell,
  pNeedleOn,
  kakeya,
  PREVIEW_RES,
} from '../paper/kakeyaGraph'
import { GRID as NEEDLE_GRID } from './views/NeedleSweep'
import { deskBus, requestAddNode } from '../paper/forks'
import { PAPER_META, THEOREMS } from '../paper/wangZahl'
import { FormulaView } from './views/FormulaView'
import { ParamChip } from './controls/ParamChip'
import { ParamToggle } from './controls/ParamSlider'
import { NeedleSweep } from './views/NeedleSweep'
import { Tubes3DView } from './views/Tubes3DView'
import { MicroscopeOverlay } from './MicroscopeOverlay'
import { agentStore } from '../skills/agentStore'
import { planExperiment } from '../skills/planner'

function AgentStrip() {
  const state = useSyncExternalStore(agentStore.subscribe, agentStore.get, agentStore.get)
  if (!state.plan) return null
  return (
    <div className="agent-strip">
      <div className="agent-strip-title">AGENT · {state.plan.title}</div>
      <ol className="agent-actions">
        {state.plan.actions.map((a, i) => (
          <li key={i} className={`agent-action st-${state.statuses[i]}`}>
            <span className="agent-skill">{a.skill}</span>
            <span className="agent-label">{a.label}</span>
            <span className="agent-state">
              {state.statuses[i] === 'running'
                ? '⟳'
                : state.statuses[i] === 'done'
                  ? '✓'
                  : state.statuses[i] === 'error'
                    ? '✗'
                    : '·'}
            </span>
          </li>
        ))}
      </ol>
      {state.reading && <div className="agent-reading">💬 {state.reading}</div>}
    </div>
  )
}

function LiveNumbers() {
  const exact = useCell(voxelCell)
  const preview = useCell(voxelPreviewCell)
  const settled = exact.status === 'resolved'
  const run = settled ? exact.value : preview.value
  const m = run?.result
  return (
    <div className={`live-numbers ${settled ? 'num-exact' : 'num-preview'}`}>
      <div className="live-num">
        <span className="live-num-label">Union Volume |⋃T|</span>
        <span className="live-num-value">{m ? m.occupiedVolume.toFixed(4) : '…'}</span>
      </div>
      <div className="live-num">
        <span className="live-num-label">Average Multiplicity</span>
        <span className="live-num-value">{m ? `${m.avgMultiplicity.toFixed(2)}×` : '…'}</span>
      </div>
      <div className="live-num">
        <span className="live-num-label">Max Multiplicity</span>
        <span className="live-num-value">{m ? String(m.maxMultiplicity) : '…'}</span>
      </div>
      <span className={`live-badge${settled ? ' exact' : ''}`}>
        {settled
          ? `CALCULATED · ${run?.engine}@${run?.engineVersion} · ${run?.durationMs}ms · run ${run?.runId}`
          : `preview · res ${PREVIEW_RES}³（松手后 Worker 精算）`}
      </span>
    </div>
  )
}

export function PaperModeNode() {
  const rt = useRuntime()
  const [act, setAct] = useState<'needle' | 'tubes'>('needle')
  const [micro, setMicro] = useState(false)
  const [q, setQ] = useState('')
  const tubes = useCell(tubesCell)
  void rt

  const thm = THEOREMS.find((t) => t.id === 'thm-1.2')!
  const readNum = (id: string) => () => (kakeya.get(id).value as number) ?? 0

  const ask = () => {
    const plan = planExperiment(q || '对比 separated vs sticky', {
      nTubes: (kakeya.get('kakeya.nTubes').value as number) ?? 96,
      deltaExp: (kakeya.get('kakeya.deltaExp').value as number) ?? 4,
      packing: (kakeya.get('kakeya.packing').value as number) ?? 0,
    })
    deskBus.emit({ type: 'run-plan', plan })
  }

  return (
    <div className="sheet paper-mode-sheet">
      <Handle type="target" position={Position.Top} isConnectable={false} className="ink-handle" />
      <Handle type="source" position={Position.Bottom} isConnectable={false} className="ink-handle" />

      <header className="paper-mode-head">
        <div className="paper-mode-title-wrap">
          <h1 className="paper-mode-title">{PAPER_META.title}</h1>
          <div className="paper-mode-authors">
            {PAPER_META.authors} · arXiv:2502.17655 · <span className="badge badge-paper">PAPER</span>
          </div>
        </div>
        <div className="paper-mode-ask nodrag nowheel">
          <input
            name="paper-mode-question"
            value={q}
            placeholder="问一个可运行的问题（如：方向数减少一半会怎样？）"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') ask()
            }}
          />
          <button type="button" onClick={ask}>
            ▶ 运行实验
          </button>
        </div>
      </header>

      <AgentStrip />

      <div className="paper-mode-body">
        <div className="paper-mode-text">
          <p className="paper-question">
            <em>Question.</em> 一族指向所有方向的单位长“针”能有多小的体积？——把针加厚成半径 δ
            的管后，管的并集体积何时被迫接近最大？
          </p>

          <section className="paper-theorem">
            <div className="paper-theorem-label">
              {thm.label} · {thm.title}
            </div>
            <blockquote className="quote-en">
              {thm.quote}
              <cite>— Wang & Zahl (2025), p.{thm.anchor.page}</cite>
            </blockquote>
            <div className="paper-formula-row">
              <FormulaView tex={thm.tex!} />
            </div>
            <p className="paper-note">
              定理里的 δ 不是文字——是下面实验中可直接拖动的量：当前{' '}
              <ParamChip
                label="δ"
                paramId="kakeya.deltaExp"
                read={readNum('kakeya.deltaExp')}
                min={3}
                max={5.5}
                step={0.25}
                display={(v) => `2^−${v.toFixed(2)}=${(2 ** -v).toFixed(4)}`}
              />{' '}
              ，聚集程度{' '}
              <ParamChip label="packing" paramId="kakeya.packing" read={readNum('kakeya.packing')} min={0} max={1} step={0.05} />
              ，方向数{' '}
              <ParamChip label="N" paramId="kakeya.nTubes" read={readNum('kakeya.nTubes')} min={16} max={256} step={8} digits={0} />
              。拖动它们，右侧实验立即变化；松手后 Worker 给出正式 CALCULATED 数值。
            </p>
          </section>

          <section className="paper-mode-actions nodrag">
            <button
              type="button"
              className="primary-btn"
              onClick={() => deskBus.emit({ type: 'expand-lab' })}
            >
              ⤢ 展开实验到画布（Lab Canvas）
            </button>
            <button type="button" className="link-btn" onClick={() => deskBus.emit({ type: 'expand-library' })}>
              ＋ 展开研究材料
            </button>
            <button
              type="button"
              className="link-btn"
              onClick={() => deskBus.emit({ type: 'open-ode' })}
              title="第二篇论文：Pyodide + scipy.solve_ivp（懒加载）"
            >
              ＋ 第二篇论文（Lotka–Volterra · Pyodide/SciPy）
            </button>
          </section>
        </div>

        <div className="paper-mode-experiment">
          <div className="experiment-tabs nodrag">
            <button type="button" className={act === 'needle' ? 'on' : ''} onClick={() => setAct('needle')}>
              第一幕 · 一根针
            </button>
            <button type="button" className={act === 'tubes' ? 'on' : ''} onClick={() => setAct('tubes')}>
              第二幕 · δ-tubes
            </button>
          </div>

          {act === 'needle' ? (
            <div className="act-needle">
              <NeedleSweep size={252} />
              <p className="paper-note dim">
                单位针旋转并留下扫过区域（蓝）。面积由 {NEEDLE_GRID}² 栅格实测——Kakeya 问题的最小模型。
                进第二幕，把针加厚成管、指向所有方向。
              </p>
              <ParamToggle label="Perron 树针动画（Lab 内严格版）" paramId={pNeedleOn.id} />
            </div>
          ) : (
            <div className="act-tubes">
              <div
                className="act-tubes-3d"
                onDoubleClick={() => setMicro(true)}
                title="双击进入 Microscope（zoom 到细尺度）；在管上上下拖动 = 直接改 packing"
              >
                <Tubes3DView tubes={tubes.value ?? []} height={252} spin={0.35} packingDrag />
              </div>
              <LiveNumbers />
              <p className="paper-note dim">
                抓住管群上下拖动 = 直接改变 packing（UI⇄模型双向）；双击 = Microscope。
              </p>
            </div>
          )}
        </div>
      </div>

      {micro && <MicroscopeOverlay onClose={() => setMicro(false)} />}
    </div>
  )
}

export { requestAddNode }
