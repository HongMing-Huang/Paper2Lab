// ODE time-series chart (second-paper demo) — Observable Plot line chart.
import { useEffect } from 'react'
import * as Plot from '@observablehq/plot'
import { useContainerWidth } from '../useContainerWidth'
import type { OdePoint } from '../../paper/odeGraph'

export function OdeChart({ points, stale, height = 230 }: { points: OdePoint[]; stale: boolean; height?: number }) {
  const [ref, width] = useContainerWidth<HTMLDivElement>()
  useEffect(() => {
    if (!ref.current || width < 40 || points.length === 0) return
    const fig = Plot.plot({
      width,
      height,
      marginTop: 8,
      marginRight: 12,
      marginBottom: 32,
      marginLeft: 44,
      x: { label: 't（时间）', grid: true },
      y: { label: '种群', grid: true },
      color: { domain: ['猎物 x（prey）', '捕食者 y（predator）'], range: ['#2f5d8a', '#9a3b2e'] },
      marks: [
        Plot.lineY(points, {
          x: 't',
          y: 'v',
          stroke: 'series',
          curve: 'catmull-rom',
          strokeOpacity: stale ? 0.4 : 0.95,
        }),
      ],
      style: { color: '#2b2620', fontSize: '11px', background: 'transparent' },
    })
    ref.current.replaceChildren(fig)
    return () => {
      fig.remove()
    }
  }, [points, width, stale, height, ref])
  return <div ref={ref} className="chart-frame" />
}
