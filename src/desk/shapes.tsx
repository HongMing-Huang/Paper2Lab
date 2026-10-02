// tldraw custom shapes for the ingest desk (AGENTS.md §1 v5): paper page,
// lifted formula, interactive experiment, comparison chart, source chip.
// Visual language = warm paper sheets on a research desk — no flowchart
// chrome, no default whiteboard look.
import { useMemo, useSyncExternalStore } from 'react'
import { convertLatexToMarkup } from 'mathlive'
import {
  BindingUtil,
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  useEditor,
  useValue,
  type TLAnyShapeUtilConstructor,
  type TLBinding,
  type TLShape,
  type TLShapeId,
} from '@tldraw/tldraw'
import { useDesk, useExplorer, useExplorerIds } from './context'
import { deskBus } from './deskBus'
import { PdfCanvas } from './PdfCanvas'
import { FormulaWithChips } from './FormulaWithChips'
import { FormulaChart, SERIES_COLORS } from './FormulaChart'
import { analyzeFormula } from '../formula/analyze'
import { explorerStore } from './explorerStore'
import { agentState } from './agentState'

// ---- shape props registry (module augmentation) ---------------------------

declare module '@tldraw/tldraw' {
  export interface TLGlobalShapePropsMap {    'p2l-paper': {
      docId: string
      page: number
      w: number
      h: number
      /** anchor id of the key formula (marker position) */
      keyAnchorId: string
      /** anchor id currently flash-highlighted ('' = none) */
      highlightAnchorId: string
    }
    'p2l-formula': {
      anchorId: string
      latex: string
      explorerId: string
      w: number
      h: number
    }
    'p2l-experiment': {
      anchorId: string
      latex: string
      explorerId: string
      w: number
      h: number
    }
    'p2l-chart': {
      anchorId: string
      w: number
      h: number
    }
    'p2l-source': {
      anchorId: string
      label: string
      w: number
      h: number
    }
  }
  export interface TLGlobalBindingPropsMap {
    'p2l-trace': Record<string, never>
  }
}

type PaperShape = TLShape<'p2l-paper'>
type FormulaShape = TLShape<'p2l-formula'>
type ExperimentShape = TLShape<'p2l-experiment'>
type ChartShape = TLShape<'p2l-chart'>
type SourceShape = TLShape<'p2l-source'>

/** interactive zone helper — stop events before they reach the tldraw canvas
 *  (tldraw 5 removed the element-based stopEventPropagation; stopping React
 *  synthetic events at this div keeps chip drags / buttons / JSXGraph local) */
function Interactive({ children, className }: { children: React.ReactNode; className?: string }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  return (
    <div
      className={className}
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onWheel={stop}
    >
      {children}
    </div>
  )
}

// ---- PaperShape ------------------------------------------------------------

function PaperComponent({ shape }: { shape: PaperShape }) {
  const { doc, pdfUrl } = useDesk()
  const p = shape.props
  const keyAnchor = doc.items.find((i) => i.id === p.keyAnchorId) ?? null
  const highlightAnchor = doc.items.find((i) => i.id === p.highlightAnchorId) ?? null
  return (
    <HTMLContainer style={{ pointerEvents: 'all' }}>
      <div className="desk-paper-sheet">
        <PdfCanvas
          url={pdfUrl}
          page={p.page}
          width={p.w}
          highlight={highlightAnchor ? highlightAnchor.bbox : null}
        />
        {keyAnchor && (
          <Interactive>
            <button
              type="button"
              className="desk-playable-marker"
              style={{
                left: keyAnchor.bbox.x * p.w + keyAnchor.bbox.w * p.w + 6,
                top: keyAnchor.bbox.y * p.h - 2,
              }}
              title="展开这个公式的实验"
              onClick={() => deskBus.emit({ kind: 'marker-click', anchorId: keyAnchor.id })}
            >
              ▸ Playable
            </button>
          </Interactive>
        )}
      </div>
    </HTMLContainer>
  )
}

class PaperShapeUtil extends ShapeUtil<PaperShape> {
  static override type = 'p2l-paper' as const
  static override props = {
    docId: T.string,
    page: T.number,
    w: T.number,
    h: T.number,
    keyAnchorId: T.string,
    highlightAnchorId: T.string,
  }
  getDefaultProps(): PaperShape['props'] {
    return { docId: '', page: 1, w: 560, h: 726, keyAnchorId: '', highlightAnchorId: '' }
  }
  override canBind(): boolean {
    return true
  }
  getGeometry(shape: PaperShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }
  component(shape: PaperShape) {
    return <PaperComponent shape={shape} />
  }
  getIndicatorPath(shape: PaperShape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }
}

