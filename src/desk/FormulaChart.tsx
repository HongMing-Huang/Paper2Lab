// JSXGraph curve chart (CAScad-style rendering layer). Curves evaluate the
// Cortex-compiled JS functions passed in `series` — never hardcoded data. The
// board is read-only in 0.1 (pan/zoom off so tldraw canvas gestures keep
// working around it).
import { useEffect, useRef } from 'react'
import JXG from 'jsxgraph'
import 'jsxgraph/distrib/jsxgraph.css'

export interface ChartSeries {
  label: string
  color: string
  f: (x: number) => number
  dashed?: boolean
}

/** series colors — registered presentation constants */
export const SERIES_COLORS = ['#2f5a8f', '#b3542e', '#5c7a52', '#7d5a9e']

export function FormulaChart({
  series,
  range,
  width,
  height,
}: {
  series: ChartSeries[]
  range: [number, number]
  width: number
  height: number
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<JXG.Board | null>(null)
  const curvesRef = useRef<Array<JXG.GeometryElement>>([])

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
      registerEvents: false,
    })
    boardRef.current = b
    return () => {
      boardRef.current = null
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
    for (const s of series) {
      for (let i = 0; i <= 24; i++) {
        const y = Math.abs(s.f(x0 + ((x1 - x0) * i) / 24))
        if (Number.isFinite(y)) maxAbs = Math.max(maxAbs, y)
      }
    }
    b.setBoundingBox([x0, maxAbs * 1.2, x1, -maxAbs * 1.2], true)
    for (const s of series) {
      curvesRef.current.push(
        b.create(
          'functiongraph',
          [(x: number) => s.f(x), x0, x1],
          { strokeColor: s.color, strokeWidth: 2, dash: s.dashed ? 2 : 0, highlight: false },
        ) as unknown as JXG.GeometryElement,
      )
    }
    b.update()
  }, [series, range])

  return <div ref={hostRef} className="desk-chart" style={{ width, height }} />
}
