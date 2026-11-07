// Target zone marker — where the player must land/place/aim. State is passed
// in by the game window ('idle' | 'active' | 'ok' | 'fail'); this component
// never evaluates correctness. The pulse/flash are decorative emphasises, not
// simulation output: they respond only to the state prop.
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { INK_BLUE, RULE, VERMILION } from '../palette'

/** target-zone states: 'active' = the challenge the player is on right now */
export type TargetState = 'idle' | 'active' | 'ok' | 'fail'

const STATE_COLOR: Record<TargetState, string> = {
  idle: RULE,
  active: INK_BLUE,
  ok: INK_BLUE,
  fail: VERMILION,
}

export function TargetZone({
  position = [0, 0, 0],
  radius = 0.09,
  state = 'idle',
  /** flat disc fill opacity (0 keeps it ring-only) */
  fillOpacity = 0.16,
}: {
  position?: [number, number, number]
  radius?: number
  state?: TargetState
  fillOpacity?: number
}) {
  const groupRef = useRef<THREE.Group>(null)
  const ringRef = useRef<THREE.Mesh>(null)
  const color = STATE_COLOR[state]

  useFrame(({ clock }) => {
    const g = groupRef.current
    if (!g) return
    if (state === 'active') {
      // gentle breathing so the active target reads at a glance
      const s = 1 + 0.05 * Math.sin(clock.elapsedTime * 2.4)
      g.scale.setScalar(s)
    } else {
      g.scale.setScalar(1)
    }
    // success flash: one quick outward ripple
    const r = ringRef.current
    if (r) {
      if (state === 'ok') {
        const t = (clock.elapsedTime * 0.9) % 1
        r.scale.setScalar(1 + 0.5 * t)
        const m = r.material as THREE.MeshStandardMaterial
        m.opacity = 0.85 * (1 - t)
      } else {
        r.scale.setScalar(1)
        const m = r.material as THREE.MeshStandardMaterial
        m.opacity = 0.9
      }
    }
  })

  return (
    <group position={position} ref={groupRef}>
      {/* flat fill disc, slightly above the surface it sits on */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius, 40]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={fillOpacity}
          roughness={0.8}
          depthWrite={false}
        />
      </mesh>
      {/* main ring */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius, radius * 0.09, 10, 48]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.15} transparent />
      </mesh>
      {/* centre pin dot */}
      <mesh position={[0, radius * 0.02, 0]}>
        <sphereGeometry args={[radius * 0.12, 10, 10]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.2} />
      </mesh>
    </group>
  )
}
