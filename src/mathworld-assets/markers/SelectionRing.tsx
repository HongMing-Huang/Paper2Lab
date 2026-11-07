// Selection ring — highlight for the object the player is hovering or has
// grabbed. 'none' renders nothing; 'hover' is a thin ring, 'selected' is the
// brass player-accent with a slow decorative spin. The spin is presentation
// only; selection authority stays with the game window.
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { BRASS, INK_SOFT } from '../palette'

export type SelectionState = 'none' | 'hover' | 'selected'

export function SelectionRing({
  position = [0, 0, 0],
  radius = 0.12,
  state = 'none',
  /** orientation of the ring plane: horizontal (ground/objects) or facing camera */
  orientation = 'horizontal',
}: {
  position?: [number, number, number]
  radius?: number
  state?: SelectionState
  orientation?: 'horizontal' | 'facing'
}) {
  const ringRef = useRef<THREE.Mesh>(null)
  useFrame(({ camera, clock }) => {
    const r = ringRef.current
    if (!r) return
    if (orientation === 'facing') r.quaternion.copy(camera.quaternion)
    else r.rotation.set(-Math.PI / 2, 0, state === 'selected' ? clock.elapsedTime * 0.6 : 0)
  })

  if (state === 'none') return null
  const selected = state === 'selected'
  return (
    <mesh ref={ringRef} position={position}>
      <torusGeometry args={[radius, radius * (selected ? 0.055 : 0.03), 8, 48]} />
      <meshStandardMaterial
        color={selected ? BRASS : INK_SOFT}
        roughness={selected ? 0.35 : 0.6}
        metalness={selected ? 0.55 : 0.1}
        transparent
        opacity={selected ? 0.95 : 0.5}
        depthWrite={false}
      />
    </mesh>
  )
}
