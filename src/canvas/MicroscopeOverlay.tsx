// Microscope Mode — double-click the 3D experiment to immerse; continuous
// zoom from scale 1 → ρ → δ: coarse tubes fade, a finer δ/4 family reveals.
// Esc / close returns to the experiment sheet. Shares the same runtime cells
// (no state copies).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useCell } from '../runtime/react'
import { tubesCell, fineTubesCell, midTubesCell, deltaCell, FINE_DELTA } from '../paper/kakeyaGraph'
import type { Tube3 } from '../kakeya/tubes'

const MAX_TUBES = 512
const Y_AXIS = new THREE.Vector3(0, 1, 0)

function dirHue(x: number, y: number, z: number): number {
  return (Math.atan2(z, x) / (2 * Math.PI) + 0.5 + 0.25 * y) % 1
}

function Meshes({
  tubes,
  opacity,
  hueShift = 0,
}: {
  tubes: Tube3[]
  opacity: number
  hueShift?: number
}) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const color = useMemo(() => new THREE.Color(), [])
  const dir = useMemo(() => new THREE.Vector3(), [])
  useEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const n = Math.min(tubes.length, MAX_TUBES)
    mesh.count = n
    mesh.visible = opacity > 0.02
    for (let i = 0; i < n; i++) {
      const t = tubes[i]
      dir.set(t.dir.x, t.dir.y, t.dir.z).normalize()
      dummy.position.set(t.center.x - 0.5, t.center.y - 0.5, t.center.z - 0.5)
      dummy.quaternion.setFromUnitVectors(Y_AXIS, dir)
      dummy.scale.set(t.radius, 1, t.radius)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, color.setHSL((dirHue(t.dir.x, t.dir.y, t.dir.z) + hueShift) % 1, 0.5, 0.55))
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [tubes, opacity, hueShift, color, dir, dummy])
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, MAX_TUBES]} frustumCulled={false}>
      <cylinderGeometry args={[1, 1, 1, 10, 1]} />
      <meshStandardMaterial transparent opacity={opacity} roughness={0.45} depthWrite={false} />
    </instancedMesh>
  )
}

function MicroscopeScene({ zoom, setZoom }: { zoom: number; setZoom: (z: number) => void }) {
  const tubes = useCell(tubesCell).value ?? []
  const mid = useCell(midTubesCell).value ?? []
  const fine = useCell(fineTubesCell).value ?? []
  const { camera, gl } = useThree()

  // wheel drives the zoom continuum: 0 = scale 1 (coarse δ) → 1 = scale δ/4,
  // passing through the ρ = δ/2 station (objective: 1 → ρ → δ 连续 Zoom)
  useEffect(() => {
    const el = gl.domElement
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setZoom(Math.min(1, Math.max(0, zoom + (e.deltaY < 0 ? 0.06 : -0.06))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [gl, zoom, setZoom])

  useEffect(() => {
    const d = 1.9 - zoom * 1.3 // dolly in as we descend scales
    camera.position.set(
      (1.35 / 1.9) * d,
      (1.1 / 1.9) * d,
      (1.35 / 1.9) * d,
    )
    camera.lookAt(0, 0, 0)
  }, [camera, zoom])

  return (
    <>
      <ambientLight intensity={0.8} />
      <directionalLight position={[3, 5, 4]} intensity={1.1} />
      {/* staggered opacity windows: coarse fades out, ρ peaks mid-way, fine unfolds */}
      <Meshes tubes={tubes} opacity={0.85 * (1 - zoom) + 0.1} />
      <Meshes tubes={mid} opacity={0.9 * Math.max(0, 1 - Math.abs(2 * zoom - 1))} hueShift={0.25} />
      <Meshes tubes={fine} opacity={0.9 * zoom} hueShift={0.5} />
    </>
  )
}

export function MicroscopeOverlay({ onClose }: { onClose: () => void }) {
  const [zoom, setZoom] = useState(0)
  const delta = useCell(deltaCell)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const scaleLabel =
    zoom < 0.33
      ? `尺度 1（粗管 δ=${(delta.value ?? 0).toFixed(4)}）`
      : zoom < 0.67
        ? `尺度 ρ（中管 δ/2=${((delta.value ?? 0) / 2).toFixed(4)}）`
        : `尺度 δ/4（细管 δ=${FINE_DELTA.toFixed(4)}）`

  return (
    <div className="microscope-overlay">
      <div className="microscope-head nodrag">
        <span className="microscope-title">🔍 Microscope — {scaleLabel}</span>
        <span className="microscope-zoom">
          zoom {(zoom * 100).toFixed(0)}% · δ={delta.value?.toFixed(4)}
        </span>
        <button type="button" onClick={onClose}>
          ✕ 退出（Esc）
        </button>
      </div>
      <div className="microscope-canvas nowheel">
        <Canvas dpr={[1, 2]} camera={{ position: [1.35, 1.1, 1.35], fov: 38 }} eventPrefix="client">
          <MicroscopeScene zoom={zoom} setZoom={setZoom} />
        </Canvas>
      </div>
      <div className="microscope-foot nodrag">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(parseFloat(e.target.value))}
          aria-label="尺度 zoom"
        />
        <span className="microscope-scale-label">1 ─────── ρ=δ/2 ─────── δ/4</span>
      </div>
    </div>
  )
}
