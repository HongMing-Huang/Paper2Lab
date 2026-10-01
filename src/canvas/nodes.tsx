// Research-desk card nodes. Every card states its provenance
// (PAPER / CALCULATED / AI INFERENCE); numbers come only from runtime cells.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useCell, useRuntime } from '../runtime/react'
import {
  deltaCell,
  minSepCell,
  tubesCell,
  voxelCell,
  perronCell,
  sweepCell,
  pDeltaExp,
  pPacking,
  pPaperAnchor,
  focusPaperAnchor,
} from '../paper/kakeyaGraph'
import { kakeya } from '../paper/kakeyaGraph'
import {
  CONCEPTS,
  FORMULAS,
  PAPER_META,
  THEOREMS,
  WHATIFS,
  type Provenance,
} from '../paper/wangZahl'
import { Tubes3DView } from './views/Tubes3DView'
import { MultiplicityChart, UnionCurveChart } from './views/MultiplicityChart'
import { PaperPageView } from './views/PaperPageView'
import { FormulaView } from './views/FormulaView'
import { PerronView } from './views/PerronView'
import { ParamSlider, ParamToggle } from './controls/ParamSlider'
import { histogramRows, unionEfficiency, type CurvePoint } from '../kakeya/metrics'
import precomputed from '../data/kakeya-precomputed.json'
import { runSkill, subscribeLog } from '../skills/types'
import '../skills'
import {
  forkStore,
  restoreFork,
  requestAddNode,
  snapshotCurrentFork,
  deskBus,
  type ForkSnapshot,
} from '../paper/forks'
import type { VoxelMetrics } from '../kakeya/voxels3d'
import { ParamChip } from './controls/ParamChip'
import { MicroscopeOverlay } from './MicroscopeOverlay'
import { PaperModeNode } from './PaperModeNode'
import { voxelPreviewCell, pNTubes, PREVIEW_RES, SWEEP_RES, SWEEP_NS } from '../paper/kakeyaGraph'
import { PERRON_TRIANGLE_AREA } from '../kakeya/perron'
import { measureFamily } from '../workers/voxelClient'
import { solutionCell } from '../paper/odeGraph'
import { OdeChart } from './views/OdeChart'

// ---- shared frame ----------------------------------------------------------

function Badge({ provenance }: { provenance: Provenance }) {
  return <span className={`badge badge-${provenance.toLowerCase()}`}>{provenance}</span>
}

// hidden handles so annotation edges can attach without flowchart visuals
function InkHandles() {
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} className="ink-handle" />
      <Handle type="source" position={Position.Bottom} isConnectable={false} className="ink-handle" />
    </>
  )
}

function Sheet({
  label,
  badge,
  stale,
  width,
  children,
}: {
  label: string
  badge?: Provenance
  stale?: boolean
  width: number
  children: ReactNode
}) {
  return (
    <div className={`sheet sheet-node${stale ? ' is-stale' : ''}`} style={{ width }}>
      <InkHandles />
      <div className="sheet-head">
        <span className="sheet-label">{label}</span>
        <span className="sheet-head-right">
          {stale && <span className="stale-dot" title="recomputing…" />}
          {badge && <Badge provenance={badge} />}
        </span>
      </div>
      {children}
    </div>
  )
}

const byId = (data: { refId?: unknown }, id: string) => data.refId === id

// ---- paper page node ---------------------------------------------------------

