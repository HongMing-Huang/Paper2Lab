// Physics Lab — the ported zalo/mujoco_wasm demo as an independent Paper2Lab
// experiment page (upstream main.js@f6b202ca: catch-up stepping loop, drag
// force via mj_applyFT with the upstream spring factor mass*250, paused
// drag branch, body-transform sync). Paper2Lab additions around it:
//   * the playback contract (src/physics/playback.ts) drives start/pause/reset
//   * params (gravityZ/windX/timestep) write the REAL mjModel.opt
//   * 「记录 Run」 executes mujoco.simulate in the backend engine (same wasm
//     version) and imports the immutable ExperimentRun — the badge and the
//     chart carry its runId (constitution: numbers only from real execution)
//   * export_run downloads the run bundle from the immutable history
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import load_mujoco from '@mujoco/mujoco'
import wasmUrl from '@mujoco/mujoco/mujoco.wasm?url'
import scenesIndex from '../../../public/assets/mujoco/scenes/index.json'
import manifest from '../scenes/manifest.json'
import { DragStateManager } from './DragStateManager'
import { getPosition, getQuaternion, loadSceneInto, toMujocoPos, type LoadedScene } from './loadScene'
import { initialPlayback, playbackCommand, type PlaybackState } from '../playback'
import { registerImportedRun, exportExperimentRuns } from '../../experiments/protocol'

type MujocoModule = Awaited<ReturnType<typeof load_mujoco>> & { FS: { mkdir(p: string): void; mount(t: unknown, o: Record<string, unknown>, at: string): void; writeFile(p: string, d: Uint8Array): void } }

let modulePromise: Promise<MujocoModule> | null = null
async function getBrowserMujoco(): Promise<MujocoModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const mod = (await load_mujoco({ locateFile: () => wasmUrl })) as MujocoModule
      mod.FS.mkdir('/working')
      mod.FS.mount(mod.MEMFS, { root: '.' }, '/working')
      // seed the VFS with the whole vendored tree (same-origin fetch);
      // scene subfolders (agility_cassie/, shadow_hand/) need parent dirs
      const ensureDir = (rel: string) => {
        const parts = rel.split('/')
        for (let i = 1; i < parts.length; i++) {
          try { mod.FS.mkdir('/working/' + parts.slice(0, i).join('/')) } catch { /* exists */ }
        }
      }
      const { files } = scenesIndex as { files: string[] }
      for (const rel of files) {
        const buf = new Uint8Array(await (await fetch(`assets/mujoco/scenes/${rel}`)).arrayBuffer())
        ensureDir(rel)
        mod.FS.writeFile(`/working/${rel}`, buf)
      }
      return mod
    })()
  }
  return modulePromise
}

interface RecordedRun {
  runId: string
  engine: string
  engineVersion: string
  metrics: { finalTime: number; qposNormFinal: number; comZFinal: number | null }
  t: number[]
  com: (number | null)[]
}

