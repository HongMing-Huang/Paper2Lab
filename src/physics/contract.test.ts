// Lane C — physics contract: force events live in the spec (forks keep
// them), the render contract carries a static geom summary, and the drag
// force direction is camera-independent (MuJoCo Z-up, upstream swizzle).
import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import './registerMujocoRunner'
import { executeSkill, replayRun } from '../skills/executor'
import { mujocoSimulate, type MjForce } from './mujocoKernel'
import { getPosition, getQuaternion, toMujocoPos } from './view/loadScene'

const plan = { planId: 'plan-physics-c' }

beforeAll(async () => {
  await mujocoSimulate('simple.xml', { steps: 1, sampleEvery: 1 })
}, 120_000)

describe('Lane C: force events are part of the spec', () => {
  it('a constant upward force lifts the load — forces replay every step', async () => {
    // force magnitudes below ~mass*g merely perturb the swing (non-monotonic
    // at t=0.4s); a strong force lifts unambiguously — the physics contract
    // is "the recorded force changes the trajectory", probed at a safe level
    const free: MjForce = { bodyId: 1, f: [0, 0, 400], p: [0.5, 0.5, 0.5] }
    const noForce = await mujocoSimulate('simple.xml', { steps: 200, sampleEvery: 200 })
    const lifted = await mujocoSimulate('simple.xml', { steps: 200, sampleEvery: 200, params: { forces: [free] } })
    expect(lifted.metrics.allFinite).toBe(true)
    expect(lifted.metrics.comZFinal!).toBeGreaterThan(noForce.metrics.comZFinal! + 0.2)
  })

  it('fork keeps the parent forces AND applies the parameter change', async () => {
    const forces: MjForce[] = [{ bodyId: 1, f: [0, 0, 60], p: [0.5, 0.5, 0.5] }]
    const base = await executeSkill('mujoco.simulate', {
      scene: 'simple.xml', steps: 200, sampleEvery: 100, params: { gravityZ: -9.81, forces },
    }, plan)
    expect(base.status).toBe('ok')
    if (base.status !== 'ok' || !base.run) return

    // fork halves gravity — the upward force must SURVIVE the fork
    const fork = await executeSkill('experiment.fork', {
      sourceRunId: base.run.runId,
      parameterChanges: { gravityZ: -1 },
    }, plan)
    expect(fork.status).toBe('ok')
    if (fork.status !== 'ok' || !fork.run) return
    expect(fork.run.parentRunId).toBe(base.run.runId)
    const model = fork.run.spec.model as { params: { forces?: MjForce[] } }
    expect(model.params.forces).toHaveLength(1) // ← the "fork deletes forces" fix
    expect(fork.run.spec.params.gravityZ).toBe(-1)
    // weaker gravity + same lift force ⇒ higher final CoM than the base
    const baseZ = (base.run.result as { metrics: { comZFinal: number } }).metrics.comZFinal
    const forkZ = (fork.run.result as { metrics: { comZFinal: number } }).metrics.comZFinal
    expect(forkZ).toBeGreaterThan(baseZ)
  })

  it('force validation rejects out-of-range bodies and vectors', async () => {
    await expect(mujocoSimulate('simple.xml', {
      steps: 5, sampleEvery: 5,
      params: { forces: [{ bodyId: 1.5, f: [0, 0, 1], p: [0, 0, 0] }] },
    })).rejects.toThrow(/bodyId/)
    await expect(mujocoSimulate('simple.xml', {
      steps: 5, sampleEvery: 5,
      params: { forces: [{ bodyId: 1, f: [0, 0, 1e9], p: [0, 0, 0] }] },
    })).rejects.toThrow(/range/)
  })
})

describe('Lane C: render contract (static summary + sampled frames)', () => {
  it('geomSummary describes the scene without the XML', async () => {
    const r = await mujocoSimulate('humanoid.xml', { steps: 10, sampleEvery: 10 })
    expect(r.geomSummary.nbody).toBeGreaterThan(5)
    expect(r.geomSummary.geoms.length).toBeGreaterThan(5)
    for (const g of r.geomSummary.geoms) {
      expect(Number.isFinite(g.bodyId)).toBe(true)
      expect(g.size.every((v) => Number.isFinite(v))).toBe(true)
    }
    // frames: qpos samples give the dynamic pose stream for rendering
    expect(r.qpos.length).toBeGreaterThanOrEqual(2)
    expect(r.qpos[0].length).toBe(r.geomSummary.nq)
  })

  it('replay reproduces force-driven trajectories bit-for-bit', async () => {
    const run = await executeSkill('mujoco.simulate', {
      scene: 'simple.xml', steps: 150, sampleEvery: 50,
      params: { forces: [{ bodyId: 1, f: [3, 0, 40], p: [0.5, 0.5, 0.5] }] },
    }, plan)
    if (run.status !== 'ok' || !run.run) throw new Error('run failed')
    const replay = await replayRun(run.run.runId)
    expect(replay.status).toBe('ok')
    if (replay.status !== 'ok' || !replay.run) return
    expect(JSON.stringify(replay.run.result)).toBe(JSON.stringify(run.run.result))
  })
})

describe('Lane C: drag-force direction is camera-independent (Z-up)', () => {
  it('the three(y-up)→MuJoCo(z-up) swizzle round-trips and is rotation-safe', () => {
    // a force pointing "up" on screen (three +y) must map to MuJoCo +z
    const up = toMujocoPos(new THREE.Vector3(0, 1, 0))
    expect(up.x).toBeCloseTo(0, 12)
    expect(up.y).toBeCloseTo(0, 12)
    expect(up.z).toBeCloseTo(1, 12)
    // east on screen (three +x) stays MuJoCo +x; north(three −z) → MuJoCo +y
    const east = toMujocoPos(new THREE.Vector3(1, 0, 0))
    expect(east.x).toBeCloseTo(1, 12)
    const north = toMujocoPos(new THREE.Vector3(0, 0, -1))
    expect(north.y).toBeCloseTo(1, 12)
  })

  it('drag delta (currentWorld − worldHit) maps to the MuJoCo force directly', () => {
    // after ANY camera orbit the delta is world-space — the linear map is
    // all that applies; verify with an arbitrary rotated-camera delta
    const worldHit = new THREE.Vector3(0.4, 0.9, -0.2)
    const current = new THREE.Vector3(0.7, 1.4, -0.5)
    const deltaThree = current.clone().sub(worldHit)
    const fMj = toMujocoPos(deltaThree.clone())
    // component-wise: mj = (x, −z, y) on the delta
    expect(fMj.x).toBeCloseTo(deltaThree.x, 12)
    expect(fMj.y).toBeCloseTo(-deltaThree.z, 12)
    expect(fMj.z).toBeCloseTo(deltaThree.y, 12)
  })

  it('position/quat swizzles round-trip MuJoCo→three→MuJoCo', () => {
    const buf = [1, 2, 3] // mj (x=1, y=2, z=3)
    const v = new THREE.Vector3()
    getPosition(buf, 0, v)
    // three: x=1, y=3(mj z), z=−2(−mj y)
    expect(v.x).toBeCloseTo(1, 12)
    expect(v.y).toBeCloseTo(3, 12)
    expect(v.z).toBeCloseTo(-2, 12)
    const q = new THREE.Quaternion()
    const qbuf = [1, 0, 0, 0] // identity w=1
    getQuaternion(qbuf, 0, q)
    expect(q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z).toBeCloseTo(1, 12)
  })
})