export function PaperPageNode() {
  const [page, setPage] = useState(1)
  const anchor = useCell(pPaperAnchor)
  const a = anchor.value
  useEffect(() => {
    if (a && a.page !== page) setPage(a.page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a?.nonce])
  return (
    <div className="sheet sheet-node paper-sheet">
      <InkHandles />
      <div className="paper-head">
        <div>
          <div className="paper-title">{PAPER_META.title}</div>
          <div className="paper-authors">
            {PAPER_META.authors} · arXiv:2502.17655 · 2025
          </div>
        </div>
        <span className="badge badge-paper">PAPER</span>
      </div>
      <div className="paper-scroll nowheel">
        <PaperPageView
          url={PAPER_META.file}
          page={page}
          widthCss={430}
          highlightNeedle={a?.needle ?? null}
        />
      </div>
      <div className="paper-pager nodrag">
        <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          ‹ 上一页
        </button>
        <span>第 {page} 页</span>
        <button type="button" disabled={page >= 12} onClick={() => setPage((p) => p + 1)}>
          下一页 ›
        </button>
      </div>
    </div>
  )
}

// ---- knowledge cards --------------------------------------------------------

export function TheoremNode({ data }: NodeProps) {
  const item = THEOREMS.find((t) => byId(data, t.id))
  if (!item) return null
  return (
    <Sheet label={item.label} badge="PAPER" width={360}>
      <div className="card-title">{item.title}</div>
      <blockquote className="quote-en">
        {item.quote}
        <cite>— Wang & Zahl (2025), p.{item.anchor.page}</cite>
      </blockquote>
      {item.tex && <FormulaView tex={item.tex} />}
      <p className="card-note">{item.commentary}</p>
      <button type="button" className="link-btn nodrag" onClick={() => focusPaperAnchor(item.anchor.page, item.anchor.needle)}>
        ➤ 在论文中定位此句
      </button>
    </Sheet>
  )
}

export function ConceptNode({ data }: NodeProps) {
  const item = CONCEPTS.find((c) => byId(data, c.id))
  if (!item) return null
  return (
    <Sheet label="CONCEPT" badge={item.provenance} width={340}>
      <div className="card-title">{item.title}</div>
      <p className="card-note">{item.body}</p>
      {item.external && (
        <a className="link-btn" href={item.external} target="_blank" rel="noreferrer">
          ↗ 参考资料（arXiv / 讲义）
        </a>
      )}
    </Sheet>
  )
}

export function FormulaNode({ data }: NodeProps) {
  const item = FORMULAS.find((f) => byId(data, f.id))
  if (!item) return null
  return (
    <Sheet label="FORMULA" badge={item.provenance} width={330}>
      <FormulaView tex={item.tex} />
      <div className="card-caption">{item.caption}</div>
      {item.note && <p className="card-note">{item.note}</p>}
    </Sheet>
  )
}

export function SourceNode() {
  const rt = useRuntime()
  return (
    <Sheet label="SOURCE" badge="PAPER" width={330}>
      <div className="card-title">论文出处</div>
      <div className="source-meta">
        <div>{PAPER_META.title}</div>
        <div>{PAPER_META.authors}</div>
        <div>
          arXiv:{' '}
          <a href={PAPER_META.arxiv} target="_blank" rel="noreferrer">
            2502.17655
          </a>{' '}
          · {PAPER_META.date}
        </div>
        <div>本地副本：{PAPER_META.file}（离线可复现）</div>
      </div>
      <button
        type="button"
        className="link-btn nodrag"
        onClick={() => rt.setParam('desk.focusNode', { nodeId: 'paper-main', nonce: Date.now() })}
      >
        ➤ 聚焦论文纸页
      </button>
    </Sheet>
  )
}

// ---- experiments ------------------------------------------------------------

export function ParamsNode() {
  return (
    <Sheet label="PARAMETERS · 单一数据源" width={300}>
      <div className="card-note dim">
        下列参数是 Reactive Runtime 中的 source of truth；拖动后 3D、指标、图表、观察全部自动重算。
      </div>
      <ParamSlider
        label="δ（管半径）"
        paramId={pDeltaExp.id}
        min={3}
        max={5.5}
        step={0.25}
        hint="δ = 2⁻ᵉ"
        format={(v) => `2⁻${v.toFixed(2)}=${(2 ** -v).toFixed(4)}`}
      />
      <ParamSlider
        label="packing（separated→sticky）"
        paramId={pPacking.id}
        min={0}
        max={1}
        step={0.05}
        format={(v) => v.toFixed(2)}
      />
      <ParamSlider label="N（管数）" paramId="kakeya.nTubes" min={16} max={256} step={16} format={(v) => `${v}`} />
      <ParamSlider
        label="voxel 网格 res³"
        paramId="kakeya.voxelRes"
        min={32}
        max={64}
        step={16}
        format={(v) => `${v}³`}
      />
      <ParamToggle label="3D 显示" paramId="desk.showVoxels" labels={['tubes', 'voxels']} />
      <ParamToggle label="Perron 针动画" paramId="needle.animating" />
    </Sheet>
  )
}

export function Experiment3DNode() {
  const tubes = useCell(tubesCell)
  const vox = useCell(voxelCell)
  const preview = useCell(voxelPreviewCell)
  const delta = useCell(deltaCell)
  const sep = useCell(minSepCell)
  const showVox = useCell<number>('desk.showVoxels')
  const [micro, setMicro] = useState(false)
  const settled = vox.status === 'resolved'
  const run = settled ? vox.value : preview.value
  const m = run?.result
  const readNum = (id: string) => () => (kakeya.get(id).value as number) ?? 0
  return (
    <Sheet
      label="EXPERIMENT · 3D δ-TUBES（实验纸）"
      stale={vox.stale || tubes.stale}
      width={460}
    >
      <div className="exp-chips nodrag">
        <ParamChip label="δ" paramId="kakeya.deltaExp" read={readNum('kakeya.deltaExp')} min={3} max={5.5} step={0.25} display={(v) => `2^−${v.toFixed(2)}`} />
        <ParamChip label="packing" paramId="kakeya.packing" read={readNum('kakeya.packing')} min={0} max={1} step={0.05} />
        <ParamChip label="N" paramId="kakeya.nTubes" read={readNum('kakeya.nTubes')} min={16} max={256} step={8} digits={0} />
        <ParamToggle label="" paramId="desk.showVoxels" labels={['tubes', 'voxels']} />
      </div>
      <div className="exp-subtitle">
        δ = {delta.value?.toFixed(4)} · 方向 = Fibonacci 半球面 · minSep/δ ={' '}
        {sep.value && delta.value ? (sep.value / delta.value).toFixed(2) : '…'} · 抓住管群拖动 = packing
      </div>
      <div onDoubleClick={() => setMicro(true)} title="双击进入 Microscope">
        <Tubes3DView
          tubes={tubes.value ?? []}
          visGrid={vox.value?.result?.visGrid}
          visMaxM={vox.value?.result?.maxMultiplicity}
          showVoxels={!!showVox.value}
          height={330}
          packingDrag
        />
      </div>
      <div className={`metric-row${settled ? '' : ' is-preview'}`}>
        {m ? (
          <>
            |⋃T| = {m.occupiedVolume.toFixed(4)} · Σ|T| = {m.sumTubeVolume.toFixed(4)} ·
            重叠率 = {((1 - unionEfficiency(m)) * 100).toFixed(1)}% · max m = {m.maxMultiplicity} ·
            avg m = {m.avgMultiplicity.toFixed(2)}
            {settled
              ? `（${run?.engine}@${run?.engineVersion} · ${run?.durationMs}ms · res³=${m.res}³ · run ${run?.runId}）`
              : `（preview res ${PREVIEW_RES}³，松手精算）`}
          </>
        ) : (
          '计算中…'
        )}
      </div>
      <div className="exp-actions nodrag">
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            const fork = snapshotCurrentFork(
              `⑂ ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} · packing=${(kakeya.get(pPacking.id).value as number).toFixed(2)}`,
            )
            forkStore.add(fork)
            requestAddNode({
              id: `forkcard-${fork.id}`,
              type: 'fork',
              position: { x: 2400, y: 880 },
              data: { forkId: fork.id },
            })
          }}
        >
          ⑂ Fork 此刻实验
        </button>
        <button
          type="button"
          className="link-btn"
          onClick={() => requestAddNode({ id: 'trace-evidence', type: 'trace', position: { x: 2860, y: -40 }, data: {} })}
        >
          ⤳ 证据链
        </button>
      </div>
      {micro && <MicroscopeOverlay onClose={() => setMicro(false)} />}
    </Sheet>
  )
}

