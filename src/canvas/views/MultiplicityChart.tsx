// Observable Plot figures — throw-away-and-recreate pattern (official recipe).
import { useEffect, useState } from 'react'
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
 *  (Data → Experiment). Plot 0.6 merges dots into a single path, so hits are
 *  served by an absolutely-positioned HTML layer computed via fig.scale(). */
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
  const [hits, setHits] = useState<Array<{ left: number; top: number; runId?: string; label: string }>>([])

  useEffect(() => {
    if (!ref.current || width < 40 || points.length === 0) {
      setHits((prev) => (prev.length ? [] : prev))
      return
    }
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
      color: { domain: seriesNames, unknown: '#2f5d8a' },
      marks: [
        Plot.lineY(points, { x: 'x', y: 'y', stroke: 'series', curve: 'catmull-rom' }),
        Plot.dot(points, { x: 'x', y: 'y', fill: 'series', r: 3.5, tip: true }),
      ],
      style: { color: '#2b2620', fontSize: '11px', background: 'transparent' },
    })
    ref.current.replaceChildren(fig)
    // hit layer: one button per point, positioned via the plot's exposed
    // scales (fig.scale(name) returns { apply, invert, ... })
    const withScales = fig as unknown as {
      scale?: (name: string) => { apply?: (v: number) => number } | undefined
    }
    const applyOf = (name: string): ((v: number) => number) | undefined => {
      try {
        const exposed = withScales.scale?.(name)
        return exposed?.apply ? (v) => exposed.apply!(v) : undefined
      } catch {
        return undefined
      }
    }
    const sx = applyOf('x')
    const sy = applyOf('y')
    if (sx && sy && onPointClick) {
      const next = points.map((p) => ({
        left: 48 + sx(p.x),
        top: 8 + sy(p.y),
        runId: p.runId,
        label: `${p.series} · N=${p.x} · |⋃T|=${p.y.toFixed(4)}${p.runId ? ` · ${p.runId}` : ''}`,
      }))
      // idempotent commit — avoids a render→effect→setState loop
      setHits((prev) =>
        prev.length === next.length &&
        prev.every((h, i) => Math.abs(h.left - next[i].left) < 0.5 && Math.abs(h.top - next[i].top) < 0.5 && h.runId === next[i].runId)
          ? prev
          : next,
      )
    } else {
      setHits((prev) => (prev.length ? [] : prev))
    }
    return () => {
      fig.remove()
    }
  }, [points, width, xLabel, height, ref, onPointClick])

  return (
    <div className="chart-frame chart-clickable" style={{ position: 'relative' }}>
      {/* fig lives in its own sub-container: replaceChildren() on data change
          must not wipe the React-rendered hit buttons */}
      <div ref={ref} />
      <div className="chart-hits">
        {hits.map(
          (h: { left: number; top: number; runId?: string; label: string }, i: number) =>
            h.runId &&
            onPointClick && (
              <button
                key={i}
                type="button"
                className="chart-hit nodrag nowheel"
                style={{ left: h.left - 7, top: h.top - 7 }}
                title={h.label}
                onPointerDown={(e) => onPointClick(h.runId!, { x: e.clientX, y: e.clientY })}
              />
            ),
        )}
      </div>
    </div>
  )
}
