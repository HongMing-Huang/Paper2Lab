// Needle world scene (CLI-129). Renders ONLY the canonical session state:
// the capsule mesh is derived from {cx, cy, k} every frame, walls/exit from
// the frozen world definition. Animation interpolates ALREADY-ACCEPTED
// transitions (display), never predicts legality; blocked attempts flash the
// computed contact point and ghost pose. Consumes the display-only asset kit
// (LabLights / labMaterial / palette) — no game state enters those parts.
import { useEffect, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Grid, Html, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { LabLights, labMaterial, INK, INK_SOFT, VERMILION } from '../../mathworld-assets'
import { angleOf, type NeedleModel } from '../needle/model'
import type { NeedleSessionState } from '../needle/session'

const BRASS = '#c98a2b'
const PAPER_DEEP = '#f2ecdf'

/** model (x,y) → three (X,Z): centred, +y is "north" (−Z) */
function toThree(m: NeedleModel, x: number, y: number): [number, number] {
  return [x - m.bounds.width / 2, m.bounds.height / 2 - y]
}

const ACTION_KEYS: Record<string, string> = {
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
  ArrowUp: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down',
  q: 'ccw', Q: 'ccw', e: 'cw', E: 'cw',
}

function Capsule({ model, cx, cy, k, ghost = false }: { model: NeedleModel; cx: number; cy: number; k: number; ghost?: boolean }) {
  const θ = angleOf(k)
  const [X, Z] = toThree(model, cx, cy)
  const ry = θ
  const h = model.halfLen
  const r = model.radius
  const mat = ghost
    ? <meshStandardMaterial color={VERMILION} transparent opacity={0.3} depthWrite={false} />
    : <meshStandardMaterial color={ghost ? VERMILION : '#2f5d8a'} roughness={0.32} metalness={0.18} emissive="#2f5d8a" emissiveIntensity={0.14} transparent={ghost} opacity={ghost ? 0.3 : 1} />
  return (
    <group position={[X, r + 0.05, Z]} rotation={[0, ry, 0]}>
      <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[r, r, 2 * h, 20]} />
        {mat}
      </mesh>
      <mesh castShadow position={[h, 0, 0]}>
        <sphereGeometry args={[r, 18, 18]} />
        {mat}
      </mesh>
      <mesh castShadow position={[-h, 0, 0]}>
        <sphereGeometry args={[r, 18, 18]} />
        {mat}
      </mesh>
    </group>
  )
}

function ContactFlash({ model, contact, at }: { model: NeedleModel; contact: { x: number; y: number }; at: number }) {
  const ref = useRef<THREE.Mesh>(null)
  const [X, Z] = toThree(model, contact.x, contact.y)
  useFrame(() => {
    const m = ref.current
    if (!m) return
    const age = (Date.now() - at) / 1400
    if (age > 1) { m.visible = false; return }
    m.visible = true
    m.scale.setScalar(0.8 + age * 1.6)
    const mm = m.material as THREE.MeshStandardMaterial
    mm.opacity = 0.9 * (1 - age)
  })
  return (
    <mesh ref={ref} position={[X, 0.28, Z]}>
      <sphereGeometry args={[0.14, 20, 20]} />
      <meshStandardMaterial color={VERMILION} emissive={VERMILION} emissiveIntensity={0.7} transparent />
    </mesh>
  )
}

function AttemptedGhost({ model, pose, at }: { model: NeedleModel; pose: { cx: number; cy: number; k: number } | null; at: number }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!pose) return
    setShow(true)
    const t = setTimeout(() => setShow(false), 900)
    return () => clearTimeout(t)
  }, [pose, at])
  if (!pose || !show) return null
  return <Capsule model={model} cx={pose.cx} cy={pose.cy} k={pose.k} ghost />
}