export function ChartMultiplicityNode() {
  const vox = useCell(voxelCell)
  const rows = useMemo(
    () => (vox.value?.result ? histogramRows(vox.value.result).filter((r) => r.count > 0) : []),
    [vox.value],
  )
  return (
    <Sheet label="CHART · MULTIPLICITY 直方图" badge="CALCULATED" stale={vox.stale} width={360}>
      <MultiplicityChart rows={rows} stale={vox.stale} height={200} />
      <div className="card-caption">
        #voxels（纵轴）按被覆盖次数 m 分箱。sticky 时右尾拉长 = 中心高重数。
      </div>
    </Sheet>
  )
}

export function ChartUnionNode() {
  const sweep = useCell(sweepCell)
  const deltaExp = useCell<number>(pDeltaExp)
  const packing = useCell<number>(pPacking)
  const nTubes = useCell<number>(pNTubes)
  const exact = useCell(voxelCell)
  const preview = useCell(voxelPreviewCell)
  const forks = useForks()
  const [forkPoints, setForkPoints] = useState<CurvePoint[]>([])
  const forkKey = forks.map((f) => `${f.id}:${f.metrics?.occupiedVolume ?? 0}`).join('|')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const out: CurvePoint[] = []
      for (const f of forks.slice(-3)) {
        if (!f.metrics) continue
        for (const n of SWEEP_NS) {
          const m = await measureFamily(f.metrics.delta, n, f.metrics.packing, SWEEP_RES)
          if (cancelled) return
          out.push({ x: n, y: m.occupiedVolume, series: `fork · ${f.label}`, runId: f.id })
        }
      }
      if (!cancelled) setForkPoints(out)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forkKey])

  const live = sweep.value ?? []
  const pre = useMemo<CurvePoint[]>(() => {
    const e = Math.min(5, Math.max(4, Math.round(deltaExp.value ?? 4)))
    const p = [0, 0.5, 1].reduce((best, c) =>
      Math.abs(c - (packing.value ?? 0)) < Math.abs(best - (packing.value ?? 0)) ? c : best, 0)
    return (precomputed.series as Array<Record<string, number>>)
      .filter((r) => r.deltaExp === e && r.packing === p)
      .map((r) => ({ x: r.n, y: r.occupiedVolume, series: 'precomputed（离线脚本）', runId: 'precomputed' }))
  }, [deltaExp.value, packing.value])
  // stable identity so the chart effect doesn't loop (points is an effect dep)
  const liveY =
    exact.status === 'resolved' ? exact.value?.result?.occupiedVolume : preview.value?.result?.occupiedVolume
  const liveRunId = exact.status === 'resolved' ? exact.value?.runId : 'preview'
  const points = useMemo<CurvePoint[]>(
    () => [
      ...live.map((p) => ({ ...p, runId: 'main' })),
      ...pre,
      ...forkPoints,
      // the CURRENT experiment's point — moves live during drags (preview)
      // and settles on the Worker's exact value afterwards
      ...(nTubes.value && liveY !== undefined
        ? [{ x: nTubes.value, y: liveY, series: 'current（当前实验）', runId: liveRunId }]
        : []),
    ],
    [live, pre, forkPoints, nTubes.value, liveY, liveRunId],
  )

  const onPointClick = useCallback((runId: string) => {
    if (runId === 'preview' || runId.startsWith('kakeya-voxel')) deskBus.emit({ type: 'focus-node', nodeId: 'exp-3d' })
    else if (runId === 'precomputed') deskBus.emit({ type: 'focus-node', nodeId: 'chart-union' })
    else if (runId.startsWith('kakeya-sweep')) deskBus.emit({ type: 'focus-node', nodeId: 'chart-union' })
    else if (runId.startsWith('fork-')) deskBus.emit({ type: 'focus-node', nodeId: `forkcard-${runId}` })
  }, [])

  return (
    <Sheet label="CHART · |⋃T| 随 N 增长（点数据点⇒定位实验）" badge="CALCULATED" stale={sweep.stale} width={400}>
      <UnionCurveChart points={points} xLabel="N（管数）" height={210} onPointClick={onPointClick} />
      <div className="card-caption">
        {points.length} 数据点 · 实线=本页 Worker 实时扫描；朱砂点=离线预计算（C++）；其余=fork 分支。点击任意数据点 → 定位产生它的实验（Data→Experiment）。
      </div>
    </Sheet>
  )
}

