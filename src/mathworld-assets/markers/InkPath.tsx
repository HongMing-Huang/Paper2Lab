// Ink path — draws an attempt trajectory (or any polyline the game window
// passes in) as an ink stroke, echoing how kept attempts read on paper
// (PhET-style every-attempt trails). Pure display: points come from the
// game window's computed results; this component computes nothing.
import { Line } from '@react-three/drei'
import { INK_BLUE, INK_SOFT, VERMILION } from '../palette'
import type { MathworldStatus } from '../palette'

const COLOR: Record<MathworldStatus, string> = {
  idle: INK_SOFT,
  computing: INK_SOFT,
  ok: INK_BLUE,
  fail: VERMILION,
}

export interface InkPathPoint {
  x: number
  y: number
  z: number
}

export function InkPath({
  points,
  state = 'idle',
  lineWidth = 1.6,
  opacity = 0.85,
  /** faint trail for non-final attempts */
  faded = false,
}: {
  points: InkPathPoint[]
  state?: MathworldStatus
  lineWidth?: number
  opacity?: number
  faded?: boolean
}) {
  if (points.length < 2) return null
  const coords = points.map((p) => [p.x, p.y, p.z] as [number, number, number])
  return (
    <Line
      points={coords}
      color={COLOR[state]}
      lineWidth={lineWidth}
      transparent
      opacity={faded ? opacity * 0.35 : opacity}
      dashed={faded}
      dashSize={0.05}
      gapSize={0.035}
    />
  )
}