// ---- FormulaShape (the formula lifted out of the paper) --------------------

function FormulaComponent({ shape }: { shape: FormulaShape }) {
  const p = shape.props
  const { doc } = useDesk()
  const anchor = doc.items.find((i) => i.id === p.anchorId)
  return (
    <HTMLContainer style={{ pointerEvents: 'all' }}>
      <div className="desk-sheet desk-sheet-formula">
        <div className="desk-sheet-head">
          <span className="desk-sheet-tag">FORMULA</span>
          <span className="desk-sheet-meta">from source p.{anchor?.page ?? '?'}</span>
        </div>
        <div
          className="desk-formula-static"
          dangerouslySetInnerHTML={{ __html: convertLatexToMarkup(p.latex) }}
        />
        <Interactive className="desk-sheet-actions">
          <button
            type="button"
            className="desk-btn desk-btn-play"
            onClick={() => deskBus.emit({ kind: 'play', anchorId: p.anchorId })}
          >
            ▶ Play
          </button>
          <button
            type="button"
            className="desk-btn"
            title="回到原论文位置"
            onClick={() => deskBus.emit({ kind: 'source', anchorId: p.anchorId })}
          >
            ⌖ Source
          </button>
        </Interactive>
      </div>
    </HTMLContainer>
  )
}

class FormulaShapeUtil extends ShapeUtil<FormulaShape> {
  static override type = 'p2l-formula' as const
  static override props = { anchorId: T.string, latex: T.string, explorerId: T.string, w: T.number, h: T.number }
  getDefaultProps(): FormulaShape['props'] {
    return { anchorId: '', latex: '', explorerId: '', w: 300, h: 150 }
  }
  override canBind(): boolean {
    return true
  }
  getGeometry(shape: FormulaShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }
  component(shape: FormulaShape) {
    return <FormulaComponent shape={shape} />
  }
  getIndicatorPath(shape: FormulaShape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }
}

// ---- ExperimentShape (the Interactive Figure) ------------------------------