export function PerronNode() {
  const perron = useCell(perronCell)
  const anim = useCell<number>('needle.animating')
  return (
    <Sheet label="EXPERIMENT · 2D Perron 树 + 针旋转" badge="CALCULATED" width={400}>
      <ParamSlider label="细分层数 k（2ᵏ 子三角形）" paramId="perron.k" min={0} max={6} step={1} format={(v) => `k=${v}（${2 ** v} 片）`} />
      <ParamSlider label="重叠比 α" paramId="perron.alpha" min={0.55} max={1} step={0.05} format={(v) => v.toFixed(2)} />
      {perron.value && <PerronView result={perron.value} animate={!!anim.value} width={370} height={280} />}
      <div className="card-note">
        <strong>AI INFERENCE 注</strong>：针在各方向间的连续运动由 Pál join（面积可任意小）恢复——这是
        PAPER 事实；此处动画只示意方向覆盖，实测面积不含 join。
      </div>
    </Sheet>
  )
}

export function ObservationNode() {
  const vox = useCell(voxelCell)
  const perron = useCell(perronCell)
  const delta = useCell(deltaCell)
  const sep = useCell(minSepCell)
  const packing = useCell<number>(pPacking)
  const [flash, setFlash] = useState(0)
  useEffect(() => {
    if (vox.version > 0) setFlash(vox.version) // the new observation "appears" when exact compute lands
  }, [vox.version])
  const v = vox.value?.result
  const regime = (packing.value ?? 0) >= 0.6 ? 'packed/sticky' : (packing.value ?? 0) >= 0.25 ? '中间态' : 'separated'
  return (
    <Sheet label="OBSERVATION" stale={vox.stale} width={360}>
      <div key={flash} className="obs-block obs-appear">
        <Badge provenance="CALCULATED" />
        <ul className="obs-list">
          <li>
            有限尺度（res³={v?.res ?? '…'}³ 体素，δ={delta.value?.toFixed(4) ?? '…'}）：|⋃T| ={' '}
            {v?.occupiedVolume.toFixed(4) ?? '…'}，Σ|T| = {v?.sumTubeVolume.toFixed(4) ?? '…'}，重叠率 ={' '}
            {v ? ((1 - unionEfficiency(v)) * 100).toFixed(1) : '…'}%，max m = {v?.maxMultiplicity ?? '…'}。
          </li>
          <li>
            方向最小角距 = {sep.value ? (sep.value * 180 / Math.PI).toFixed(1) : '…'}° ≥ δ-分离阈值{' '}
            {delta.value ? (delta.value * 180 / Math.PI).toFixed(1) : '…'}°
            {sep.value && delta.value ? (sep.value >= delta.value ? ' ✓' : ' ✗（加密了方向）') : ''}。
          </li>
          <li>
            Perron 树（k={perron.value?.k ?? '…'}, α={perron.value?.alpha.toFixed(2) ?? '…'}）：实测面积{' '}
            {perron.value?.computedArea.toFixed(4) ?? '…'}（原三角形 {PERRON_TRIANGLE_AREA.toFixed(4)}，理论上界{' '}
            {perron.value?.boundArea.toFixed(4) ?? '…'}）。
          </li>
        </ul>
      </div>
      <div className="obs-block ai">
        <Badge provenance="AI INFERENCE" />
        <p className="card-note">
          当前构型 <em>{regime}</em>
          ：{regime === 'packed/sticky'
            ? '所有管穿过中心，中心 multiplicity 峰值 ≈ N（本页实测即见）。方向仍 δ-分离，但管在凸集内聚集——正是 Theorem 1.2 用 Wolff 公理刻画的情形：这种聚集受制于非聚集条件，|⋃T| 的下降被 δ^ε 型因子限制。'
            : regime === 'separated'
              ? '管基本互不重叠，|⋃T| ≈ Σ|T| = N·πδ²（单管解析体积见公式卡）。这与"几乎最大体积"的直觉一致；继续加大 N 观察 |⋃T| 曲线的次线性拐点。'
              : '介于两者之间：重叠率上升、直方图右尾延长。拖 packing 观察 |⋃T| 曲线与 max m 的同步响应。'}
          （解释由 AI 生成；数值全部来自上方 CALCULATED；定理结论以论文原文为准。）
        </p>
      </div>
    </Sheet>
  )
}

