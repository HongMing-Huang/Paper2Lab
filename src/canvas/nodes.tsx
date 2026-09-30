// Research-desk card nodes. Every card states its provenance
// (PAPER / CALCULATED / AI INFERENCE); numbers come only from runtime cells.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
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
  const delta = useCell(deltaCell)
  const sep = useCell(minSepCell)
  const showVox = useCell<number>('desk.showVoxels')
  return (
    <Sheet
      label="EXPERIMENT · 3D δ-TUBES"
      stale={vox.stale || tubes.stale}
      width={420}
    >
      <div className="exp-subtitle">
        δ = {delta.value?.toFixed(4)} · 方向 = Fibonacci 半球面 · minSep/δ ={' '}
        {sep.value && delta.value ? (sep.value / delta.value).toFixed(2) : '…'}
      </div>
      <Tubes3DView
        tubes={tubes.value ?? []}
        visGrid={vox.value?.visGrid}
        visMaxM={vox.value?.maxMultiplicity}
        showVoxels={!!showVox.value}
        height={330}
      />
      <div className="metric-row">
        {vox.value ? (
          <>
            |⋃T| = {vox.value.occupiedVolume.toFixed(4)} · Σ|T| = {vox.value.sumTubeVolume.toFixed(4)} ·
            重叠率 = {((1 - unionEfficiency(vox.value)) * 100).toFixed(1)}% · max m = {vox.value.maxMultiplicity} ·
            avg m = {vox.value.avgMultiplicity.toFixed(2)}（res³ = {vox.value.res}³ 体素，Worker 计算）
          </>
        ) : (
          '计算中…'
        )}
      </div>
    </Sheet>
  )
}

export function ChartMultiplicityNode() {
  const vox = useCell(voxelCell)
  const rows = useMemo(
    () => (vox.value ? histogramRows(vox.value).filter((r) => r.count > 0) : []),
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
  const live = sweep.value ?? []
  const pre = useMemo<CurvePoint[]>(() => {
    const e = Math.min(5, Math.max(4, Math.round(deltaExp.value ?? 4)))
    const p = [0, 0.5, 1].reduce((best, c) =>
      Math.abs(c - (packing.value ?? 0)) < Math.abs(best - (packing.value ?? 0)) ? c : best, 0)
    return (precomputed.series as Array<Record<string, number>>)
      .filter((r) => r.deltaExp === e && r.packing === p)
      .map((r) => ({ x: r.n, y: r.occupiedVolume, series: 'precomputed（离线脚本）' }))
  }, [deltaExp.value, packing.value])
  const points = [...live, ...pre]
  return (
    <Sheet label="CHART · |⋃T| 随 N 增长" badge="CALCULATED" stale={sweep.stale} width={380}>
      <UnionCurveChart points={points} xLabel="N（管数）" height={210} />
      <div className="card-caption">
        实线=本页 Worker 实时扫描（res 40³）；朱砂点=离线脚本 res 96–128³（scripts/precompute-kakeya.ts，可复现）。
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
  const v = vox.value
  const regime = (packing.value ?? 0) >= 0.6 ? 'packed/sticky' : (packing.value ?? 0) >= 0.25 ? '中间态' : 'separated'
  return (
    <Sheet label="OBSERVATION" stale={vox.stale} width={360}>
      <div className="obs-block">
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
            {perron.value?.computedArea.toFixed(4) ?? '…'}（原三角形 0.5774，理论上界{' '}
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

export const deskNodeTypes = {
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
}
