// 3D δ-tubes view — React Three Fiber + raw instancedMesh (research-verified
// pattern: dummy Object3D matrices, quaternion Y→dir, dynamic count).
// Pure props component; reactive wiring lives in the canvas node.
import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Tube3 } from '../../kakeya/tubes'
import type { VoxelResult } from '../../kakeya/voxels3d'
import { useRuntime } from '../../runtime/react'

const MAX_TUBES = 512
const MAX_VOXELS = 32 ** 3

const Y_AXIS = new THREE.Vector3(0, 1, 0)

/** hue from a direction — stable colour per tube across parameter changes */
function dirHue(x: number, y: number, z: number): number {
  return (Math.atan2(z, x) / (2 * Math.PI) + 0.5 + 0.25 * y) % 1
}

const BLUE_INK = new THREE.Color('#2f5d8a')
const VERMILION = new THREE.Color('#9a3b2e')
const PAPER_BLUE = new THREE.Color('#dfe8ef')

function multiplicityColor(m: number, maxM: number, out: THREE.Color): THREE.Color {
  // ink-paper ramp: paper → blue ink → vermilion for the hottest cells
  const t = Math.log2(1 + m) / Math.log2(1 + Math.max(1, maxM)) // 0..1
  if (t < 0.5) out.copy(PAPER_BLUE).lerp(BLUE_INK, t * 2)
  else out.copy(BLUE_INK).lerp(VERMILION, (t - 0.5) * 2)
  return out
}

function TubesScene({
  tubes,
  visGrid,
  visMaxM,
  showVoxels,
  spin,
}: {
  tubes: Tube3[]
  visGrid?: VoxelResult['visGrid']
  visMaxM?: number
  showVoxels: boolean
  spin: number
}) {
  const tubeRef = useRef<THREE.InstancedMesh>(null)
  const voxRef = useRef<THREE.InstancedMesh>(null)
  const groupRef = useRef<THREE.Group>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const dir = useMemo(() => new THREE.Vector3(), [])
  const color = useMemo(() => new THREE.Color(), [])
  const cubeEdges = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
    [],
  )

  useEffect(() => {
    const mesh = tubeRef.current
    if (!mesh) return
    const n = Math.min(tubes.length, MAX_TUBES)
    mesh.count = n
    for (let i = 0; i < n; i++) {
      const t = tubes[i]
      dir.set(t.dir.x, t.dir.y, t.dir.z).normalize()
      dummy.position.set(t.center.x - 0.5, t.center.y - 0.5, t.center.z - 0.5)
      dummy.quaternion.setFromUnitVectors(Y_AXIS, dir)
      dummy.scale.set(t.radius, 1, t.radius) // capsule visualised as cylinder
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, color.setHSL(dirHue(t.dir.x, t.dir.y, t.dir.z), 0.5, 0.52))
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [tubes, color, dir, dummy])

  useEffect(() => {
    const mesh = voxRef.current
    if (!mesh || !visGrid) return
    const r = visGrid.res
    const cell = 1 / r
    let count = 0
    for (let i = 0; i < r && count < MAX_VOXELS; i++) {
      for (let j = 0; j < r && count < MAX_VOXELS; j++) {
        for (let k = 0; k < r && count < MAX_VOXELS; k++) {
          const m = visGrid.data[(i * r + j) * r + k]
          if (m === 0) continue
          dummy.position.set(i * cell - 0.5 + cell / 2, j * cell - 0.5 + cell / 2, k * cell - 0.5 + cell / 2)
          dummy.quaternion.identity()
          dummy.scale.setScalar(cell)
          dummy.updateMatrix()
          mesh.setMatrixAt(count, dummy.matrix)
          mesh.setColorAt(count, multiplicityColor(m, Math.max(4, visMaxM ?? 4), color))
          count++
        }
      }
    }
    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [visGrid, visMaxM, color, dir, dummy])

  useFrame((_, delta) => {
    if (groupRef.current && spin !== 0) groupRef.current.rotation.y += delta * spin
  })

  return (
    <group ref={groupRef}>
      {/* unit cube reference frame */}
      <lineSegments geometry={cubeEdges}>
        <lineBasicMaterial color="#b9ad97" transparent opacity={0.7} />
      </lineSegments>
      <instancedMesh
        ref={tubeRef}
        args={[undefined, undefined, MAX_TUBES]}
        frustumCulled={false}
        visible={!showVoxels}
      >
        <cylinderGeometry args={[1, 1, 1, 10, 1]} />
        <meshStandardMaterial transparent opacity={0.6} roughness={0.45} metalness={0.05} />
      </instancedMesh>
      <instancedMesh
        ref={voxRef}
        args={[undefined, undefined, MAX_VOXELS]}
        frustumCulled={false}
        visible={showVoxels}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial transparent opacity={0.85} roughness={0.6} />
      </instancedMesh>
    </group>
  )
}

/**
 * Embeddable 3D scene of δ-tubes inside the unit cube.
 * `packingDrag` lets the user grab the tube family and drag vertically —
 * reverse-syncing the packing parameter through the runtime (UI⇄model).
 */
export function Tubes3DView({
  tubes,
  visGrid,
  visMaxM,
  showVoxels = false,
  spin = 0.25,
  height = 320,
  packingDrag = false,
  preserveDrawingBuffer = false,
}: {
  tubes: Tube3[]
  visGrid?: VoxelResult['visGrid']
  visMaxM?: number
  showVoxels?: boolean
  spin?: number
  height?: number
  packingDrag?: boolean
  /** test routes only: lets readPixels/toDataURL see a rendered frame */
  preserveDrawingBuffer?: boolean
}) {
  const rt = useRuntime()
  const dragState = useRef<{ y: number; packing: number } | null>(null)
  return (
    <div
      className={`tubes3d nodrag nowheel${packingDrag ? ' grabbable' : ''}`}
      style={{ height }}
      title={packingDrag ? '在管上上下拖动 = 改变 packing；双击（实验纸）= Microscope' : undefined}
      onPointerDown={(e) => {
        e.stopPropagation()
        if (!packingDrag) return
        const p = (rt.get('kakeya.packing').value as number) ?? 0
        dragState.current = { y: e.clientY, packing: p }
        try {
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        } catch {
          // synthetic events have no active pointer; bubbling still delivers moves
        }
      }}
      onPointerMove={(e) => {
        const s = dragState.current
        if (!s) return
        const dy = e.clientY - s.y // drag up ⇒ pack
        const v = Math.min(1, Math.max(0, s.packing - dy / 140))
        rt.setParam('kakeya.packing', Math.round(v * 20) / 20)
      }}
      onPointerUp={() => {
        dragState.current = null
      }}
      onPointerCancel={() => {
        dragState.current = null
      }}
    >
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [1.55, 1.25, 1.55], fov: 38 }}
        eventPrefix="client"
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer }}
      >
        <ambientLight intensity={0.75} />
        <directionalLight position={[3, 5, 4]} intensity={1.1} />
        <directionalLight position={[-4, -2, -3]} intensity={0.35} />
        <TubesScene
          tubes={tubes}
          visGrid={visGrid}
          visMaxM={visMaxM}
          showVoxels={showVoxels}
          spin={spin}
        />
      </Canvas>
    </div>
  )
}