export function WhatIfNode({ data }: NodeProps) {
  const rt = useRuntime()
  const item = WHATIFS.find((w) => byId(data, w.id))
  if (!item) return null
  return (
    <Sheet label="WHAT-IF · AI 提议的实验" badge="AI INFERENCE" width={330}>
      <div className="card-title">{item.question}</div>
      <p className="card-note">{item.body}</p>
      {item.apply && (
        <button
          type="button"
          className="link-btn nodrag"
          onClick={() => {
            for (const p of item.apply!) rt.setParam(p.param, p.value)
          }}
        >
          ▶ 应用这组参数
        </button>
      )}
    </Sheet>
  )
}

export function FormulaSandboxNode() {
  return (
    <Sheet label="FORMULA · 沙盒（可编辑）" badge="AI INFERENCE" width={360}>
      <div className="sandbox-wrap nodrag nowheel">
        <math-field className="sandbox-field" value={FORMULAS[0].tex} />
      </div>
      <p className="card-note">
        初始值为 Theorem 1.2 的估计式。你可以改写它来形成自己的猜想——但真值永远以论文原式（FORMULA/PAPER
        卡）与本页 CALCULATED 数值为准。AI 不产生数学结论。
      </p>
    </Sheet>
  )
}

export function RuntimeGraphNode() {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 700)
    return () => clearInterval(t)
  }, [])
  const cells = kakeya.describe()
  return (
    <Sheet label="RUNTIME · 依赖图" width={250}>
      <div className="rt-graph">
        {cells.map((c) => (
          <div key={c.id} className={`rt-cell rt-${c.kind}${c.stale ? ' rt-stale' : ''}`}>
            <span className="rt-kind">{c.kind[0].toUpperCase()}</span>
            <span className="rt-id">{c.id}</span>
            <span className="rt-ver">v{c.version}</span>
            {c.stale && <span className="stale-dot" />}
          </div>
        ))}
      </div>
      <div className="card-caption">P=param · D=derive · A=async(Worker) · 实心点=重算中</div>
    </Sheet>
  )
}

