// The ONE MathWorld scene (CLI-129). It renders any valid WorldDefinition:
// formula curves and ODE trajectories become the same kind of 3D object,
// constraints become gates / zones / planes, and handles write intents to the
// Host. The scene never computes a formal number: geometry comes from the
// committed ExperimentRuns (by runId) or from the Host's preview, which is
// marked as preview everywhere it shows.
import { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Grid, Html, Line, OrbitControls, useCursor } from '@react-three/drei'
import * as THREE from 'three'
import { getExperimentRun } from '../../experiments/protocol'
import type { ConstraintCheck, WorldDefinition } from '../definition'
import { host, type Session } from '../host'
import { fmt } from '../goal'
import { curvePoints, makeMapper, trajectoryPoints, type Mapper } from './mapping'
import { OdeTimeControls, OdeTimeMarker, type PlayerState } from './OdeTimePlayer'
import { kakeyaTubes } from '../kernels'
// CLI-148 display-only asset kit (no state, no math — props in, visuals out)
import { CubeFrame } from '../../mathworld-assets/env/CubeFrame'
import { LabGround } from '../../mathworld-assets/env/LabGround'
import { SelectionRing } from '../../mathworld-assets/markers/SelectionRing'
import { StatusGlow } from '../../mathworld-assets/status/StatusGlow'

const INK = '#2b2620'
const INK_SOFT = '#6b6154'
const BLUE = '#2f5d8a'
const VERMILION = '#9a3b2e'
const AMBER = '#b0782a'
const BRASS = '#c98a2b'
const PAPER = '#faf6ee'
const RULE = '#d9d0bf'

const STATUS_COLOR: Record<string, string> = { pass: BLUE, fail: VERMILION, unknown: AMBER, none: INK_SOFT }

// ---- reading committed geometry from Runs (by reference) --------------------

function committedCurve(s: Session): Array<[number, number]> | null {
  const ev = s.committed?.evidence
  if (!ev || ev.kind !== 'formula') return null
  const run = getExperimentRun(ev.curveRunId)
  return (run?.result as { points?: Array<[number, number]> } | undefined)?.points ?? null
}

function trajectoryOfRun(world: WorldDefinition, runId: string | undefined): { t: number[]; series: number[][] } | null {
  if (!runId || world.model.kind !== 'ode') return null
  const run = getExperimentRun(runId)
  const r = run?.result as { t?: number[]; series?: Array<{ state: string; values: number[] }> } | undefined
  if (!r?.t || !r.series) return null
  const series = world.model.states.map((st) => r.series!.find((x) => x.state === st.name)?.values ?? [])
  return { t: r.t, series }
}

function committedTrajectory(s: Session) {
  const ev = s.committed?.evidence
  if (!ev || ev.kind !== 'ode') return null
  return trajectoryOfRun(s.world, ev.solveRunId)
}

function checkFor(s: Session, id: string): ConstraintCheck | undefined {
  return s.committed?.assessment.checks.find((c) => c.constraintId === id)
}

// ---- the 3D math object --------------------------------------------------------

function Tube({ points, color, radius = 0.06, opacity = 1 }: { points: THREE.Vector3[]; color: string; radius?: number; opacity?: number }) {
  const geometry = useMemo(() => {
    if (points.length < 2) return null
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal')
    return new THREE.TubeGeometry(curve, Math.min(900, points.length * 2), radius, 10, false)
  }, [points, radius])
  if (!geometry) return null
  return (
    <mesh geometry={geometry} castShadow>
      <meshStandardMaterial color={color} roughness={0.35} metalness={0.1} transparent={opacity < 1} opacity={opacity} emissive={color} emissiveIntensity={0.18} />
    </mesh>
  )
}

/** a marble that keeps travelling along the committed object: the world
 *  stays alive between actions without inventing any number */
function Probe({ points, period = 5.5, color = BRASS }: { points: THREE.Vector3[]; period?: number; color?: string }) {
  const ref = useRef<THREE.Mesh>(null)
  const lengths = useMemo(() => {
    const acc = [0]
    for (let i = 1; i < points.length; i++) acc.push(acc[i - 1] + points[i].distanceTo(points[i - 1]))
    return acc
  }, [points])
  useFrame(({ clock }) => {
    const m = ref.current
    if (!m || points.length < 2) return
    const total = lengths[lengths.length - 1] || 1
    const s = ((clock.elapsedTime % period) / period) * total
    let i = 1
    while (i < lengths.length - 1 && lengths[i] < s) i++
    const seg = lengths[i] - lengths[i - 1] || 1
    const f = (s - lengths[i - 1]) / seg
    m.position.lerpVectors(points[i - 1], points[i], Math.min(1, Math.max(0, f)))
  })
  if (points.length < 2) return null
  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.13, 24, 24]} />
      <meshStandardMaterial color={color} roughness={0.25} metalness={0.6} emissive={color} emissiveIntensity={0.25} />
    </mesh>
  )
}

// ---- formula-world constraints ------------------------------------------------

function previewYAt(curve: Array<[number, number]> | undefined, x: number): number | null {
  if (!curve || curve.length < 2) return null
  for (let i = 1; i < curve.length; i++) {
    const [x0, y0] = curve[i - 1]
    const [x1, y1] = curve[i]
    if (x >= x0 && x <= x1) return y0 + ((x - x0) / (x1 - x0 || 1)) * (y1 - y0)
  }
  return null
}