/** animates the accepted transition: from previous pose to current over ~170ms */
function AnimatedNeedle({ model, state, revision }: { model: NeedleModel; state: { cx: number; cy: number; k: number }; revision: number }) {
  const group = useRef<THREE.Group>(null)
  const anim = useRef<{ fromCx: number; fromCy: number; fromK: number; toK: number; t0: number } | null>(null)
  const prev = useRef(state)
  useEffect(() => {
    const p = prev.current
    if (p.cx === state.cx && p.cy === state.cy && p.k === state.k) { prev.current = state; return }
    // rotate along the shortest unwrapped direction (π/8 per notch, may cross π)
    let dk = state.k - p.k
    if (dk > 4) dk -= 8
    if (dk < -4) dk += 8
    anim.current = { fromCx: p.cx, fromCy: p.cy, fromK: angleOf(p.k), toK: angleOf(p.k) + (dk * Math.PI) / 8, t0: performance.now() }
    prev.current = state
  }, [state, revision])
  useFrame(() => {
    const g = group.current
    const a = anim.current
    if (!g || !a) return
    const t = Math.min(1, (performance.now() - a.t0) / 170)
    const e = t * t * (3 - 2 * t)
    const cx = a.fromCx + (state.cx - a.fromCx) * e
    const cy = a.fromCy + (state.cy - a.fromCy) * e
    const θ = a.fromK + (a.toK - a.fromK) * e
    const [X, Z] = toThree(model, cx, cy)
    g.position.set(X, model.radius + 0.05, Z)
    g.rotation.y = θ
    if (t >= 1) anim.current = null
  })
  return (
    <group ref={group}>
      <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[model.radius, model.radius, 2 * model.halfLen, 24]} />
        <meshStandardMaterial color="#2f5d8a" roughness={0.3} metalness={0.2} emissive="#2f5d8a" emissiveIntensity={0.15} />
      </mesh>
      <mesh castShadow position={[model.halfLen, 0, 0]}>
        <sphereGeometry args={[model.radius, 20, 20]} />
        <meshStandardMaterial color="#2f5d8a" roughness={0.3} metalness={0.2} />
      </mesh>
      <mesh castShadow position={[-model.halfLen, 0, 0]}>
        <sphereGeometry args={[model.radius, 20, 20]} />
        <meshStandardMaterial color="#2f5d8a" roughness={0.3} metalness={0.2} />
      </mesh>
    </group>
  )
}

function Walls({ model }: { model: NeedleModel }) {
  const W = model.bounds.width
  const H = model.bounds.height
  const wallH = 1.05
  return (
    <group>
      {model.walls.map((w, i) => {
        const cx = (w.x0 + w.x1) / 2
        const cy = (w.y0 + w.y1) / 2
        const [X, Z] = toThree(model, cx, cy)
        return (
          <group key={i}>
            <mesh position={[X, wallH / 2, Z]} castShadow receiveShadow>
              <boxGeometry args={[w.x1 - w.x0, wallH, w.y1 - w.y0]} />
              <meshStandardMaterial {...labMaterial.paperWhite} />
            </mesh>
            <lineSegments position={[X, wallH / 2, Z]}>
              <edgesGeometry args={[new THREE.BoxGeometry(w.x1 - w.x0, wallH, w.y1 - w.y0)]} />
              <lineBasicMaterial color="#b0a487" />
            </lineSegments>
          </group>
        )
      })}
      {/* world boundary rail */}
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(W, wallH, H)]} />
        <lineBasicMaterial color={INK_SOFT} transparent opacity={0.5} />
      </lineSegments>
    </group>
  )
}