// ---- forks / compare / trace / group（v2） ------------------------------------

function useForks(): readonly ForkSnapshot[] {
  return useSyncExternalStore(forkStore.subscribe, forkStore.get, forkStore.get)
}

export function ForkNode({ data }: NodeProps) {
  const forks = useForks()
  const fork = forks.find((f) => f.id === data.forkId)
  if (!fork) {
    return (
      <Sheet label="EXPERIMENT FORK" width={280}>
        <div className="card-note dim">该分支已被删除。</div>
      </Sheet>
    )
  }
  return (
    <Sheet label="EXPERIMENT FORK" badge="CALCULATED" width={280}>
      <div className="card-title">{fork.label}</div>
      <div className="card-caption">
        {new Date(fork.createdAt).toLocaleString('zh-CN')} · cell 版本戳 v{fork.cellVersions['kakeya.voxel'] ?? 0}
        {fork.synthetic ? ' · 由技能直接计算' : ' · 快照自桌面'}
      </div>
      {fork.metrics ? (
        <>
          <div className="card-caption" title="可追溯性：该分支数值来源的 ExperimentRun">
            {fork.engine ? `${fork.engine} · ${fork.durationMs ?? '?'}ms · run ${fork.runId ?? '—'}` : 'run 元数据待补'}
          </div>
          <ul className="obs-list">
          <li>δ = {fork.metrics.delta.toFixed(4)} · N = {fork.metrics.nTubes} · packing = {fork.metrics.packing.toFixed(2)}</li>
          <li>|⋃T| = {fork.metrics.occupiedVolume.toFixed(4)}</li>
          <li>Σ|T| = {fork.metrics.sumTubeVolume.toFixed(4)}</li>
          <li>max m = {fork.metrics.maxMultiplicity} · avg m = {fork.metrics.avgMultiplicity.toFixed(2)}</li>
          </ul>
        </>
      ) : (
        <div className="card-note dim">暂无 committed 指标（Worker 尚未完成）。</div>
      )}
      <div className="exp-actions">
        <button type="button" className="link-btn nodrag" onClick={() => restoreFork(fork)}>
          ↺ 恢复此分支参数
        </button>
        <button type="button" className="link-btn nodrag" onClick={() => forkStore.remove(fork.id)}>
          ✕ 删除
        </button>
      </div>
    </Sheet>
  )
}

interface CompareOutput {
  summaryA: string
  summaryB: string
  rows: Array<{ metric: string; a: number; b: number; delta: number; relChange: number }>
}