function Gate({ s, mapper, k, previewCurve }: {
  s: Session; mapper: Mapper
  k: { id: string; label?: string; x: number; min: number; max: number }
  previewCurve?: Array<[number, number]>
}) {
  const check = checkFor(s, k.id)
  const color = STATUS_COLOR[check?.status ?? 'none']
  const X = mapper.x.toWorld(k.x)
  const yLo = mapper.y.toWorld(k.min)
  const yHi = mapper.y.toWorld(k.max)
  const top = mapper.y.length
  const depth = 1.3
  const w = 0.22
  const py = previewYAt(previewCurve, k.x)
  // keep the overhead tag inside the model's vertical window: above the
  // gate's own geometry but never past the y-axis top (edge clipping fix)
  const tagY = Math.min(top + 0.1, Math.max(yHi + 0.35, yLo + 0.35))
  return (
    <group position={[X, 0, 0]}>
      {yLo > 0.001 && (
        <mesh position={[0, yLo / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[w, yLo, depth]} />
          <meshStandardMaterial color={PAPER} roughness={0.85} />
        </mesh>
      )}
      {top - yHi > 0.001 && (
        <mesh position={[0, (yHi + top) / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[w, top - yHi, depth]} />
          <meshStandardMaterial color={PAPER} roughness={0.85} />
        </mesh>
      )}
      {/* the opening's frame — the colour carries the formal verdict */}
      <Line points={[[0, yLo, -depth / 2], [0, yLo, depth / 2], [0, yHi, depth / 2], [0, yHi, -depth / 2], [0, yLo, -depth / 2]]} color={color} lineWidth={check ? 3.2 : 1.6} />
      <Html position={[0, tagY, 0]} center distanceFactor={11} zIndexRange={[20, 0]}>
        <div className={`mw-tag mw-tag-${check?.status ?? 'none'}`}>
          <b>{k.label ?? k.id}</b> <span>{fmt(k.min)}…{fmt(k.max)}</span>
          {check && <div className="mw-tag-measure">{check.measured}</div>}
          {py !== null && <div className="mw-tag-preview">预览 ≈ {fmt(py)} · 不计分</div>}
        </div>
      </Html>
    </group>
  )
}

function AvoidBox({ s, mapper, k }: { s: Session; mapper: Mapper; k: { id: string; label?: string; xMin: number; xMax: number; yMin: number; yMax: number } }) {
  const check = checkFor(s, k.id)
  const x0 = mapper.x.toWorld(k.xMin)
  const x1 = mapper.x.toWorld(k.xMax)
  const y0 = Math.max(0, mapper.y.toWorld(k.yMin))
  const y1 = Math.min(mapper.y.length, mapper.y.toWorld(k.yMax))
  const color = check?.status === 'fail' ? VERMILION : check?.status === 'unknown' ? AMBER : '#b65a48'
  return (
    <group position={[(x0 + x1) / 2, (y0 + y1) / 2, 0]}>
      <mesh>
        <boxGeometry args={[x1 - x0, y1 - y0, 1.1]} />
        <meshStandardMaterial color={color} transparent opacity={check?.status === 'fail' ? 0.45 : 0.26} roughness={0.6} depthWrite={false} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(x1 - x0, y1 - y0, 1.1)]} />
        <lineBasicMaterial color={VERMILION} />
      </lineSegments>
      <Html position={[0, (y1 - y0) / 2 + 0.3, 0]} center distanceFactor={11} zIndexRange={[20, 0]}>
        <div className={`mw-tag mw-tag-${check?.status ?? 'none'}`}><b>{k.label ?? k.id}</b> 禁区{check && <div className="mw-tag-measure">{check.measured}</div>}</div>
      </Html>
    </group>
  )
}

// ---- ode-world constraints ------------------------------------------------------

function axisFor(mapper: Mapper, state: string): 'x' | 'y' | 'z' | null {
  if (mapper.x.source === state) return 'x'
  if (mapper.y.source === state) return 'y'
  if (mapper.z?.source === state) return 'z'
  return null
}

/** an axis-aligned translucent slab between two model values of `state` */
function StateSlab({ mapper, state, lo, hi, color, opacity, label, check }: {
  mapper: Mapper; state: string; lo: number; hi: number; color: string; opacity: number; label: string; check?: ConstraintCheck
}) {
  const ax = axisFor(mapper, state)
  if (!ax) return null
  const info = ax === 'x' ? mapper.x : ax === 'y' ? mapper.y : mapper.z!
  const a = info.toWorld(Math.max(info.min, lo))
  const b = info.toWorld(Math.min(info.max, hi))
  const thick = Math.max(0.02, b - a)
  const mid = (a + b) / 2
  const S = mapper.size
  const size: [number, number, number] = ax === 'x' ? [thick, S.y, S.z] : ax === 'y' ? [S.x, thick, S.z] : [S.x, S.y, thick]
  const pos: [number, number, number] = ax === 'x' ? [mid, S.y / 2, 0] : ax === 'y' ? [0, mid, 0] : [0, S.y / 2, mid]
  const tagPos: [number, number, number] = ax === 'y' ? [S.x / 2 + 0.2, mid, -S.z / 2] : ax === 'x' ? [mid, S.y + 0.3, -S.z / 2] : [S.x / 2, S.y + 0.3, mid]
  return (
    <group>
      <mesh position={pos}>
        <boxGeometry args={size} />
        <meshStandardMaterial color={color} transparent opacity={opacity} depthWrite={false} roughness={0.7} side={THREE.DoubleSide} />
      </mesh>
      <Html position={tagPos} center distanceFactor={11} zIndexRange={[20, 0]}>
        <div className={`mw-tag mw-tag-${check?.status ?? 'none'}`}><b>{label}</b>{check && <div className="mw-tag-measure">{check.measured}</div>}</div>
      </Html>
    </group>
  )
}