function ExitZone({ model, satisfied }: { model: NeedleModel; satisfied: boolean }) {
  const e = model.exit
  const cx = (e.x0 + e.x1) / 2
  const cy = (e.y0 + e.y1) / 2
  const [X, Z] = toThree(model, cx, cy)
  const inner = {
    x0: e.x0 + model.radius, x1: e.x1 - model.radius,
    y0: e.y0 + model.radius, y1: e.y1 - model.radius,
  }
  const [iX0, iZ1] = toThree(model, inner.x0, inner.y0)
  const [iX1, iZ0] = toThree(model, inner.x1, inner.y1)
  const color = satisfied ? '#2f5d8a' : BRASS
  return (
    <group>
      <mesh position={[X, 0.012, Z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[e.x1 - e.x0, e.y1 - e.y0]} />
        <meshStandardMaterial color={color} transparent opacity={0.14} depthWrite={false} />
      </mesh>
      {/* the shrunk region the ENDPOINTS must reach — goal geometry = shown geometry */}
      <lineSegments position={[X, 0.02, Z]}>
        <edgesGeometry args={[new THREE.PlaneGeometry(iX1 - iX0, iZ1 - iZ0)]} />
        <lineBasicMaterial color={color} transparent opacity={0.75} />
      </lineSegments>
      {/* vertical orientation hint: two posts on the vertical axis line */}
      {[-model.halfLen, model.halfLen].map((off) => {
        const [pX, pZ] = toThree(model, cx, cy + off)
        return (
          <mesh key={off} position={[pX, 0.5, pZ]}>
            <cylinderGeometry args={[0.028, 0.028, 1, 10]} />
            <meshStandardMaterial color={color} transparent opacity={0.85} />
          </mesh>
        )
      })}
      <Html position={[X, 1.5, Z - (e.y1 - e.y0) / 2 - 0.3]} center distanceFactor={12} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`mw-tag ${satisfied ? 'mw-tag-pass' : ''}`}><b>出口</b> <span>整杆竖直进入</span></div>
      </Html>
    </group>
  )
}

function StartMark({ model }: { model: NeedleModel }) {
  const [X, Z] = toThree(model, model.start.x, model.start.y)
  return (
    <mesh position={[X, 0.015, Z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.16, 0.2, 32]} />
      <meshBasicMaterial color={INK_SOFT} transparent opacity={0.6} />
    </mesh>
  )
}

export function NeedleScene({ s }: { s: NeedleSessionState }) {
  const m = s.model
  const W = m.bounds.width
  const H = m.bounds.height
  const lastBlocked = s.blocked.at(-1)
  const goalNow = s.phase === 'won'
  return (
    <Canvas
      key={`needle:${s.worldDigest}`}
      shadows
      dpr={[1, 2]}
      camera={{ position: [0.4, Math.max(W, H) * 1.35, Math.max(W, H) * 0.92], fov: 40, near: 0.1, far: 120 }}
      style={{ position: 'absolute', inset: 0 }}
      onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
    >
      <color attach="background" args={['#faf6ee']} />
      <LabLights intensity={0.95} />
      <directionalLight position={[5, 9, 4]} intensity={0.55} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={6} shadow-camera-bottom={-6} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[W + 3, H + 3]} />
        <meshStandardMaterial color={PAPER_DEEP} roughness={0.96} />
      </mesh>
      <Grid args={[W + 3, H + 3]} position={[0, 0.002, 0]} cellSize={m.cell} cellThickness={0.5} cellColor="#d8cfc0" sectionSize={m.cell * 4} sectionThickness={1} sectionColor="#cdbfa6" fadeDistance={30} infiniteGrid={false} />
      <Walls model={m} />
      <ExitZone model={m} satisfied={goalNow} />
      <StartMark model={m} />
      <AnimatedNeedle model={m} state={s.state} revision={s.revision} />
      {lastBlocked?.contact && <ContactFlash model={m} contact={lastBlocked.contact} at={lastBlocked.at} />}
      {lastBlocked?.status === 'blocked' && lastBlocked.attempted && (
        <AttemptedGhost model={m} pose={lastBlocked.attempted} at={lastBlocked.at} />
      )}
      {/* step counter badge floats over the needle */}
      <Html position={[0, 2.4, -H / 2 - 0.2]} center distanceFactor={14} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div className="mw-needle-hud">
          <span>{s.history.length} 步</span>
          <span>预算 {s.budgetLeft}/{m.actionBudget}</span>
          <span className={`mw-needle-phase mw-needle-${s.phase}`}>{s.phase === 'won' ? '已通关' : '进行中'}</span>
        </div>
      </Html>
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI * 0.49} minDistance={4} maxDistance={26} />
    </Canvas>
  )
}

export { ACTION_KEYS, INK, toThree }
