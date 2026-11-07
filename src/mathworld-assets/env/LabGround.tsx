// Lab ground & spatial reference — warm wood bench texture (Poly Haven CC0,
// see public/assets/mathworld-library/MANIFEST.md) plus a faint ink grid so
// players can read depth around the math objects. Everything is presentation:
// the ground never contains collision or model state; pass y/size explicitly.
// mode 'pad' (default) = a bounded bench slab under the subject, reading as a
// desk on paper; mode 'plane' = a large floor for walk-around game spaces.
import { Suspense } from 'react'
import * as THREE from 'three'
import { ContactShadows, Grid, useTexture } from '@react-three/drei'
import { RULE } from '../palette'

export const GROUND_TEXTURE_URL = '/assets/mathworld-library/textures/plywood_diff_1k.jpg'

/** textured bench surface. Suspends while the texture loads — wrap in
 * Suspense or keep textureUrl undefined for the flat paper fallback. */
function BenchSurface({
  width,
  depth,
  thickness,
  y,
  textureUrl,
  textureOpacity,
  repeat,
}: {
  width: number
  depth: number
  thickness: number
  y: number
  textureUrl: string
  textureOpacity: number
  repeat: number
}) {
  const map = useTexture(textureUrl)
  map.wrapS = map.wrapT = THREE.RepeatWrapping
  map.colorSpace = THREE.SRGBColorSpace // JPG is sRGB; without this it renders washed out
  map.repeat.set(repeat, repeat)
  return (
    <mesh position={[0, y - thickness / 2, 0]} receiveShadow>
      <boxGeometry args={[width, thickness, depth]} />
      <meshStandardMaterial
        map={map}
        transparent
        opacity={textureOpacity}
        roughness={0.85}
        metalness={0.02}
      />
    </mesh>
  )
}

export function LabGround({
  y = -0.62,
  mode = 'pad',
  /** pad mode: slab footprint (square); plane mode: floor size */
  size = 2.6,
  textureUrl,
  textureOpacity = 0.55,
  textureRepeat = 2,
  showGrid = true,
  showShadow = true,
  shadowSubjectHeight = 1.1,
}: {
  /** ground top surface height — default sits just below the unit cube at [-0.5, 0.5]³ */
  y?: number
  mode?: 'pad' | 'plane'
  size?: number
  textureUrl?: string
  textureOpacity?: number
  textureRepeat?: number
  showGrid?: boolean
  showShadow?: boolean
  /** how far above the plane shadows are cast from (≈ subject height) */
  shadowSubjectHeight?: number
}) {
  const isPad = mode === 'pad'
  return (
    <group>
      {textureUrl ? (
        <Suspense fallback={null}>
          <BenchSurface
            width={isPad ? size : size * 4}
            depth={isPad ? size : size * 4}
            thickness={isPad ? 0.05 : 0.02}
            y={y}
            textureUrl={textureUrl}
            textureOpacity={textureOpacity}
            repeat={isPad ? textureRepeat : textureRepeat * 4}
          />
        </Suspense>
      ) : (
        // flat paper-deep fallback: same silhouette, zero loading
        <mesh position={[0, y - (isPad ? 0.025 : 0.01), 0]}>
          <boxGeometry
            args={[
              isPad ? size : size * 4,
              isPad ? 0.05 : 0.02,
              isPad ? size : size * 4,
            ]}
          />
          <meshStandardMaterial color="#efe9db" roughness={0.92} metalness={0} />
        </mesh>
      )}
      {showGrid && (
        <Grid
          position={[0, y + 0.002, 0]}
          args={[isPad ? size : size * 4, isPad ? size : size * 4]}
          cellSize={0.25}
          cellThickness={0.6}
          cellColor={RULE}
          sectionSize={1}
          sectionThickness={1}
          sectionColor={RULE}
          fadeDistance={isPad ? 8 : 18}
          fadeStrength={1.4}
          infiniteGrid={false}
        />
      )}
      {showShadow && (
        <ContactShadows
          position={[0, y + 0.004, 0]}
          opacity={0.32}
          scale={6}
          blur={2.4}
          far={shadowSubjectHeight}
          resolution={512}
          color="#3a3126"
        />
      )}
    </group>
  )
}