function OdeConstraints({ s, mapper }: { s: Session; mapper: Mapper }) {
  return (
    <group>
      {s.world.goal.constraints.map((k) => {
        const check = checkFor(s, k.id)
        const status = check?.status ?? 'none'
        if (k.kind === 'series-max') {
          const ax = axisFor(mapper, k.state)
          const info = ax === 'x' ? mapper.x : ax === 'y' ? mapper.y : ax === 'z' ? mapper.z : null
          if (!info) return null
          // forbidden region above the ceiling
          return <StateSlab key={k.id} mapper={mapper} state={k.state} lo={k.max} hi={info.max} color={status === 'fail' ? VERMILION : '#c87d6e'} opacity={status === 'fail' ? 0.22 : 0.12} label={`${k.label ?? k.id}：${k.state} ≤ ${fmt(k.max)}`} check={check} />
        }
        if (k.kind === 'final-range') {
          const ax = axisFor(mapper, k.state)
          const info = ax === 'x' ? mapper.x : ax === 'y' ? mapper.y : ax === 'z' ? mapper.z : null
          if (!info) return null
          const lo = k.min ?? info.min
          const hi = k.max ?? info.max
          const req = [k.min !== undefined ? `${fmt(k.min)} ≤` : '', `${k.state}(终)`, k.max !== undefined ? `≤ ${fmt(k.max)}` : ''].filter(Boolean).join(' ')
          return <StateSlab key={k.id} mapper={mapper} state={k.state} lo={lo} hi={hi} color={status === 'fail' ? VERMILION : BLUE} opacity={0.08} label={`${k.label ?? k.id}：${req}`} check={check} />
        }
        if (k.kind === 'reach-ball') {
          const c = mapper.point(k.center)
          // CLI-129 椭球修复：reach-ball 的模型距离是各状态坐标的欧氏范数，
          // 但各轴的“模型单位 → 世界单位”比例不同时，等距面在场景里是椭球
          // 而不是球。按每轴各自换算半径，显示的几何才与模型距离一致。
          const unit = (a: 'x' | 'y' | 'z') => {
            const info = a === 'x' ? mapper.x : a === 'y' ? mapper.y : mapper.z
            return info ? info.length / (info.max - info.min) : 0
          }
          const sx = k.radius * unit('x')
          const sy = k.radius * unit('y')
          const sz = (mapper.z ? k.radius * unit('z') : Math.min(sx, sy)) || Math.min(sx, sy)
          const rTop = Math.max(sx, sy, sz)
          return (
            <group key={k.id} position={c}>
              <mesh scale={[sx, sy, sz]}>
                <sphereGeometry args={[1, 32, 32]} />
                <meshStandardMaterial color={status === 'pass' ? BLUE : status === 'fail' ? VERMILION : AMBER} transparent opacity={0.22} depthWrite={false} />
              </mesh>
              <Html position={[0, rTop + 0.3, 0]} center distanceFactor={11} zIndexRange={[20, 0]}>
                <div className={`mw-tag mw-tag-${status}`}><b>{k.label ?? k.id}</b>{check && <div className="mw-tag-measure">{check.measured}</div>}</div>
              </Html>
            </group>
          )
        }
        return null
      })}
    </group>
  )
}

// ---- handles (write intents only) ------------------------------------------------

function useOrbitLock() {
  const controls = useThree((st) => st.controls) as unknown as { enabled: boolean } | null
  return (locked: boolean) => { if (controls) controls.enabled = !locked }
}

function capture(e: ThreeEvent<PointerEvent>) {
  try { (e.target as unknown as { setPointerCapture(id: number): void }).setPointerCapture(e.pointerId) } catch { /* synthetic */ }
}
function release(e: ThreeEvent<PointerEvent>) {
  try { (e.target as unknown as { releasePointerCapture(id: number): void }).releasePointerCapture(e.pointerId) } catch { /* synthetic */ }
}

