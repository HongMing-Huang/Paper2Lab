// Status glow — a small billboarded indicator floating above a game object.
// State is a display prop from the game window ('idle' | 'computing' | 'ok' |
// 'fail'); the glow never computes or asserts anything. 'computing' pulses
// (work in progress), 'ok' shows a steady blue-ink bead, 'fail' a vermilion
// one — matching the PAPER/CALCULATED/AI_INFERENCE badge language.
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard } from '@react-three/drei'
import * as THREE from 'three'
import { INK_SOFT, INK_BLUE, VERMILION, type MathworldStatus } from '../palette'

const STATE_COLOR: Record<MathworldStatus, string> = {
  idle: INK_SOFT,
  computing: INK_SOFT,
  ok: INK_BLUE,
  fail: VERMILION,
}

export function StatusGlow({
  position = [0, 0.32, 0],
  radius = 0.045,
  state = 'idle',
}: {
  position?: [number, number, number]
  radius?: number
  state?: MathworldStatus
}) {
  const haloRef = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    const h = haloRef.current
    if (!h) return
    if (state === 'computing') {
      const t = (Math.sin(clock.elapsedTime * 3.2) + 1) / 2 // 0..1
      h.scale.setScalar(1 + 0.35 * t)
      ;(h.material as THREE.MeshStandardMaterial).opacity = 0.16 + 0.22 * t
    } else if (state === 'ok') {
      const t = (clock.elapsedTime * 0.8) % 1
      h.scale.setScalar(1 + 0.9 * t)
      ;(h.material as THREE.MeshStandardMaterial).opacity = 0.3 * (1 - t)
    } else {
      h.scale.setScalar(1)
      ;(h.material as THREE.MeshStandardMaterial).opacity = 0.18
    }
  })

  const color = STATE_COLOR[state]
  return (
    <Billboard position={position}>
      {/* soft halo */}
      <mesh ref={haloRef}>
        <sphereGeometry args={[radius * 2.2, 16, 16]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.18}
          roughness={0.9}
          depthWrite={false}
        />
      </mesh>
      {/* core bead */}
      <mesh>
        <sphereGeometry args={[radius, 14, 14]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={state === 'idle' ? 0.05 : 0.5}
          roughness={0.3}
          metalness={0.1}
        />
      </mesh>
    </Billboard>
  )
}
