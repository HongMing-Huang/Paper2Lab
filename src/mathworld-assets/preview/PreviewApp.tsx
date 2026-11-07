// Load-verification composition for the mathworld asset kit — NOT a product
// demo and not part of the game surface. It mounts every display component
// with sample presentation props in one R3F scene so integration and browser
// loading can be verified end to end. Sample geometry is generated locally
// (no imports from game modules); states are hard-coded display values.
import { Suspense, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import {
  CubeFrame,
  InkPath,
  LabEnvironment,
  LabGround,
  LabLights,
  SelectionRing,
  StatusChip,
  StatusGlow,
  TargetZone,
  injectMathworldAssetStyles,
} from '../index'
import { PAPER, PAPER_BLUE } from '../palette'

// ---- local sample data (display only, mirrors the tubes convention [-0.5, 0.5]³)
interface SampleTube {
  center: { x: number; y: number; z: number }
  dir: { x: number; y: number; z: number }
  radius: number
}

function sampleTubes(n: number, packing: number): SampleTube[] {
  // golden-angle directions on the sphere + sticky-cluster interpolation,
  // shaped like the challenge's per-cluster offsets (display-only stand-in)
  const golden = Math.PI * (3 - Math.sqrt(5))
  const out: SampleTube[] = []
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n
    const r = Math.sqrt(1 - y * y)
    const theta = golden * i
    const dir = { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r }
    const scatter = { x: (i % 5) / 5 - 0.5, y: ((i * 3) % 5) / 5 - 0.5, z: ((i * 7) % 5) / 5 - 0.5 }
    const sticky = { x: 0.12 * dir.x, y: 0.12 * dir.y, z: 0.12 * dir.z }
    const center = {
      x: scatter.x + (sticky.x - scatter.x) * packing,
      y: scatter.y + (sticky.y - scatter.y) * packing,
      z: scatter.z + (sticky.z - scatter.z) * packing,
    }
    out.push({ center, dir, radius: 0.03 })
  }
  return out
}

const TUBES = sampleTubes(48, 0.4)

/** sample kept-attempt trajectory: a parabolic arc on the bench pad in
 * front of the cube (display-only stand-in for projectile results) */
const SAMPLE_TRAJECTORY = Array.from({ length: 41 }, (_, i) => {
  const t = i / 40
  return {
    x: -0.8 + t * 1.45,
    y: -0.6 + 0.62 * (4 * t * (1 - t)) + 0.004,
    z: 0.68,
  }
})

/** instanced cylinders + per-direction hue, the same presentation convention
 * TubesScene uses — reimplemented locally so the library stays decoupled */
function SampleTubes() {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const dir = useMemo(() => new THREE.Vector3(), [])
  const color = useMemo(() => new THREE.Color(), [])

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    TUBES.forEach((t, i) => {
      dir.set(t.dir.x, t.dir.y, t.dir.z).normalize()
      dummy.position.set(t.center.x, t.center.y, t.center.z)
      dummy.quaternion.setFromUnitVectors(up, dir)
      dummy.scale.set(t.radius, 1, t.radius)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      const hue = (Math.atan2(t.dir.z, t.dir.x) / (2 * Math.PI) + 0.5 + 0.25 * t.dir.y) % 1
      mesh.setColorAt(i, color.setHSL(hue, 0.5, 0.52))
    })
    mesh.count = TUBES.length
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [dummy, up, dir, color])

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, TUBES.length]} frustumCulled={false}>
      <cylinderGeometry args={[1, 1, 1, 10, 1]} />
      <meshStandardMaterial color={PAPER_BLUE} transparent opacity={0.6} roughness={0.45} metalness={0.05} />
    </instancedMesh>
  )
}

export function PreviewApp() {
  injectMathworldAssetStyles()
  return (
    <div style={{ position: 'fixed', inset: 0, background: PAPER }}>
      <Canvas dpr={[1, 2]} camera={{ position: [1.9, 1.45, 1.9], fov: 35 }} gl={{ alpha: true }}>
        <LabLights />
        <Suspense fallback={null}>
          <LabEnvironment />
          <LabGround
            textureUrl="/assets/mathworld-library/textures/plywood_diff_1k.jpg"
            textureOpacity={0.5}
            size={1.9}
          />
        </Suspense>
        <CubeFrame />
        <SampleTubes />
        {/* projectile corner: ground arc + landing target + hit state */}
        <InkPath points={SAMPLE_TRAJECTORY} state="ok" />
        <InkPath
          points={SAMPLE_TRAJECTORY.map((p) => ({ ...p, y: p.y * 0.7 + 0.02 }))}
          state="fail"
          faded
        />
        <TargetZone position={[0.62, -0.6, 0.68]} radius={0.06} state="ok" />
        <TargetZone position={[0.55, -0.6, -0.42]} radius={0.06} state="idle" />
        <TargetZone position={[0.28, -0.5, 0.12]} state="active" />
        <SelectionRing position={[0, 0.15, 0]} radius={0.14} state="selected" />
        <StatusGlow position={[0.28, -0.3, 0.12]} radius={0.028} state="computing" />
        <StatusGlow position={[-0.42, 0.02, 0.32]} radius={0.028} state="ok" />
        <StatusGlow position={[0.1, 0.45, 0.2]} radius={0.028} state="fail" />
      </Canvas>
      <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 8 }}>
        <StatusChip state="idle" />
        <StatusChip state="computing" />
        <StatusChip state="ok" />
        <StatusChip state="fail" />
      </div>
      <div
        className="p2l-asset-error-note"
        style={{ position: 'absolute', bottom: 14, left: 12, maxWidth: 340 }}
      >
        mathworld-assets 预加载验证页 — 组件全部以静态示例状态挂载；非产品界面。
      </div>
    </div>
  )
}