function CurveHandle({ s, mapper, id, atX, label, y }: { s: Session; mapper: Mapper; id: string; atX: number; label: string; y: number }) {
  const [hover, setHover] = useState(false)
  const [drag, setDrag] = useState(false)
  useCursor(hover || drag, drag ? 'grabbing' : 'grab')
  const lock = useOrbitLock()
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), [])
  const hit = useMemo(() => new THREE.Vector3(), [])
  const pos = mapper.point({ [mapper.x.source]: atX, [mapper.y.source]: y })
  const busy = !!s.pending
  return (
    <group position={pos}>
      <mesh
        onPointerOver={(e) => { e.stopPropagation(); setHover(true) }}
        onPointerOut={() => setHover(false)}
        onPointerDown={(e) => {
          if (busy) return
          e.stopPropagation()
          capture(e)
          lock(true)
          setDrag(true)
        }}
        onPointerMove={(e) => {
          if (!drag) return
          e.stopPropagation()
          if (e.ray.intersectPlane(plane, hit)) host.dragCurveHandle(id, mapper.y.toModel(hit.y))
        }}
        onPointerUp={(e) => {
          if (!drag) return
          e.stopPropagation()
          release(e)
          lock(false)
          setDrag(false)
          void host.commitPreview('user')
        }}
        onPointerCancel={(e) => { if (!drag) return; e.stopPropagation(); release(e); lock(false); setDrag(false); host.endPreview() }}
      >
        <sphereGeometry args={[drag ? 0.24 : hover ? 0.22 : 0.19, 28, 28]} />
        <meshStandardMaterial color={BRASS} roughness={0.28} metalness={0.7} emissive={BRASS} emissiveIntensity={drag || hover ? 0.45 : 0.2} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.32, 0.018, 8, 40]} />
        <meshBasicMaterial color={BRASS} transparent opacity={hover || drag ? 0.9 : 0.45} />
      </mesh>
      <Html position={[0.32, 0.32, 0]} distanceFactor={11} zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
        <div className="mw-handle-tag">拖 {label}</div>
      </Html>
    </group>
  )
}

function InitialPointHandle({ s, mapper, id, states, label, point }: {
  s: Session; mapper: Mapper; id: string; states: [string, string]; label: string; point: THREE.Vector3
}) {
  const [hover, setHover] = useState(false)
  const [drag, setDrag] = useState(false)
  useCursor(hover || drag, drag ? 'grabbing' : 'grab')
  const lock = useOrbitLock()
  const hit = useMemo(() => new THREE.Vector3(), [])
  // drag plane: spanned by the two states' axes, through the current start point
  const axA = axisFor(mapper, states[0])
  const axB = axisFor(mapper, states[1])
  const normal = useMemo(() => {
    const all = ['x', 'y', 'z'].filter((a) => a !== axA && a !== axB)[0] ?? 'z'
    return new THREE.Vector3(all === 'x' ? 1 : 0, all === 'y' ? 1 : 0, all === 'z' ? 1 : 0)
  }, [axA, axB])
  const plane = useMemo(() => new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point), [normal, point])
  const read = (ax: 'x' | 'y' | 'z' | null, v: THREE.Vector3) => (ax === 'x' ? mapper.x.toModel(v.x) : ax === 'y' ? mapper.y.toModel(v.y) : ax === 'z' && mapper.z ? mapper.z.toModel(v.z) : NaN)
  const busy = !!s.pending
  return (
    <group position={point}>
      <mesh
        onPointerOver={(e) => { e.stopPropagation(); setHover(true) }}
        onPointerOut={() => setHover(false)}
        onPointerDown={(e) => { if (busy) return; e.stopPropagation(); capture(e); lock(true); setDrag(true) }}
        onPointerMove={(e) => {
          if (!drag) return
          e.stopPropagation()
          if (e.ray.intersectPlane(plane, hit)) host.dragInitialPoint(id, read(axA, hit), read(axB, hit))
        }}
        onPointerUp={(e) => { if (!drag) return; e.stopPropagation(); release(e); lock(false); setDrag(false); void host.commitPreview('user') }}
        onPointerCancel={(e) => { if (!drag) return; e.stopPropagation(); release(e); lock(false); setDrag(false); host.endPreview() }}
      >
        <sphereGeometry args={[drag ? 0.26 : hover ? 0.24 : 0.21, 28, 28]} />
        <meshStandardMaterial color={BRASS} roughness={0.28} metalness={0.7} emissive={BRASS} emissiveIntensity={drag || hover ? 0.45 : 0.2} />
      </mesh>
      <Html position={[0.34, 0.34, 0]} distanceFactor={11} zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
        <div className="mw-handle-tag">拖 {label}</div>
      </Html>
    </group>
  )
}

// ---- floor, axes, history ----------------------------------------------------------

function Floor({ mapper }: { mapper: Mapper }) {
  const S = mapper.size
  const w = S.x + 3
  const d = Math.max(S.z, 2.4) + 3
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#f2ecdf" roughness={0.95} />
      </mesh>
      <Grid args={[w, d]} position={[0, 0.002, 0]} cellSize={0.5} cellThickness={0.6} cellColor={RULE} sectionSize={2} sectionThickness={1} sectionColor="#cdbfa6" fadeDistance={40} infiniteGrid={false} />
    </group>
  )
}