export function PhysicsLab({ onExit }: { onExit: () => void }) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const [scene, setScene] = useState('humanoid.xml')
  const [playback, setPlayback] = useState<PlaybackState>(initialPlayback())
  const [status, setStatus] = useState('loading wasm + scenes…')
  const [recording, setRecording] = useState(false)
  const [run, setRun] = useState<RecordedRun | null>(null)
  const [error, setError] = useState<string | null>(null)

  const st = useRef({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mujoco: null as any,
    loaded: null as LoadedScene | null,
    renderer: null as THREE.WebGLRenderer | null,
    scene3: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    controls: null as OrbitControls | null,
    drag: null as DragStateManager | null,
    mujocoTime: 0,
    phase: 'idle' as PlaybackState['phase'],
    params: { gravityZ: -9.81, windX: 0, timestep: 0 } as Record<string, number>,
    sceneName: 'humanoid.xml',
    lastRunId: null as string | null,
  })

  // ---- boot the upstream demo skeleton once --------------------------------
  useEffect(() => {
    let disposed = false
    let raf = 0
      ;(async () => {
      const host = mountRef.current
      if (!host) return
      const mujoco = await getBrowserMujoco()
      if (disposed) return

      const scene3 = new THREE.Scene()
      scene3.background = new THREE.Color(0.16, 0.24, 0.34)
      scene3.fog = new THREE.Fog(scene3.background, 15, 25)
      const camera = new THREE.PerspectiveCamera(45, host.clientWidth / host.clientHeight, 0.001, 100)
      camera.position.set(2.0, 1.7, 1.7)
      scene3.add(camera)
      scene3.add(new THREE.AmbientLight(0xffffff, 0.1 * 3.14))
      const spotlight = new THREE.SpotLight()
      spotlight.angle = 1.11
      spotlight.penumbra = 0.5
      spotlight.castShadow = true
      spotlight.intensity = spotlight.intensity * 3.14 * 10
      spotlight.shadow.mapSize.set(1024, 1024)
      spotlight.position.set(0, 3, 3)
      const target = new THREE.Object3D()
      target.position.set(0, 1, 0)
      scene3.add(target)
      spotlight.target = target
      scene3.add(spotlight)

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
      renderer.setPixelRatio(1)
      renderer.setSize(host.clientWidth, host.clientHeight)
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFSoftShadowMap
      host.appendChild(renderer.domElement)

      const controls = new OrbitControls(camera, renderer.domElement)
      controls.target.set(0, 0.7, 0)
      controls.enableDamping = true
      controls.dampingFactor = 0.1
      controls.screenSpacePanning = true

      const holder = { scene: scene3, mujocoRoot: undefined as THREE.Group | undefined }
      const loaded = loadSceneInto(mujoco, st.current.sceneName, holder)
      const drag = new DragStateManager(scene3, renderer, camera, renderer.domElement, controls)

      Object.assign(st.current, { mujoco, loaded, renderer, camera, controls, drag, scene3, mujocoTime: 0 })
      st.current.params.timestep = loaded.model === null ? 0 : (loaded.model as unknown as { opt: { timestep: number } }).opt.timestep
      setStatus(`ready · ${st.current.sceneName}`)

      const tmpVec = new THREE.Vector3()
      const tmpQuat = new THREE.Quaternion()
      const dummy = new THREE.Object3D()

      const renderLoop = (timeMS: number) => {
        raf = requestAnimationFrame(renderLoop)
        const s = st.current
        controls.update()
        if (!s.loaded) return
        const { model, data, bodies } = s.loaded

        if (s.phase === 'running') {
          const timestep = (model as unknown as { opt: { timestep: number } }).opt.timestep
          if (timeMS - s.mujocoTime > 35) s.mujocoTime = timeMS - 35
          while (s.mujocoTime < timeMS) {
            // upstream drag-force model: clear qfrc, then mj_applyFT with a
            // spring force (mass * 250) anchored at the raycast world hit
            for (let i = 0; i < data.qfrc_applied.length; i++) data.qfrc_applied[i] = 0
            const dragged = drag.physicsObject
            if (dragged && dragged.bodyID) {
              for (let b = 0; b < model.nbody; b++) {
                if (bodies[b]) {
                  getPosition(data.xpos, b, bodies[b].position)
                  getQuaternion(data.xquat, b, bodies[b].quaternion)
                  bodies[b].updateWorldMatrix(false, false)
                }
              }
              const bodyID = dragged.bodyID
              drag.update?.()
              const mass = (model as unknown as { body_mass: ArrayLike<number> }).body_mass[bodyID]
              const force = toMujocoPos(drag.currentWorld.clone().sub(drag.worldHit).multiplyScalar(mass * 250))
              const point = toMujocoPos(drag.worldHit.clone())
              ;(s.mujoco as { mj_applyFT(...args: unknown[]): void }).mj_applyFT(
                model, data,
                [force.x, force.y, force.z], [0, 0, 0], [point.x, point.y, point.z],
                bodyID, data.qfrc_applied,
              )
            }
            s.mujoco.mj_step(model, data)
            s.mujocoTime += timestep * 1000
          }
        } else {
          // paused idle branch (upstream): mj_forward so drags/shadows settle
          s.mujoco.mj_forward(model, data)
        }

        for (let b = 0; b < model.nbody; b++) {
          if (bodies[b]) {
            getPosition(data.xpos, b, bodies[b].position)
            getQuaternion(data.xquat, b, bodies[b].quaternion)
            bodies[b].updateWorldMatrix(false, false)
          }
        }
        void tmpVec
        void tmpQuat
        void dummy
        renderer.render(scene3, camera)
      }
      raf = requestAnimationFrame(renderLoop)

      // headless evidence surface (same fields the product script asserts)
      ;(window as unknown as { __P2L_PHYSICS__?: unknown }).__P2L_PHYSICS__ = {
        scene: () => st.current.sceneName,
        phase: () => st.current.phase,
        time: () => (st.current.loaded ? Number(st.current.loaded.data.time) : -1),
        draggingBody: () => st.current.drag?.physicsObject?.bodyID ?? null,
        lastRunId: () => st.current.lastRunId,
        // headless probe: run the raycast pick directly (x,y in client coords)
        pickAt: (x: number, y: number) => {
          const d = st.current.drag
          if (!d) return null
          d.scene.updateMatrixWorld(true)
          d.start(x, y)
          const hit = d.physicsObject?.bodyID ?? null
          d.end()
          return hit
        },
      }
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)))

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      st.current.renderer?.dispose()
      if (mountRef.current) mountRef.current.innerHTML = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- scene switch --------------------------------------------------------
  const switchScene = useCallback((name: string) => {
    const s = st.current
    if (!s.mujoco || !s.scene3) return
    const fresh = loadSceneInto(s.mujoco, name, { scene: s.scene3 })
    s.loaded?.data.delete?.()
    s.loaded?.model.delete?.()
    s.loaded = fresh
    s.sceneName = name
    s.mujocoTime = 0
    s.params.timestep = (fresh.model as unknown as { opt: { timestep: number } }).opt.timestep
    setScene(name)
    setPlayback(initialPlayback())
    s.phase = 'idle'
    setStatus(`ready · ${name}`)
  }, [])

  // ---- playback contract -----------------------------------------------------
  const command = useCallback((cmd: Parameters<typeof playbackCommand>[1]) => {
    const s = st.current
    // the LIVE viewer drives phase directly (start plays the interactive sim;
    // the machine's runId gate governs recorded-run playback, not the live
    // scene). set_params still flows through the machine for clamping.
    if (cmd.op === 'start') {
      s.phase = 'running'
      setPlayback((cur) => ({ ...cur, phase: 'running' }))
      return
    }
    if (cmd.op === 'pause') {
      s.phase = 'paused'
      setPlayback((cur) => ({ ...cur, phase: 'paused' }))
      return
    }
    if (cmd.op === 'reset') {
      if (s.mujoco && s.loaded) {
        s.mujoco.mj_resetData(s.loaded.model, s.loaded.data)
        s.mujoco.mj_forward(s.loaded.model, s.loaded.data)
        s.mujocoTime = 0
      }
      s.phase = 'idle'
      setPlayback((cur) => ({ ...cur, phase: 'idle', cursor: 0 }))
      return
    }
    setPlayback((cur) => {
      const { state } = playbackCommand(cur, cmd)
      if (cmd.op === 'set_params' && s.loaded) {
        const opt = (s.loaded.model as unknown as { opt: { gravity: Float64Array; wind: Float64Array; timestep: number } }).opt
        if (state.params.gravityZ !== undefined) opt.gravity[2] = state.params.gravityZ
        if (state.params.windX !== undefined) opt.wind[0] = state.params.windX
        if (state.params.timestep !== undefined && state.params.timestep > 0) opt.timestep = state.params.timestep
      }
      return state
    })
  }, [])

  // ---- record a real Run (backend engine, same wasm version) ----------------
  const recordRun = useCallback(async () => {
    setRecording(true)
    try {
      const res = await fetch('/api/engine/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          skill: 'mujoco.simulate',
          input: { scene: st.current.sceneName, steps: 500, sampleEvery: 25, params: { gravityZ: st.current.params.gravityZ } },
          planId: 'plan-physics-lab',
        }),
      })
      if (!res.ok) throw new Error(`engine HTTP ${res.status}`)
      const body = (await res.json()) as { outcome: { status: string; run?: { runId: string; engine: string; engineVersion: string; result: { metrics: RecordedRun['metrics']; t: number[]; qpos: number[][]; nq: number } } } }
      const out = body.outcome
      if (out.status !== 'ok' || !out.run) throw new Error(`engine returned ${out.status}`)
      registerImportedRun(out.run as never)
      st.current.lastRunId = out.run.runId
      const com = out.run.result.t.map((_, i) => (out.run!.result.qpos[i]?.[2] ?? null))
      setRun({ runId: out.run.runId, engine: out.run.engine, engineVersion: out.run.engineVersion, metrics: out.run.result.metrics, t: out.run.result.t, com })
      setStatus(`CALCULATED · run …${out.run.runId.slice(-4)} · ${out.run.engine}@${out.run.engineVersion}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRecording(false)
    }
  }, [])

  const exportRun = useCallback(() => {
    if (!run) return
    const blob = new Blob([exportExperimentRuns([run.runId])], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `mujoco-run-${run.runId}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }, [run])

  const scenes = (manifest as { scenes: string[] }).scenes

  return (
    <div className="physics-lab">
      <div className="physics-topbar">
        <button type="button" className="desk-btn" onClick={onExit}>← 首页</button>
        <select value={scene} onChange={(e) => switchScene(e.target.value)} data-testid="scene-select">
          {scenes.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="physics-status" data-testid="physics-status">{status}</span>
        <span style={{ flex: 1 }} />
        <label className="physics-param">
          g<sub>z</sub>
          <input
            type="range" min={-20} max={0} step={0.1} value={playback.params.gravityZ}
            data-testid="param-gravity"
            onChange={(e) => { st.current.params.gravityZ = Number(e.target.value); command({ op: 'set_params', params: { gravityZ: Number(e.target.value) } }) }}
          />
          {playback.params.gravityZ.toFixed(1)}
        </label>
        <button type="button" className="desk-btn" data-testid="pb-start" onClick={() => command({ op: 'start' })}>▶ 播放</button>
        <button type="button" className="desk-btn" data-testid="pb-pause" onClick={() => command({ op: 'pause' })}>⏸ 暂停</button>
        <button type="button" className="desk-btn" data-testid="pb-reset" onClick={() => command({ op: 'reset' })}>⟲ 重置</button>
        <button type="button" className="desk-btn desk-btn-play" data-testid="record-run" disabled={recording} onClick={() => void recordRun()}>
          {recording ? '引擎计算中…' : '记录 Run（500 步真算）'}
        </button>
        {run && <button type="button" className="desk-btn" data-testid="export-run" onClick={exportRun}>导出 Run</button>}
      </div>
      <div className="physics-stage" ref={mountRef} data-testid="physics-stage" />
      <div className="physics-footer">
        <span className="badge-calc">CALCULATED</span>
        {run ? (
          <>
            {' '}run {run.runId} · {run.engine}@{run.engineVersion} · finalTime {run.metrics.finalTime.toFixed(3)} · |q| {run.metrics.qposNormFinal.toFixed(3)}
            <span className="physics-chart" data-testid="run-chart">
              {run.t.map((t, i) => {
                const c = run.com[i]
                if (c === null || c === undefined) return null
                const h = Math.max(2, Math.min(46, Math.abs(c) * 30))
                return <span key={i} title={`t=${t.toFixed(2)} z=${c.toFixed(3)} · ${run.runId}`} style={{ width: 3, height: h, background: '#2f5d8a' }} />
              })}
            </span>
          </>
        ) : ' 按「记录 Run」把 500 步真实物理固化为 ExperimentRun（含引擎版本/参数/血缘）'}
        <span style={{ flex: 1 }} />
        <span className="physics-hint">拖拽物体=施力（mj_applyFT）· 左键旋转 · 滚轮缩放 · 交互手感待人工验收</span>
      </div>
      {error && <div className="physics-error" data-testid="physics-error">{error}</div>}
    </div>
  )
}
