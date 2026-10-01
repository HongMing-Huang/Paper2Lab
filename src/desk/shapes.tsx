// tldraw custom shapes for the ingest desk (AGENTS.md §1 v5): paper page,
// lifted formula, interactive experiment, comparison chart, source chip.
// Visual language = warm paper sheets on a research desk — no flowchart
// chrome, no default whiteboard look.
import { useMemo } from 'react'
import { convertLatexToMarkup } from 'mathlive'
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  useEditor,
  useValue,
  type TLAnyShapeUtilConstructor,
  type TLShape,
} from '@tldraw/tldraw'
import { useDesk, useExplorer, useExplorerIds } from './context'
import { deskBus } from './deskBus'
import { PdfCanvas } from './PdfCanvas'
import { FormulaWithChips } from './FormulaWithChips'
import { FormulaChart, SERIES_COLORS } from './FormulaChart'
import { analyzeFormula } from '../formula/analyze'
import { explorerStore } from './explorerStore'

// ---- shape props registry (module augmentation) ---------------------------

declare module '@tldraw/tldraw' {
  export interface TLGlobalShapePropsMap {
    'p2l-paper': {
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
  // memo key by param VALUES: the store mutates params in place, so identity
  // alone would never refresh the chart (or worse, recreate curves on every
  // render — jsxgraph's fade-in then leaves them at opacity 0)
  const paramsKey = JSON.stringify(explorer?.params ?? {})
  const series = useMemo(() => {
    if (!explorer?.compiled) return []
    const indep = explorer.spec.independent.name
    const f = (x: number) => explorer.compiled!.run({ ...explorer.params, [indep]: x })
    return [{ label: 'y(x)', color: SERIES_COLORS[0], f }]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey, explorer?.compiled, explorer?.spec.independent.name])

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
          />
        </Interactive>
        <div className="desk-run-badge">
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
            <span className="calc-badge preview">computing…</span>
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
    return { anchorId: '', latex: '', explorerId: '', w: 460, h: 360 }
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
  const paramsKey = JSON.stringify(explorers.map((ex) => ex.params))
  const series = useMemo(
    () =>
      explorers.map((ex, i) => {
        const indep = ex.spec.independent.name
        return {
          label: `${ex.spec.output ?? 'y'}${i > 0 ? ` #${i + 1}` : ''}`,
          color: SERIES_COLORS[i % SERIES_COLORS.length],
          f: (x: number) => ex.compiled!.run({ ...ex.params, [indep]: x }),
          dashed: i > 0,
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paramsKey, ids.join(',')],
  )
  const range = explorers[0]?.spec.independent.range ?? [-5, 5]
  return (
    <HTMLContainer style={{ pointerEvents: 'all' }}>
      <div className="desk-sheet desk-sheet-chart">
        <div className="desk-sheet-head">
          <span className="desk-sheet-tag">COMPARISON</span>
          <span className="desk-sheet-meta">{explorers.length} 组真实计算结果</span>
        </div>
        <Interactive>
          <FormulaChart series={series} range={range} width={shape.props.w - 48} height={180} />
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
              <tr key={ex.id}>
                <td>
                  <span className="desk-swatch" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                  {i === 0 ? 'base' : `fork ${i}`}
                </td>
                {explorers[0].spec.parameters.map((p) => (
                  <td key={p.name}>{ex.params[p.name].toFixed(2)}</td>
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

export type { PaperShape, FormulaShape, ExperimentShape, ChartShape, SourceShape }
