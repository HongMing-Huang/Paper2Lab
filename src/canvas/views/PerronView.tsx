// 2D Perron tree view — SVG rendering of the translated sub-triangles with a
// rotating unit needle (RAF, direct DOM writes; no React re-render per frame).
import { useEffect, useRef } from 'react'
import type { PerronResult } from '../../kakeya/perron'
import { PERRON_TRIANGLE_AREA } from '../../kakeya/perron'

const W = 2 / Math.sqrt(3) // equilateral base for height 1

export function PerronView({
  result,
  animate,
  width = 360,
  height = 300,
}: {
  result: PerronResult
  animate: boolean
  width?: number
  height?: number
}) {
  const needleRef = useRef<SVGLineElement>(null)
  const trailRef = useRef<SVGPolylineElement>(null)

  // scene bbox: include the original triangle outline for reference
  let minX = Math.min(0, ...result.triangles.map((t) => Math.min(t.base0.x, t.apex.x)))
  let maxX = Math.max(W, ...result.triangles.map((t) => Math.max(t.base1.x, t.apex.x)))
  const spanX = maxX - minX
  const vb = `${minX} -0.06 ${spanX} 1.12`

  useEffect(() => {
    if (!animate || result.medians.length < 2) return
    let raf = 0
    const holdMs = 450
    const moveMs = 700
    const medians = result.medians
    const start = performance.now()
    const cycle = medians.length * (holdMs + moveMs)
    const fmt = (v: number) => v.toFixed(3)
    const frame = (now: number) => {
      const t = (now - start) % cycle
      // defensive: one bad timestamp / stale-closure frame must never kill the loop
      let idx = Number.isFinite(t) ? Math.floor(t / (holdMs + moveMs)) : 0
      if (!(idx >= 0 && idx < medians.length)) idx = 0
      const phase = (t - idx * (holdMs + moveMs)) / (holdMs + moveMs)
      const A = medians[idx]
      const B = medians[(idx + 1) % medians.length]
      if (!A || !B) {
        raf = requestAnimationFrame(frame)
        return
      }
      // hold then sweep A→B (swept motion between directions; continuity via
      // Pál joins is a paper fact, annotated on the card — not drawn here)
      const u = phase < holdMs / (holdMs + moveMs) ? 0 : (phase - holdMs / (holdMs + moveMs)) / (moveMs / (holdMs + moveMs))
      const ax = A.a.x + (B.a.x - A.a.x) * u
      const ay = A.a.y + (B.a.y - A.a.y) * u
      const bx = A.b.x + (B.b.x - A.b.x) * u
      const by = A.b.y + (B.b.y - A.b.y) * u
      const line = needleRef.current
      if (line) {
        line.setAttribute('x1', fmt(ax))
        line.setAttribute('y1', fmt(ay))
        line.setAttribute('x2', fmt(bx))
        line.setAttribute('y2', fmt(by))
      }
      const trail = trailRef.current
      if (trail) trail.setAttribute('points', `${fmt(ax)},${fmt(ay)} ${fmt(bx)},${fmt(by)}`)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [animate, result])

  return (
    <div className="perron-frame">
      <svg viewBox={vb} width={width} height={height} className="nodrag">
        {/* original triangle outline (dashed) */}
        <polygon
          points={`${W / 2},1 0,0 ${W},0`}
          fill="none"
          stroke="#b9ad97"
          strokeWidth={0.008}
          strokeDasharray="0.04 0.03"
        />
        {result.triangles.map((t, i) => (
          <polygon
            key={i}
            points={`${t.apex.x},${t.apex.y} ${t.base0.x},${t.base0.y} ${t.base1.x},${t.base1.y}`}
            fill="rgba(47, 93, 138, 0.10)"
            stroke="rgba(47, 93, 138, 0.55)"
            strokeWidth={0.006}
          />
        ))}
        <polyline ref={trailRef} fill="none" stroke="rgba(154, 59, 46, 0.25)" strokeWidth={0.02} />
        <line
          ref={needleRef}
          stroke="#9a3b2e"
          strokeWidth={0.022}
          strokeLinecap="round"
          x1={result.medians[0]?.a.x ?? 0}
          y1={result.medians[0]?.a.y ?? 1}
          x2={result.medians[0]?.b.x ?? 0}
          y2={result.medians[0]?.b.y ?? 0}
        />
      </svg>
      <div className="metric-row">
        实测面积 {result.computedArea.toFixed(4)} · 原三角形 {PERRON_TRIANGLE_AREA.toFixed(4)} ·
        理论上界 {result.boundArea.toFixed(4)}
      </div>
    </div>
  )
}
