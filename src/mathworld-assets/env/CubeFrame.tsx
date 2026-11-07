// Cube reference frame — an upgrade of the bare EdgesGeometry cube used by
// Tubes3DView: paper edges + corner dots + axis ticks along the bottom
// edges, so players can read depth and scale of the math world. Pure
// decoration: it holds no geometry authority; the game window positions it
// with explicit size/origin props (default matches tubes at [-0.5, 0.5]³).
import { useMemo } from 'react'
import * as THREE from 'three'
import { INK_SOFT, BRASS } from '../palette'

export interface CubeFrameProps {
  /** edge length; tubes in this repo live in a 1×1×1 cube */
  size?: number
  /** cube centre; TubesScene centres the unit cube at the group origin */
  origin?: [number, number, number]
  edgeColor?: string
  tickColor?: string
  cornerColor?: string
  edgeOpacity?: number
  showTicks?: boolean
  showCorners?: boolean
}

export function CubeFrame({
  size = 1,
  origin = [0, 0, 0],
  // slightly darker than paper --rule so edges stay readable on textured grounds
  edgeColor = '#b0a487',
  tickColor = INK_SOFT,
  cornerColor = BRASS,
  edgeOpacity = 0.85,
  showTicks = true,
  showCorners = true,
}: CubeFrameProps) {
  const half = size / 2
  const edges = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, size)),
    [size],
  )

  // axis ticks along the three bottom edges (x along z=-half, z along x=-half,
  // y up the x=z=-half post) — 0.25 steps like the paper grid
  const tickGeometry = useMemo(() => {
    const pts: number[] = []
    const tick = 0.035 * size
    const steps = [0, 0.25, 0.5, 0.75, 1]
    for (const s of steps) {
      const d = s * size - half
      // x-axis ticks
      pts.push(d, -half, -half, d, -half - tick, -half)
      // z-axis ticks
      pts.push(-half, -half, d, -half, -half - tick, d)
      // y-axis ticks on the near-left post
      pts.push(-half, d, -half, -half - tick, d, -half)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [size, half])

  const cornerPositions = useMemo(
    () =>
      ([-1, 1] as const).flatMap((sx) =>
        ([-1, 1] as const).flatMap((sy) =>
          ([-1, 1] as const).map((sz) => [sx * half, sy * half, sz * half] as [number, number, number]),
        ),
      ),
    [half],
  )

  return (
    <group position={origin}>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={edgeColor} transparent opacity={edgeOpacity} />
      </lineSegments>
      {showTicks && (
        <lineSegments geometry={tickGeometry}>
          <lineBasicMaterial color={tickColor} transparent opacity={0.55} />
        </lineSegments>
      )}
      {showCorners &&
        cornerPositions.map((p, i) => (
          <mesh key={i} position={p}>
            <sphereGeometry args={[0.012 * size, 10, 10]} />
            <meshStandardMaterial color={cornerColor} roughness={0.4} metalness={0.5} />
          </mesh>
        ))}
    </group>
  )
}