function Axes({ mapper }: { mapper: Mapper }) {
  const S = mapper.size
  const x0 = -S.x / 2
  const z0 = mapper.z ? -S.z / 2 : 0
  const ticks = (n: number) => Array.from({ length: n + 1 }, (_, i) => i / n)
  return (
    <group>
      <Line points={[[x0, 0, z0], [S.x / 2, 0, z0]]} color={INK} lineWidth={1.2} />
      <Line points={[[x0, 0, z0], [x0, S.y, z0]]} color={INK} lineWidth={1.2} />
      {mapper.z && <Line points={[[x0, 0, z0], [x0, 0, S.z / 2]]} color={INK} lineWidth={1.2} />}
      {ticks(4).map((f) => (
        <Html key={`x${f}`} position={[x0 + f * S.x, -0.05, z0 + 0.35]} center distanceFactor={12} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div className="mw-tick">{fmt(mapper.x.min + f * (mapper.x.max - mapper.x.min))}</div>
        </Html>
      ))}
      {ticks(4).map((f) => (
        <Html key={`y${f}`} position={[x0 - 0.35, f * S.y, z0]} center distanceFactor={12} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div className="mw-tick">{fmt(mapper.y.min + f * (mapper.y.max - mapper.y.min))}</div>
        </Html>
      ))}
      {mapper.z && ticks(4).map((f) => (
        <Html key={`z${f}`} position={[x0 - 0.35, -0.05, z0 + f * S.z]} center distanceFactor={12} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div className="mw-tick">{fmt(mapper.z!.min + f * (mapper.z!.max - mapper.z!.min))}</div>
        </Html>
      ))}
      <Html position={[S.x / 2 + 0.5, 0.15, z0 - (mapper.z ? 0.7 : 0)]} center distanceFactor={11} style={{ pointerEvents: 'none' }}><div className="mw-axis">{mapper.x.label}</div></Html>
      <Html position={[x0 + 0.25, S.y + 0.35, z0 + (mapper.z ? 0.3 : 0)]} center distanceFactor={11} style={{ pointerEvents: 'none' }}><div className="mw-axis">{mapper.y.label}</div></Html>
      {mapper.z && <Html position={[x0, 0, S.z / 2 + 0.5]} center distanceFactor={11} style={{ pointerEvents: 'none' }}><div className="mw-axis">{mapper.z.label}</div></Html>}
    </group>
  )
}

function History({ s, mapper }: { s: Session; mapper: Mapper }) {
  // previous committed attempts stay visible as layered ghosts (formula: pushed back in depth)
  const items = s.attempts.filter((a) => a.status === 'committed' && !a.fromFile && a.generation !== s.committed?.generation).slice(-6)
  return (
    <group>
      {items.map((a, i) => {
        const depth = s.world.model.kind === 'formula' ? -0.55 * (items.length - i) : 0
        let pts: THREE.Vector3[] = []
        if (s.world.model.kind === 'formula') {
          const run = getExperimentRun(a.runIds[0])
          const p = (run?.result as { points?: Array<[number, number]> } | undefined)?.points
          if (p) pts = curvePoints(s.world, mapper, p).map((v) => v.setZ(depth))
        } else {
          const tr = trajectoryOfRun(s.world, a.runIds[0])
          if (tr) pts = trajectoryPoints(s.world, mapper, tr.t, tr.series)
        }
        if (pts.length < 2) return null
        const color = a.assessment?.outcome === 'success' ? BLUE : a.assessment?.outcome === 'unknown' ? AMBER : VERMILION
        return <Line key={a.generation} points={pts} color={color} lineWidth={1.1} transparent opacity={0.32} />
      })}
    </group>
  )
}

// ---- the world ------------------------------------------------------------------------

function WorldContent({ s, timePlayer }: { s: Session; timePlayer?: { current: PlayerState } }) {
  const preview = useSyncExternalStore(host.subscribePreview, host.getPreview)
  const mapper = useMemo(() => makeMapper(s.world), [s.world])
  const world = s.world
  if (world.model.kind === 'kakeya') return <KakeyaRoom s={s} />

  const formalPts = useMemo(() => {
    if (world.model.kind === 'formula') {
      const c = committedCurve(s)
      return c ? curvePoints(world, mapper, c) : []
    }
    const tr = committedTrajectory(s)
    return tr ? trajectoryPoints(world, mapper, tr.t, tr.series) : []
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.committed, world, mapper])

  const previewPts = useMemo(() => {
    if (!preview) return []
    if (world.model.kind === 'formula' && preview.curve) return curvePoints(world, mapper, preview.curve)
    if (world.model.kind === 'ode' && preview.traj) return trajectoryPoints(world, mapper, preview.traj.t, preview.traj.series)
    return []
  }, [preview, world, mapper])

  const shadowPts = useMemo(() => formalPts.map((p) => new THREE.Vector3(p.x, 0.01, p.z)), [formalPts])
  const outcome = s.committed?.assessment.outcome
  const tubeColor = outcome === 'success' ? BLUE : outcome === 'fail' ? '#3d6f9e' : outcome === 'unknown' ? AMBER : BLUE
  const params = preview?.params ?? s.params
  const committedTraj = world.model.kind === 'ode' ? committedTrajectory(s) : null

  return (
    <group>
      <Floor mapper={mapper} />
      <Axes mapper={mapper} />
      <History s={s} mapper={mapper} />
      {formalPts.length > 1 && <Tube points={formalPts} color={tubeColor} opacity={preview ? 0.35 : 1} />}
      {formalPts.length > 1 && world.model.kind === 'ode' && <Line points={shadowPts} color={INK_SOFT} lineWidth={1} transparent opacity={0.35} />}
      {previewPts.length > 1 && <Line points={previewPts} color={BRASS} lineWidth={3} dashed dashSize={0.18} gapSize={0.1} />}
      {/* ODE: the probe animates over the PAPER'S OWN t (run samples + lerp),
          never an arbitrary period — CLI-151b. Formula keeps the arc probe. */}
      {committedTraj && timePlayer && world.model.kind === 'ode' && (
        <OdeTimeMarker world={world} mapper={mapper} traj={{ t: committedTraj.t, series: committedTraj.series }} player={timePlayer} />
      )}
      {!preview && formalPts.length > 1 && !committedTraj && <Probe points={formalPts} period={5.5} />}

      {world.model.kind === 'formula' && world.goal.constraints.map((k) =>
        k.kind === 'gate' ? <Gate key={k.id} s={s} mapper={mapper} k={k} previewCurve={preview?.curve} />
          : k.kind === 'avoid-box' ? <AvoidBox key={k.id} s={s} mapper={mapper} k={k} /> : null,
      )}
      {world.model.kind === 'ode' && <OdeConstraints s={s} mapper={mapper} />}

      {world.model.kind === 'formula' && world.controls.map((c) => {
        if (c.kind !== 'curve-handle') return null
        const y = host.evalFormulaAt(params, c.atX)
        if (y === null) return null
        return <CurveHandle key={c.id} s={s} mapper={mapper} id={c.id} atX={c.atX} label={c.label ?? c.param} y={y} />
      })}
      {world.model.kind === 'ode' && world.controls.map((c) => {
        if (c.kind !== 'initial-point') return null
        const m = world.model.kind === 'ode' ? world.model : null
        if (!m) return null
        const values: Record<string, number> = { t: m.tSpan[0] }
        for (const st of m.states) values[st.name] = st.operable ? params[st.name] ?? st.initial : st.initial
        return <InitialPointHandle key={c.id} s={s} mapper={mapper} id={c.id} states={c.states} label={c.label ?? c.states.join('/')} point={mapper.point(values)} />
      })}

      {preview?.diagnostic && (
        <Html position={[0, mapper.size.y + 1.1, 0]} center zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`mw-diagnostic ${/无解|病态|残差|越出|非有限|发散/.test(preview.diagnostic) ? 'bad' : ''}`}>{preview.diagnostic}</div>
        </Html>
      )}
      {preview?.invalid && (
        <Html position={[0, mapper.size.y + 1.7, 0]} center zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }}>
          <div className="mw-diagnostic bad">{preview.invalid}</div>
        </Html>
      )}
    </group>
  )
}

