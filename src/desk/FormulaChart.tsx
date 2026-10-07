// JSXGraph renders immutable ExperimentRun samples. The kernel is only used
// by the scientific runtime and inverse manipulation, never for chart evidence.
import { useEffect, useRef } from 'react'
import JXG from 'jsxgraph'
import 'jsxgraph/distrib/jsxgraph.css'

export interface ChartSeries {
  label: string
  color: string
  points: ReadonlyArray<readonly [number, number]>
  runId: string
  dashed?: boolean
}

/** Interpolation of measured samples for the drag affordance, never a new calculation. */
function at(series: ChartSeries | undefined, x: number): number {
  const points = series?.points ?? []
  if (!points.length) return 0
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const [xa, ya] = points[i - 1]
      const [xb, yb] = points[i]
      return ya + (yb - ya) * (x - xa) / (xb - xa)
    }
  }
  return points[points.length - 1][1]
}

/** series colors — registered presentation constants */
export const SERIES_COLORS = ['#2f5a8f', '#b3542e', '#5c7a52', '#7d5a9e']

/**
 * Direct-geometry anchor (AGENTS.md v6 §9.2): a draggable point riding the
 * first curve at a fixed x; its y is handed back to the caller, which inverts
 * it into a parameter — the graph→parameter direction (not only chips→graph).
 */
export interface ChartAnchor {
  x: number
  /** point dragged (trusted events drive JXG's own drag → pt.on('drag'));
   *  x is included because JXG drags the point freely in 2D */
  onDrag: (x: number, y: number) => void
  /** drag finished — the caller commits the exact run (#23 preview/commit) */
  onDragEnd?: () => void
}

export function FormulaChart({
  series,
  range,
  width,
  height,
  anchor,
  onRunSelect,
}: {
  series: ChartSeries[]
  range: [number, number]
  width: number
  height: number
  anchor?: ChartAnchor
  onRunSelect?: (runId: string) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<JXG.Board | null>(null)
  const curvesRef = useRef<Array<JXG.GeometryElement>>([])
  const anchorPointRef = useRef<JXG.Point | null>(null)
  const latest = useRef({ series: series[0], anchor })
  latest.current = { series: series[0], anchor }
  // direct-geometry drag state — React SYNTHETIC events only: tldraw's
  // tl-html-layer intercepts trusted pointer events in capture before they
  // reach native listeners inside shapes (chips work the same way)
  const dragRef = useRef<{ yUser0: number; clientY0: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const anch = latest.current.anchor
    const node = anchorPointRef.current?.rendNode as SVGElement | undefined
    if (!anch || !node) return
    const r = node.getBoundingClientRect()
    const dx = e.clientX - (r.x + r.width / 2)
    const dy = e.clientY - (r.y + r.height / 2)
    if (dx * dx + dy * dy > 16 * 16) return
    e.stopPropagation()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* best-effort capture */
    }
    dragRef.current = { yUser0: anchorPointRef.current!.Y(), clientY0: e.clientY }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    const b = boardRef.current
    const anch = latest.current.anchor
    if (!d || !b || !anch) return
    const [, ymin, , ymax] = b.getBoundingBox()
    const h = b.canvasHeight || hostRef.current?.clientHeight || 1
    const unitPerPx = (ymax - ymin) / h
    anch.onDrag(anch.x, d.yUser0 - (e.clientY - d.clientY0) * unitPerPx)
  }
  const onPointerUp = () => {
    const wasDragging = dragRef.current !== null
    dragRef.current = null
    if (wasDragging) latest.current.anchor?.onDragEnd?.()
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const [x0, x1] = range
    const b = JXG.JSXGraph.initBoard(host, {
      boundingbox: [x0, 4, x1, -4],
      axis: true,
      showCopyright: false,
      showNavigation: false,
      keepaspectratio: false,
      pan: { enabled: false },
      zoom: { factorX: 1, factorY: 1, wheel: false },
      // pointer events ON so the direct-geometry anchor point is draggable;
      // pan/zoom stay off so the board only consumes the point's own drags
      registerEvents: true,
    })
    boardRef.current = b
    return () => {
      boardRef.current = null
      anchorPointRef.current = null
      JXG.JSXGraph.freeBoard(b)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // (re)create curves whenever the series list changes
  useEffect(() => {
    const b = boardRef.current
    if (!b) return
    for (const c of curvesRef.current) {
      try {
        ;(b.removeObject as (el: JXG.GeometryElement) => void)(c)
      } catch {
        /* already freed */
      }
    }
    curvesRef.current = []
    const [x0, x1] = range
    let maxAbs = 1
    for (const s of series) for (const [, y] of s.points) maxAbs = Math.max(maxAbs, Math.abs(y))
    // keepaspectratio MUST be false: with true the x-window gets rescaled to
    // match the y-range, flinging fixed-x elements (the anchor point) outside
    // the canvas (verified against jsxgraph 1.13.3)
    b.setBoundingBox([x0, maxAbs * 1.2, x1, -maxAbs * 1.2], false)
    for (const s of series) {
      curvesRef.current.push(
        b.create(
          'curve',
          [s.points.map(([x]) => x), s.points.map(([, y]) => y)],
          { strokeColor: s.color, strokeWidth: 2, dash: s.dashed ? 2 : 0, highlight: false },
        ) as unknown as JXG.GeometryElement,
      )
    }
    // keep the direct-geometry anchor riding the (possibly new) curve
    // (read via ref — anchor identity must not churn the curve effect)
    const a = latest.current.anchor
    if (a && series[0]) {
      if (!anchorPointRef.current) {
        const pt = b.create('point', [a.x, at(series[0], a.x)], { name: 'A', size: 3, fillColor: '#b3542e', strokeColor: '#b3542e', showInfobox: false }) as unknown as JXG.Point
        pt.on('drag', () => latest.current.anchor?.onDrag(pt.X(), pt.Y()))
        anchorPointRef.current = pt
      } else anchorPointRef.current.moveTo([a.x, at(series[0], a.x)])
    }
    b.update()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, range])

  return (
    <div>
    <div
      ref={hostRef}
      className="desk-chart"
      data-run-ids={series.map((s) => s.runId).join(',')}
      style={{ width, height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
    <div className="desk-chart-sources">{series.map((s) => <button key={s.runId} type="button" className="link-btn" title={s.runId} onClick={() => onRunSelect?.(s.runId)}>{s.label} · run …{s.runId.slice(-6)} · Source</button>)}</div>
    </div>
  )
}
