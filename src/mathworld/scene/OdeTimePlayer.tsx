// CLI-151b 时间播放 — ODE 世界按论文的真实时间 t 呈现动力轨迹。
// 轨迹点来自最近正式 Run 的 t/series（RK4 采样），播放头只做采样点之间的
// 线性插值（运动学呈现），绝不重新积分、不引入等弧长/任意周期动画。
// 控制：播放/暂停/单步（前进一个采样）/重置/倍速；当前 t 与各状态值显示。
import { useEffect, useMemo, useReducer, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { WorldDefinition } from '../definition'
import type { Mapper } from './mapping'
import { fmt } from '../goal'

export interface Traj {
  t: number[]
  series: number[][]
}

export interface PlayerState {
  playing: boolean
  /** the current clock IN THE PAPER'S TIME UNITS (t0…t1 of the Run) */
  t: number
  speed: number
}

/** marker on the trajectory, driven by the paper's own t (run samples + lerp).
 *  `player` is a ref-like object shared with the DOM controls. */
export function OdeTimeMarker({ world, mapper, traj, player, onEnd }: {
  world: WorldDefinition
  mapper: Mapper
  traj: Traj
  player: { current: PlayerState }
  onEnd?: () => void
}) {
  const mesh = useRef<THREE.Group>(null)
  const trail = useRef<THREE.Mesh>(null)
  const names = world.model.kind === 'ode' ? world.model.states.map((st) => st.name) : []
  const t = traj.t
  const t0 = t[0]
  const t1 = t[t.length - 1]

  /** states interpolated at time tc (paper units) — presentation only */
  const sampleAt = (tc: number): { values: Record<string, number>; idx: number } => {
    let i = 1
    while (i < t.length - 1 && t[i] < tc) i++
    const span = t[i] - t[i - 1] || 1
    const f = Math.min(1, Math.max(0, (tc - t[i - 1]) / span))
    const values: Record<string, number> = { t: tc }
    names.forEach((n, j) => {
      const a = traj.series[j][i - 1]
      const b = traj.series[j][i]
      values[n] = Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * f : (b ?? a ?? 0)
    })
    return { values, idx: i }
  }

  useFrame((_, delta) => {
    const p = player.current
    if (p.playing) {
      p.t = Math.min(t1, p.t + delta * p.speed)
      if (p.t >= t1) {
        p.playing = false
        onEnd?.()
      }
    }
    const g = mesh.current
    if (!g) return
    const { values } = sampleAt(p.t)
    const target = mapper.point(values)
    g.position.copy(target)
    // a short trailing streak on the floor marks motion direction
    const tr = trail.current
    if (tr) {
      const behind = sampleAt(Math.max(t0, p.t - (t1 - t0) / 60))
      const from = mapper.point(behind.values)
      const mid = from.clone().add(target).multiplyScalar(0.5)
      tr.position.copy(new THREE.Vector3(mid.x, 0.02, mid.z))
      const len = Math.max(0.05, from.distanceTo(target))
      tr.scale.set(len, 1, 1)
      tr.rotation.y = Math.atan2(target.z - from.z, target.x - from.x)
    }
  })

  return (
    <group>
      <group ref={mesh}>
        <mesh castShadow>
          <sphereGeometry args={[0.14, 24, 24]} />
          <meshStandardMaterial color="#8a5a2b" roughness={0.25} metalness={0.55} emissive="#8a5a2b" emissiveIntensity={0.3} />
        </mesh>
      </group>
      <mesh ref={trail} rotation={[0, 0, 0]}>
        <boxGeometry args={[1, 0.012, 0.05]} />
        <meshStandardMaterial color="#b8935a" transparent opacity={0.65} />
      </mesh>
    </group>
  )
}

/** DOM controls — real-time t clock over the paper's own tSpan */
export function OdeTimeControls({ traj, playerRef, states }: {
  traj: Traj
  playerRef: { current: PlayerState }
  /** state names for the live value readout */
  states: string[]
}) {
  const [, force] = useReducer((x: number) => x + 1, 0)
  const p = playerRef.current
  useEffect(() => {
    playerRef.current.t = traj.t[0]
    playerRef.current.playing = false
    force()
    // Only the readout refreshes at 10Hz; the R3F marker uses its frame clock.
    let shownTime = playerRef.current.t
    let shownPlaying = playerRef.current.playing
    const timer = setInterval(() => {
      const next = playerRef.current
      if (next.t !== shownTime || next.playing !== shownPlaying) {
        shownTime = next.t
        shownPlaying = next.playing
        force()
      }
    }, 100)
    return () => clearInterval(timer)
  }, [traj, playerRef])
  const t0 = traj.t[0]
  const t1 = traj.t[traj.t.length - 1]
  const step = useMemo(() => {
    // one press advances by one output sample of the underlying Run
    const gaps = traj.t.slice(1).map((v, i) => v - traj.t[i]).filter((g) => g > 0)
    return gaps.length ? gaps[Math.floor(gaps.length / 2)] : (t1 - t0) / 100
  }, [traj.t, t0, t1])

  const readout = (() => {
    // interpolated readout for the controls panel (same lerp as the marker)
    const tc = p.t
    let i = 1
    while (i < traj.t.length - 1 && traj.t[i] < tc) i++
    const span = traj.t[i] - traj.t[i - 1] || 1
    const f = Math.min(1, Math.max(0, (tc - traj.t[i - 1]) / span))
    return states.map((n, j) => {
      const a = traj.series[j]?.[i - 1]
      const b = traj.series[j]?.[i]
      return `${n}=${fmt(a !== undefined && b !== undefined ? a + (b - a) * f : (b ?? a ?? 0))}`
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })()

  return (
    <div className="mw-timeplayer" data-testid="mw-timeplayer">
      <div className="mw-timeplayer-head">
        时间播放（论文时间 t）<span className="mw-timeplayer-t">t = {fmt(p.t)}</span>
      </div>
      <div className="mw-timeplayer-row">
        <button type="button" onClick={() => { if (p.t >= t1) p.t = t0; p.playing = !p.playing; force() }} data-testid="mw-time-play">
          {p.playing ? '⏸ 暂停' : p.t >= t1 ? '↻ 再播放' : '▶ 释放轨迹'}
        </button>
        <button type="button" onClick={() => { p.playing = false; p.t = Math.min(t1, p.t + step); force() }} title={`前进一个采样（≈${fmt(step)}）`}>
          ⏭ 单步
        </button>
        <button type="button" onClick={() => { p.playing = false; p.t = t0; force() }}>⏮ 重置</button>
        <select value={p.speed} onChange={(e) => { p.speed = Number(e.target.value); force() }} title="播放倍速（相对真实时间）">
          <option value={0.25}>×0.25</option>
          <option value={0.5}>×0.5</option>
          <option value={1}>×1（实时）</option>
          <option value={2}>×2</option>
          <option value={4}>×4</option>
        </select>
      </div>
      <div className="mw-timeplayer-readout">
        {readout.join(' · ')} <span className="mw-timeplayer-note">（最近正式 Run 采样插值，非重积分）</span>
      </div>
    </div>
  )
}