function cameraFor(world: WorldDefinition): { position: [number, number, number]; target: [number, number, number] } {
  if (world.model.kind === 'kakeya') return { position: [10.5, 8.5, 12.5], target: [0, 0, 0] }
  const m = makeMapper(world)
  const S = m.size
  // right-edge constraints (gates near x.max) need margin: bias the target
  // slightly right and keep the camera far enough for the full span
  if (!m.z) return { position: [0.8, S.y * 1.0, S.x * 1.12 + 2.5], target: [0.4, S.y * 0.45, 0] }
  return { position: [S.x * 1.05, S.y * 1.5, S.z * 1.35], target: [0, S.y * 0.28, 0] }
}

// ---- Kakeya room (方向之室 · CLI-149) ---------------------------------------
// The scoring cube [0,1]³ rendered at S=8 world units. Tubes come from the
// SAME canonical chain as the formal run (kakeyaTubes), rendered as capsules;
// clusters are colour-coded, movable clusters are draggable on a camera-facing
// plane (directions/lengths/radii never move — only the cluster offset).

const KAK_S = 8 // world size of the unit cube
const CLUSTER_COLORS = ['#2f5d8a', '#7d4a8d', '#3d7a55', '#b0782a', '#8a4a3d', '#4a6d8a']

function KakeyaRoom({ s }: { s: Session }) {
  const preview = useSyncExternalStore(host.subscribePreview, host.getPreview)
  const replayIdx = useSyncExternalStore(host.subscribe, () => host.replayIdx)
  const m = s.world.model
  if (m.kind !== 'kakeya') return null
  // replay mode: render the historical attempt's frozen params (read-only)
  const replayValues = replayIdx !== null ? host.replayParams() : null
  const values = replayValues ?? preview?.params ?? s.params
  const offsets = Object.fromEntries(
    m.clusters.map((c) => [c.id, { x: values[`${c.id}.x`] ?? 0, y: values[`${c.id}.y`] ?? 0, z: values[`${c.id}.z`] ?? 0 }]),
  ) as Record<string, { x: number; y: number; z: number }>
  const tubes = useMemo(() => {
    try {
      return kakeyaTubes(m, offsets)
    } catch {
      return [] // the preview keeps the last legal layout; an illegal one never renders
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m, JSON.stringify(offsets)])
  const toWorld = (v: number) => (v - 0.5) * KAK_S
  if (replayValues) {
    return (
      <group>
        <LabGround y={-KAK_S / 2 - 0.25} size={KAK_S * 1.9} />
        <CubeFrame size={KAK_S} />
        {tubes.map((t, i) => {
          const cluster = m.clusters.find((c) => c.tubes.includes(i))
          const ci = m.clusters.indexOf(cluster ?? m.clusters[0])
          const color = cluster ? CLUSTER_COLORS[ci % CLUSTER_COLORS.length] : INK_SOFT
          const half = t.length / 2
          const a = { x: toWorld(t.center.x - t.dir.x * half), y: toWorld(t.center.y - t.dir.y * half), z: toWorld(t.center.z - t.dir.z * half) }
          const b = { x: toWorld(t.center.x + t.dir.x * half), y: toWorld(t.center.y + t.dir.y * half), z: toWorld(t.center.z + t.dir.z * half) }
          const mid = new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
          const dir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z)
          const len = dir.length() || 1e-6
          const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().divideScalar(len))
          return (
            <mesh key={i} position={mid} quaternion={quat}>
              <cylinderGeometry args={[Math.max(0.03, t.radius * KAK_S), Math.max(0.03, t.radius * KAK_S), len, 10, 1, false]} />
              <meshStandardMaterial color={color} roughness={0.5} metalness={0.1} transparent opacity={0.6} />
            </mesh>
          )
        })}
        <Html position={[0, KAK_S / 2 + 1.2, 0]} center distanceFactor={14} zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }}>
          <div className="mw-diagnostic">回放 · 只读布局（不计分）</div>
        </Html>
      </group>
    )
  }
  return (
    <group>
      {/* the scoring cube (CLI-148 asset kit: framed cube + lab ground) */}
      <LabGround y={-KAK_S / 2 - 0.25} size={KAK_S * 1.9} />
      <CubeFrame size={KAK_S} />
      <mesh>
        <boxGeometry args={[KAK_S, KAK_S, KAK_S]} />
        <meshStandardMaterial color={PAPER} transparent opacity={0.05} depthWrite={false} side={THREE.BackSide} />
      </mesh>
      <Html position={[0, KAK_S / 2 + 0.7, 0]} center distanceFactor={14} zIndexRange={[15, 0]} style={{ pointerEvents: 'none' }}>
        <div className="mw-tag">计分域 [0,1]³ —— 管必须整根留在盒内</div>
      </Html>
      {tubes.map((t, i) => {
        const cluster = m.clusters.find((c) => c.tubes.includes(i))
        const ci = m.clusters.indexOf(cluster ?? m.clusters[0])
        const color = cluster ? CLUSTER_COLORS[ci % CLUSTER_COLORS.length] : INK_SOFT
        const operable = cluster ? cluster.operable !== false : false
        const half = t.length / 2
        const a = { x: toWorld(t.center.x - t.dir.x * half), y: toWorld(t.center.y - t.dir.y * half), z: toWorld(t.center.z - t.dir.z * half) }
        const b = { x: toWorld(t.center.x + t.dir.x * half), y: toWorld(t.center.y + t.dir.y * half), z: toWorld(t.center.z + t.dir.z * half) }
        const mid = new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
        const dir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z)
        const len = dir.length() || 1e-6
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().divideScalar(len))
        const r = Math.max(0.03, t.radius * KAK_S)
        const control = operable ? s.world.controls.find((c) => c.kind === 'cluster-drag' && c.cluster === cluster!.id) : undefined
        return (
          <TubeMesh
            key={i}
            mid={mid}
            quat={quat}
            len={len}
            r={r}
            color={color}
            operable={!!control}
            dimmed={!cluster}
            selected={!!preview && !!control}
            controlId={control && control.kind === 'cluster-drag' ? control.id : undefined}
            label={cluster?.label ?? cluster?.id}
            busy={!!s.pending}
            // dragging updates by world delta on the camera-facing plane
            onDelta={(dx, dy, dz) => { if (control && control.kind === 'cluster-drag') host.dragCluster(control.id, dx / KAK_S, dy / KAK_S, dz / KAK_S) }}
            onRelease={() => { void host.commitPreview('user') }}
          />
        )
      })}
      {/* CLI-148 markers: status glow above the fixed cluster reflects the
          committed Assessment (display only — it never judges), selection ring
          marks the packing target while a drag preview is live */}
      {(() => {
        const fixedCluster = m.clusters.find((c) => c.operable === false) ?? m.clusters[0]
        const ids = fixedCluster?.tubes ?? []
        if (!ids.length || tubes.length !== m.nTubes) return null
        let x = 0, y = 0, z = 0
        for (const i of ids) { x += tubes[i].center.x / ids.length; y += tubes[i].center.y / ids.length; z += tubes[i].center.z / ids.length }
        const outcome = s.committed?.assessment?.outcome
        const status = s.pending ? 'computing' : outcome === 'success' ? 'ok' : outcome === 'fail' ? 'fail' : 'idle'
        return (
          <group key="mw-markers">
            {/* review m3: cluster means are CUBE coords — convert to world like the tubes */}
            <StatusGlow position={[toWorld(x), toWorld(y) + KAK_S * 0.09, toWorld(z)]} radius={KAK_S * 0.012} state={status} />
            {preview && <SelectionRing position={[toWorld(x), toWorld(y) - KAK_S / 2 + 0.02, toWorld(z)]} radius={KAK_S * 0.16} state="selected" />}
          </group>
        )
      })()}
      {preview?.diagnostic && (
        <Html position={[0, KAK_S / 2 + 1.5, 0]} center zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`mw-diagnostic ${/越出|计分域|非法/.test(preview.diagnostic) ? 'bad' : ''}`}>{preview.diagnostic}</div>
        </Html>
      )}
      {preview?.invalid && (
        <Html position={[0, KAK_S / 2 + 2.1, 0]} center zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }}>
          <div className="mw-diagnostic bad">{preview.invalid}</div>
        </Html>
      )}
    </group>
  )
}

