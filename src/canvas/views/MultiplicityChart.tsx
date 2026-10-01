// Observable Plot figures — throw-away-and-recreate pattern (official recipe).
import { useEffect } from 'react'
import * as Plot from '@observablehq/plot'
import type { HistRow, CurvePoint } from '../../kakeya/metrics'
import { useContainerWidth } from '../useContainerWidth'

/** multiplicity histogram — how many voxels are covered exactly m times */
export function MultiplicityChart({
  rows,
  stale,
  height = 190,
}: {
  rows: HistRow[]
  stale: boolean
  height?: number
}) {
  const [ref, width] = useContainerWidth<HTMLDivElement>()
  useEffect(() => {
    if (!ref.current || width < 40) return
    const maxM = Math.max(1, ...rows.map((r) => r.multiplicity))
    const fig = Plot.plot({
      width,
      height,
      marginTop: 6,
      marginRight: 10,
      marginBottom: 30,
      marginLeft: 44,
      x: {
        label: 'multiplicity m（每体素被覆盖次数）',
        domain: [0.5, maxM + 0.5],
        tickFormat: 'd',
        grid: true,
      },
      y: { label: '#voxels', grid: true },
      marks: [
        Plot.rectY(rows, {
          x1: (d) => d.multiplicity - 0.5,
          x2: (d) => d.multiplicity + 0.5,
          y: 'count',
          fill: '#2f5d8a',
          fillOpacity: stale ? 0.35 : 0.85,
          tip: true,
        }),
        Plot.ruleY([0], { stroke: '#6b6154' }),
      ],
      style: { color: '#2b2620', fontSize: '11px', background: 'transparent' },
    })
    ref.current.replaceChildren(fig)
    return () => {
      fig.remove()
    }
  }, [rows, width, stale, height, ref])
  return <div ref={ref} className="chart-frame" />
}

/** |⋃T| curve vs N (or δ) — live sweep + precomputed + fork series.
 *  Clicking a dot navigates back to the experiment that produced it
 *  (Data → Experiment; onPointClick receives the point's runId). */
export function UnionCurveChart({
  points,
  xLabel,
  height = 200,
  onPointClick,
}: {
  points: CurvePoint[]
  xLabel: string
  height?: number
  onPointClick?: (runId: string, screen: { x: number; y: number }) => void
}) {
  const [ref, width] = useContainerWidth<HTMLDivElement>()
  useEffect(() => {
    if (!ref.current || width < 40 || points.length === 0) return
    const seriesNames = [...new Set(points.map((p) => p.series))]
    const fig = Plot.plot({
      width,
      height,
      marginTop: 8,
      marginRight: 12,
      marginBottom: 32,
      marginLeft: 48,
      x: { label: xLabel, grid: true },
      y: { label: '|⋃T|（occupied volume）', grid: true, domain: [0, 1] },
      color: { domain: seriesNames.length > 1 ? seriesNames : [seriesNames[0] ?? ''], unknown: '#2f5d8a' },
      marks: [
        Plot.lineY(points, { x: 'x', y: 'y', stroke: 'series', curve: 'catmull-rom' }),
        Plot.dot(points, {
          x: 'x',
          y: 'y',
          fill: 'series',
          r: 3,
          className: 'sweep-dot',
          tip: true,
        }),
      ],
      style: { color: '#2b2620', fontSize: '11px', background: 'transparent' },
    })
    if (onPointClick) {
      // Plot 0.6 has no plot.on(); mark elements carry their datum on __data__,
      // so we delegate pointerdown on the rendered dots (className-filtered)
      fig.querySelectorAll('.sweep-dot').forEach((el) => {
        el.addEventListener('pointerdown', (e: Event) => {
          const pe = e as PointerEvent
          const d = (e.currentTarget as SVGElement & { __data__?: CurvePoint }).__data__
          if (d?.runId) onPointClick(d.runId, { x: pe.clientX, y: pe.clientY })
        })
      })
    }
    ref.current.replaceChildren(fig)
    return () => {
      fig.remove()
    }
  }, [points, width, xLabel, height, ref, onPointClick])
  return <div ref={ref} className="chart-frame chart-clickable" />
}