export function CompareNode({ data }: NodeProps) {
  const forks = useForks()
  const a = forks.find((f) => f.id === data.aId)
  const b = forks.find((f) => f.id === data.bId)
  const [result, setResult] = useState<CompareOutput | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (!a?.metrics || !b?.metrics) return
    setBusy(true)
    try {
      setResult(await runSkill<CompareOutput>('compare.configurations', { a: a.metrics, b: b.metrics }))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a?.id, b?.id, a?.metrics?.occupiedVolume, b?.metrics?.occupiedVolume])
  return (
    <Sheet label="COMPARE · 空间对比" badge="CALCULATED" stale={busy} width={380}>
      <div className="compare-heads">
        <div className="compare-col-head">A · {a?.label ?? '—'}</div>
        <div className="compare-col-head">B · {b?.label ?? '—'}</div>
      </div>
      {result ? (
        <table className="compare-table">
          <thead>
            <tr>
              <th>指标</th>
              <th>A</th>
              <th>B</th>
              <th>Δ (B−A)</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={r.metric}>
                <td>{r.metric}</td>
                <td>{r.a.toFixed(4)}</td>
                <td>{r.b.toFixed(4)}</td>
                <td className={r.delta > 0 ? 'pos' : r.delta < 0 ? 'neg' : ''}>
                  {r.delta >= 0 ? '+' : ''}
                  {r.delta.toFixed(4)}
                  {Math.abs(r.relChange) > 0.001 && (
                    <span className="rel"> ({r.relChange >= 0 ? '+' : ''}{(100 * r.relChange).toFixed(0)}%)</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="card-note dim">{busy ? 'compare.configurations 运行中…' : '缺少可对比的指标快照。'}</div>
      )}
      <div className="card-caption">数据来自 compare.configurations 技能（CALCULATED）；对比基于 fork 时刻的冻结指标。</div>
    </Sheet>
  )
}

interface TraceOutput {
  target: string
  chain: Array<{ kind: string; id: string; version?: number; stale?: boolean; detail: string }>
}

interface VerifyOutput {
  checks: Array<{ name: string; pass: boolean; detail: string }>
  allPass: boolean
}

interface PyodideOutput {
  available: boolean
  reason?: string
  mc?: number
  analytic?: number
  relErr?: number
  pass?: boolean
}

export function TraceNode() {
  const [trace, setTrace] = useState<TraceOutput | null>(null)
  const [verify, setVerify] = useState<VerifyOutput | null>(null)
  const [pyodide, setPyodide] = useState<PyodideOutput | null>(null)
  const [pyBusy, setPyBusy] = useState(false)
  const [, force] = useState(0)
  useEffect(() => subscribeLog(() => force((n) => n + 1)), [])
  useEffect(() => {
    void runSkill<TraceOutput>('trace.evidence', { target: 'kakeya.voxel' }).then(setTrace)
  }, [])
  const runVerify = async () => {
    const vox = kakeya.get('kakeya.voxel').value as VoxelMetrics | undefined
    if (!vox) return
    const perron = kakeya.get('perron.tree').value as { computedArea: number; triangleArea: number } | undefined
    setVerify(
      await runSkill<VerifyOutput>('verify.invariants', {
        metrics: vox,
        packing: (kakeya.get(pPacking.id).value as number) ?? 0,
        nTubes: (kakeya.get('kakeya.nTubes').value as number) ?? 0,
        perronComputedArea: perron?.computedArea,
        perronTriangleArea: perron?.triangleArea,
      }),
    )
  }
  const runPyodide = async () => {
    setPyBusy(true)
    try {
      const delta = (kakeya.get('kakeya.delta').value as number) ?? 0.125
      setPyodide(await runSkill<PyodideOutput>('verify.pyodide_numpy', { delta: Math.max(0.05, Math.min(0.15, delta)) }))
    } finally {
      setPyBusy(false)
    }
  }
  const kindIcon: Record<string, string> = { param: '🎛', cell: '◇', skill: '⚙', paper: '📄' }
  return (
    <Sheet label="TRACE · 证据链" width={360}>
      <div className="card-title">kakeya.voxel 的证据从哪来？</div>
      {trace ? (
        <ol className="trace-chain">
          {trace.chain.map((c, i) => (
            <li key={i} className={`trace-${c.kind}`}>
              <span className="trace-icon">{kindIcon[c.kind] ?? '·'}</span>
              <span className="trace-id">{c.id}</span>
              {c.version !== undefined && <span className="trace-ver">v{c.version}</span>}
              {c.stale && <span className="stale-dot" />}
              <span className="trace-detail">{c.detail}</span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="card-note dim">trace.evidence 运行中…</div>
      )}
      <div className="exp-actions">
        <button type="button" className="link-btn nodrag" onClick={runVerify}>
          ✔ 运行不变量校验
        </button>
        <button type="button" className="link-btn nodrag" onClick={runPyodide} disabled={pyBusy}>
          🐍 NumPy 交叉验证{pyBusy ? '…' : '（Pyodide，可选）'}
        </button>
      </div>
      {verify && (
        <div className={`verify-box ${verify.allPass ? 'pass' : 'fail'}`}>
          <div className="verify-head">
            verify.invariants · {verify.allPass ? '全部通过' : '存在失败项'}
          </div>
          {verify.checks.map((c) => (
            <div key={c.name} className="verify-row">
              <span className={c.pass ? 'ok' : 'bad'}>{c.pass ? '✓' : '✗'}</span>
              <span>{c.name}</span>
              <span className="verify-detail">{c.detail}</span>
            </div>
          ))}
        </div>
      )}
      {pyodide && (
        <div className={`verify-box ${pyodide.available ? (pyodide.pass ? 'pass' : 'fail') : 'muted'}`}>
          <div className="verify-head">verify.pyodide_numpy（可选运行时）</div>
          {pyodide.available ? (
            <div className="verify-row">
              <span className={pyodide.pass ? 'ok' : 'bad'}>{pyodide.pass ? '✓' : '✗'}</span>
              <span>
                NumPy MC 体积 {pyodide.mc?.toFixed(5)} vs 解析 {pyodide.analytic?.toFixed(5)} · relErr{' '}
                {(100 * (pyodide.relErr ?? 1)).toFixed(2)}%
              </span>
            </div>
          ) : (
            <div className="verify-row">
              <span className="muted">—</span>
              <span>{pyodide.reason}</span>
            </div>
          )}
        </div>
      )}
      <div className="card-caption">
        徽章：🎛 参数（source of truth）· ◇ Runtime cell · ⚙ 技能运行 · 📄 PAPER 锚点。技能运行记录见 EvidenceLog。
      </div>
    </Sheet>
  )
}

export function GroupNode({ data }: NodeProps) {
  return (
    <div className="group-node nodrag">
      <div className="group-tag">📎 {typeof data.label === 'string' ? data.label : '分组'}</div>
      <InkHandles />
    </div>
  )
}

// ---- 第二篇论文（Pyodide/SciPy 平台性演示） -----------------------------------

export function OdeSheetNode() {
  const sol = useCell(solutionCell)
  const readNum = (id: string) => () => (kakeya.get(id).value as number) ?? 0
  return (
    <Sheet
      label="PAPER 2 · LOTKA–VOLTERRA（PythonScientificRuntime）"
      badge="CALCULATED"
      stale={sol.stale}
      width={420}
    >
      <div className="card-note dim">
        Kakeya 走 TypeScript+Worker；这页走 <strong>Pyodide → scipy.solve_ivp</strong>（懒加载，不影响 Kakeya）。
        拖动参数重新积分：
      </div>
      <div className="exp-chips nodrag">
        <ParamChip label="α 猎物增长" paramId="lv.alpha" read={readNum('lv.alpha')} min={0.4} max={2.2} step={0.1} />
        <ParamChip label="β 捕食" paramId="lv.beta" read={readNum('lv.beta')} min={0.1} max={1.0} step={0.05} />
        <ParamChip label="γ 捕食者死亡" paramId="lv.gamma" read={readNum('lv.gamma')} min={0.1} max={1.0} step={0.05} />
        <ParamChip label="δ 转化" paramId="lv.delta" read={readNum('lv.delta')} min={0.02} max={0.4} step={0.02} />
      </div>
      {sol.status === 'error' ? (
        <div className="card-note">
          ⚠ Python 运行时不可用（离线/CDN 失败）：{String(sol.error).slice(0, 120)}… —
          Kakeya 演示不受影响（其计算永不依赖 Pyodide）。
        </div>
      ) : (
        <OdeChart points={sol.value?.result ?? []} stale={sol.stale} />
      )}
      {sol.value && (
        <div className="card-caption">
          {sol.value.engine}@{sol.value.engineVersion} · {sol.value.durationMs}ms · run{' '}
          {sol.value.runId} · 首次打开需从 CDN 加载 Pyodide+SciPy。结果为确定性 CALCULATED；
          这张纸证明 Parameter → Pyodide → scipy.solve_ivp → Result → Chart 的平台通路。
        </div>
      )}
    </Sheet>
  )
}

export const deskNodeTypes = {
  paperMode: PaperModeNode,
  paperPage: PaperPageNode,
  theorem: TheoremNode,
  concept: ConceptNode,
  formula: FormulaNode,
  source: SourceNode,
  params: ParamsNode,
  experiment3d: Experiment3DNode,
  chartMultiplicity: ChartMultiplicityNode,
  chartUnion: ChartUnionNode,
  perron: PerronNode,
  observation: ObservationNode,
  whatif: WhatIfNode,
  formulaSandbox: FormulaSandboxNode,
  runtimeGraph: RuntimeGraphNode,
  fork: ForkNode,
  compare: CompareNode,
  trace: TraceNode,
  group: GroupNode,
  odeSheet: OdeSheetNode,
}