function TubeMesh({ mid, quat, len, r, color, operable, dimmed, selected, controlId, label, busy, onDelta, onRelease }: {
  mid: THREE.Vector3; quat: THREE.Quaternion; len: number; r: number; color: string
  operable: boolean; dimmed: boolean; selected: boolean; controlId?: string; label?: string
  busy: boolean
  onDelta: (dx: number, dy: number, dz: number) => void
  onRelease: () => void
}) {
  const [hover, setHover] = useState(false)
  const [drag, setDrag] = useState(false)
  void selected
  useCursor(hover || drag, drag ? 'grabbing' : operable ? 'grab' : 'default')
  const lock = useOrbitLock()
  const camera = useThree((st) => st.camera)
  const plane = useMemo(() => new THREE.Plane(), [])
  const last = useRef(new THREE.Vector3())
  const hit = useMemo(() => new THREE.Vector3(), [])
  const begin = (e: ThreeEvent<PointerEvent>) => {
    if (!operable || busy) return
    e.stopPropagation()
    capture(e)
    lock(true)
    setDrag(true)
    // camera-facing plane through the tube
    plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(), mid)
    if (e.ray.intersectPlane(plane, hit)) last.current.copy(hit)
  }
  const move = (e: ThreeEvent<PointerEvent>) => {
    if (!drag) return
    e.stopPropagation()
    if (e.ray.intersectPlane(plane, hit)) {
      onDelta(hit.x - last.current.x, hit.y - last.current.y, hit.z - last.current.z)
      last.current.copy(hit)
    }
  }
  const end = (e: ThreeEvent<PointerEvent>) => {
    if (!drag) return
    e.stopPropagation()
    release(e)
    lock(false)
    setDrag(false)
    onRelease()
  }
  // review M1: pointercancel (touch scroll takeover / system gesture) must end
  // the drag WITHOUT committing — otherwise the drifted preview would be
  // submitted as a formal attempt on the next pointerup
  const cancel = (e: ThreeEvent<PointerEvent>) => {
    if (!drag) return
    e.stopPropagation()
    release(e)
    lock(false)
    setDrag(false)
    host.endPreview()
  }
  return (
    <mesh
      position={mid}
      quaternion={quat}
      onPointerOver={(e) => { e.stopPropagation(); if (operable) setHover(true) }}
      onPointerOut={() => setHover(false)}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={cancel}
    >
      <cylinderGeometry args={[r, r, len, 10, 1, false]} />
      <meshStandardMaterial
        color={color}
        roughness={0.45}
        metalness={0.15}
        transparent
        opacity={dimmed ? 0.55 : hover || drag || selected ? 0.95 : 0.78}
        emissive={color}
        emissiveIntensity={drag ? 0.8 : hover || selected ? 0.4 : 0.08}
      />
      {(hover || drag) && operable && (
        <Html position={[0, len / 2 + 0.35, 0]} center distanceFactor={11} zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
          <div className="mw-handle-tag">拖 {label ?? controlId} 整簇（只挪位置）</div>
        </Html>
      )}
    </mesh>
  )
}