function ExperimentComponent({ shape }: { shape: ExperimentShape }) {
  const editor = useEditor()
  const p = shape.props
  const explorer = useExplorer(p.explorerId)
  const analysis = analyzeFormula(p.latex)
  const selected = useValue(
    'selected',
    () => editor.getOnlySelectedShape()?.id === shape.id,
    [editor, shape.id],
  )
  const run = explorer?.run ?? null
  // orchestrator phase rendered on the paper itself (RUNNING → LOCAL COMPUTE → CALCULATED)
  const agent = useSyncExternalStore(agentState.subscribe, agentState.getSnapshot, agentState.getSnapshot)
  const phase =
    agent.explorerId === p.explorerId && agent.phase.kind !== 'idle' ? agent.phase : null
  // memo key by param VALUES: the store mutates params in place, so identity
  // alone would never refresh the chart (or worse, recreate curves on every
  // render — jsxgraph's fade-in then leaves them at opacity 0)
  const series = useMemo(() => run?.result ? [{ label: 'y(x)', color: SERIES_COLORS[0], points: run.result.points, runId: run.runId }] : [], [run])

  // Direct Geometry (AGENTS.md v6 §9.2): drag point A on the curve → bisection
  // inverts the measured (x, y) back into the FIRST parameter (graph→param).
  const anchor = useMemo(() => {
    const ex = explorer
    if (!ex?.compiled || ex.spec.parameters.length === 0) return undefined
    const x0 =
      ex.spec.independent.range[0] +
      (ex.spec.independent.range[1] - ex.spec.independent.range[0]) * 0.25
    return {
      x: x0,
      onDrag: (x: number, y: number) => {
        const p = ex.spec.parameters[0]
        const indep = ex.spec.independent.name
        const at = (v: number) => ex.compiled!.run({ ...ex.params, [p.name]: v, [indep]: x })
        const yLo = at(p.min)
        const yHi = at(p.max)
        // bracket check (works for either monotone direction)
        if (!Number.isFinite(yLo) || !Number.isFinite(yHi)) return
        if ((yLo - y) * (yHi - y) > 0) return
        let lo = p.min
        let hi = p.max
        for (let i = 0; i < 40; i++) {
          const mid = (lo + hi) / 2
          if ((at(mid) - y) * (yLo - y) > 0) lo = mid
          else hi = mid
        }
        const snapped = Math.round(((lo + hi) / 2) / p.step) * p.step
        explorerStore.setParams(ex.id, {
          [p.name]: Math.min(p.max, Math.max(p.min, snapped)),
        })
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explorer?.id, explorer?.compiled, explorer?.spec.independent.name, explorer?.spec.parameters])

  return (
    <HTMLContainer style={{ pointerEvents: 'all' }}>
      <div className={`desk-sheet desk-sheet-experiment${selected ? ' selected' : ''}`}>
        <div className="desk-sheet-head">
          <span className="desk-sheet-tag">INTERACTIVE FIGURE</span>
          <span className="desk-sheet-meta">
            {explorer?.spec.output ? `${explorer.spec.output}(` : 'y('}
            {explorer?.spec.independent.name ?? 'x'}) — 实验纸
          </span>
        </div>
        {analysis.ok && (
          <div className="desk-experiment-formula">
            <FormulaWithChips
              latex={analysis.latex}
              params={analysis.params}
              explorerId={p.explorerId}
            />
          </div>
        )}
        <Interactive>
          <FormulaChart
            series={series}
            range={explorer?.spec.independent.range ?? [-5, 5]}
            width={p.w - 48}
            height={200}
            anchor={anchor}
            onRunSelect={() => deskBus.emit({ kind: 'source', anchorId: p.anchorId })}
          />
        </Interactive>
        <div className="desk-run-badge" style={{ opacity: explorer?.status !== 'resolved' ? 0.45 : 1 }} data-run-id={run?.runId}>
          {phase && (
            <span className={`desk-agent-phase st-${phase.kind}`}>
              {phase.kind === 'plan' && 'PLAN'}
              {phase.kind === 'running' && 'RUNNING'}
              {phase.kind === 'computed' && `LOCAL COMPUTE · ${phase.durationMs}ms → CALCULATED`}
              {phase.kind === 'error' && 'ERROR'}
            </span>
          )}
          {explorer?.status === 'error' && <span className="calc-badge preview">ERROR · {explorer.error}</span>}
          {run && run.result ? (
            <>
              <span className={`calc-badge${run.engine.includes('js') ? ' exact' : ''}`}>
                LOCAL CALC · {run.durationMs} ms
              </span>
              <span className="desk-run-engine">
                {run.engine}@{run.engineVersion} · run {run.runId.slice(-6)}
              </span>
              <span className="desk-run-metric">
                peak |{explorer?.spec.output ?? 'y'}| = {run.result.peak.toFixed(3)} · ∫|y|dx ={' '}
                {run.result.integral.toFixed(3)}
              </span>
            </>
          ) : (
            <span className="calc-badge preview">{explorer?.error ?? 'computing…'}</span>
          )}
        </div>
        {selected && (
          <Interactive className="desk-sheet-actions desk-toolbar-on-select">
            <button
              type="button"
              className="desk-btn"
              onClick={() => deskBus.emit({ kind: 'fork', explorerId: p.explorerId, anchorId: p.anchorId })}
            >
              ⑂ Fork
            </button>
            <button type="button" className="desk-btn" onClick={() => deskBus.emit({ kind: 'compare' })}>
              ⇄ Compare
            </button>
            <button
              type="button"
              className="desk-btn"
              onClick={() => deskBus.emit({ kind: 'source', anchorId: p.anchorId })}
            >
              ⌖ Source
            </button>
          </Interactive>
        )}
      </div>
    </HTMLContainer>
  )
}

class ExperimentShapeUtil extends ShapeUtil<ExperimentShape> {
  static override type = 'p2l-experiment' as const
  static override props = { anchorId: T.string, latex: T.string, explorerId: T.string, w: T.number, h: T.number }
  getDefaultProps(): ExperimentShape['props'] {
    return { anchorId: '', latex: '', explorerId: '', w: 460, h: 380 }
  }
  override canBind(): boolean {
    return true
  }
  getGeometry(shape: ExperimentShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }
  component(shape: ExperimentShape) {
    return <ExperimentComponent shape={shape} />
  }
  getIndicatorPath(shape: ExperimentShape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }
}

// ---- ChartShape (fork comparison) ------------------------------------------

function ChartComponent({ shape }: { shape: ChartShape }) {
  const ids = useExplorerIds()
  const explorers = ids.map((id) => explorerStore.get(id)!).filter(Boolean)
  const runKey = explorers.map((ex) => ex.run?.runId ?? '').join(',')
  const series = useMemo(() => explorers.flatMap((ex, i) => ex.run?.result ? [{
    label: `${ex.spec.output ?? 'y'} #${i + 1}`,
    color: SERIES_COLORS[i % SERIES_COLORS.length],
    points: ex.run.result.points,
    runId: ex.run.runId,
    dashed: i > 0,
  }] : []), [runKey])
  const range = explorers[0]?.spec.independent.range ?? [-5, 5]
  return (
    <HTMLContainer style={{ pointerEvents: 'all' }}>
      <div className="desk-sheet desk-sheet-chart">
        <div className="desk-sheet-head">
          <span className="desk-sheet-tag">COMPARISON</span>
          <span className="desk-sheet-meta">{explorers.length} 组真实计算结果</span>
        </div>
        <Interactive>
          <FormulaChart series={series} range={range} width={shape.props.w - 48} height={180}
            onRunSelect={(runId) => {
              const ex = explorers.find((e) => e.run?.runId === runId)
              if (ex) deskBus.emit({ kind: 'source', anchorId: ex.spec.anchor.anchorId ?? shape.props.anchorId })
            }} />
        </Interactive>
        <table className="desk-compare-table">
          <thead>
            <tr>
              <th>run</th>
              {explorers[0]?.spec.parameters.map((p) => <th key={p.name}>{p.name}</th>)}
              <th>peak</th>
              <th>∫|y|dx</th>
              <th>ms</th>
            </tr>
          </thead>
          <tbody>
            {explorers.map((ex, i) => (
              <tr key={ex.id} data-run-id={ex.run?.runId}>
                <td>
                  <span className="desk-swatch" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                  {i === 0 ? 'base' : `fork ${i}`} · {ex.run?.runId.slice(-6)}
                </td>
                {explorers[0].spec.parameters.map((p) => (
                  <td key={p.name}>{(ex.run?.spec.params[p.name] ?? ex.params[p.name]).toFixed(2)}</td>
                ))}
                <td>{ex.run?.result ? ex.run.result.peak.toFixed(3) : '…'}</td>
                <td>{ex.run?.result ? ex.run.result.integral.toFixed(3) : '…'}</td>
                <td>{ex.run ? ex.run.durationMs : '…'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </HTMLContainer>
  )
}

class ChartShapeUtil extends ShapeUtil<ChartShape> {
  static override type = 'p2l-chart' as const
  static override props = { anchorId: T.string, w: T.number, h: T.number }
  getDefaultProps(): ChartShape['props'] {
    return { anchorId: '', w: 480, h: 340 }
  }
  override canBind(): boolean {
    return true
  }
  getGeometry(shape: ChartShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }
  component(shape: ChartShape) {
    return <ChartComponent shape={shape} />
  }
  getIndicatorPath(shape: ChartShape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }
}

// ---- SourceShape (trace chip) ----------------------------------------------

function SourceComponent({ shape }: { shape: SourceShape }) {
  const p = shape.props
  return (
    <HTMLContainer style={{ pointerEvents: 'all' }}>
      <Interactive>
        <button
          type="button"
          className="desk-source-chip"
          onClick={() => deskBus.emit({ kind: 'source', anchorId: p.anchorId })}
          title="镜头回到原论文对应区域"
        >
          ⌖ Source · {p.label}
        </button>
      </Interactive>
    </HTMLContainer>
  )
}

class SourceShapeUtil extends ShapeUtil<SourceShape> {
  static override type = 'p2l-source' as const
  static override props = { anchorId: T.string, label: T.string, w: T.number, h: T.number }
  getDefaultProps(): SourceShape['props'] {
    return { anchorId: '', label: '', w: 250, h: 40 }
  }
  getGeometry(shape: SourceShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }
  component(shape: SourceShape) {
    return <SourceComponent shape={shape} />
  }
  getIndicatorPath(shape: SourceShape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }
}

export const deskShapeUtils: TLAnyShapeUtilConstructor[] = [
  PaperShapeUtil,
  FormulaShapeUtil,
  ExperimentShapeUtil,
  ChartShapeUtil,
  SourceShapeUtil,
]

/** source-trace binding (AGENTS.md v6 §8): experiment paper → source formula.
 *  No visual — the relationship record survives moving either shape; the
 *  Source button uses it to trace back to the paper. */
type TraceBinding = TLBinding<'p2l-trace'>

class TraceBindingUtil extends BindingUtil<TraceBinding> {
  static override type = 'p2l-trace' as const
  getDefaultProps(): TraceBinding['props'] {
    return {}
  }
}

export const deskBindingUtils = [TraceBindingUtil]

/** trace binding lookup: experiment paper → the formula shape it grew from */
export function sourceBindingTarget(
  editor: { getBindingsFromShape: (id: TLShapeId, type: string) => unknown[] },
  fromShapeId: TLShapeId,
): TLShapeId | null {
  const bindings = editor.getBindingsFromShape(fromShapeId, 'p2l-trace') as Array<{
    toId: TLShapeId
  }>
  return bindings[0]?.toId ?? null
}

export type { PaperShape, FormulaShape, ExperimentShape, ChartShape, SourceShape }