export function WorldScene({ s, inspecting = true }: { s: Session; inspecting?: boolean }) {
  const cam = useMemo(() => cameraFor(s.world), [s.world])
  // CLI-151b: the paper-time player state lives OUTSIDE the canvas so the DOM
  // controls and the in-canvas marker share one mutable clock
  const timePlayer = useRef<PlayerState>({ playing: false, t: 0, speed: 1 })
  const hasTraj = s.world.model.kind === 'ode' && committedTrajectory(s) !== null
  const traj = hasTraj ? (committedTrajectory(s) as { t: number[]; series: number[][] }) : null
  if (traj && timePlayer.current.t < traj.t[0]) timePlayer.current.t = traj.t[0]
  if (traj && timePlayer.current.t > traj.t[traj.t.length - 1]) timePlayer.current.t = traj.t[traj.t.length - 1]
  return (
    <>
    <Canvas
      key={`${s.world.id}:${s.worldDigest}`}
      shadows
      dpr={[1, 2]}
      camera={{ position: cam.position, fov: 42, near: 0.1, far: 200 }}
      // the scene lives BETWEEN the side panels — no geometry or tag hides
      // under the cards (Html tags have no canvas-edge clipping of their own)
      className={`mw-scene${inspecting ? ' mw-scene-inspecting' : ''}`}
      style={{ position: 'absolute' }}
    >
      <color attach="background" args={[PAPER]} />
      <fog attach="fog" args={[PAPER, 26, 60]} />
      <hemisphereLight args={['#fffaf0', '#d9cdb8', 0.75]} />
      <directionalLight position={[6, 12, 8]} intensity={1.15} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12} />
      <directionalLight position={[-8, 6, -6]} intensity={0.35} />
      <WorldContent s={s} timePlayer={timePlayer} />
      <OrbitControls makeDefault target={cam.target} enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI * 0.49} minDistance={3} maxDistance={40} />
    </Canvas>
    {traj && (
      <OdeTimeControls
        key={`${s.sessionId}:${s.committed?.generation ?? 0}`}
        traj={traj}
        playerRef={timePlayer}
        states={s.world.model.kind === 'ode' ? s.world.model.states.map((st) => st.name) : []}
      />
    )}
    </>
  )
}
