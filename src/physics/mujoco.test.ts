// Stage A/C verification for the MuJoCo physics base — REAL wasm physics,
// no mocks: all 17 vendored scenes step, determinism replays, parameters
// change trajectories, the skill is plan-gated, and forks carry lineage.
// (Node test-suite registers the engine-side runner explicitly.)
import { beforeAll, describe, expect, it } from 'vitest'
import './registerMujocoRunner'
import { executeSkill, replayRun } from '../skills/executor'
import { getExperimentRun } from '../experiments/protocol'
import { listScenes, mujocoSimulate, scenesChecksum, scenesManifest } from './mujocoKernel'
import { initialPlayback, playbackCommand } from './playback'

const plan = { planId: 'plan-mujoco-test' }

beforeAll(async () => {
  await mujocoSimulate('simple.xml', { steps: 1, sampleEvery: 1 }) // boot wasm + seed VFS once
}, 120_000)

describe('Stage A — vendored scenes run real MuJoCo physics (headless)', () => {
  it('manifest locks the upstream commit and excludes flex.xml', () => {
    const m = scenesManifest()
    expect(m.commit).toMatch(/^f6b202c/)
    expect(m.scenes).not.toContain('flex.xml')
    expect(m.scenes.length).toBeGreaterThanOrEqual(16)
    expect(scenesChecksum()).toMatch(/^[0-9a-f]{16}$/)
  })

  it.each(listScenes())('%s — compiles and 100 steps stay finite', async (scene) => {
    const r = await mujocoSimulate(scene, { steps: 100, sampleEvery: 50 })
    expect(r.metrics.allFinite).toBe(true)
    expect(r.metrics.finalTime).toBeGreaterThan(0)
    expect(r.t.length).toBeGreaterThanOrEqual(3) // 0 + sampled + final
    expect(r.qpos[0].length).toBe(r.nq)
  }, 120_000)

  it('deterministic: identical inputs replay to identical numbers', async () => {
    const a = await mujocoSimulate('simple.xml', { steps: 200, sampleEvery: 100 })
    const b = await mujocoSimulate('simple.xml', { steps: 200, sampleEvery: 100 })
    expect(b.metrics.finalTime).toBe(a.metrics.finalTime)
    expect(b.metrics.qposNormFinal).toBeCloseTo(a.metrics.qposNormFinal, 12)
    expect(b.qpos.at(-1)!.map((v) => v.toFixed(12))).toEqual(a.qpos.at(-1)!.map((v) => v.toFixed(12)))
  })

  it('parameters reach mjModel.opt: weaker gravity changes the trajectory', async () => {
    const earth = await mujocoSimulate('simple.xml', { steps: 200, sampleEvery: 200 })
    const moon = await mujocoSimulate('simple.xml', { steps: 200, sampleEvery: 200, params: { gravityZ: -1.62 } })
    expect(moon.metrics.qposNormFinal).not.toBeCloseTo(earth.metrics.qposNormFinal, 3)
    // a falling-load scene drops slower under moon gravity
    expect(moon.metrics.comZFinal!).toBeGreaterThan(earth.metrics.comZFinal! - 1e-9)
  })

  it('input validation: unknown scene and absurd steps are rejected', async () => {
    await expect(mujocoSimulate('nope.xml', { steps: 10, sampleEvery: 5 })).rejects.toThrow(/unknown scene/)
    await expect(mujocoSimulate('simple.xml', { steps: 1e7, sampleEvery: 5 })).rejects.toThrow(/steps/)
  })
})

describe('Stage C — skill surface, provenance, lineage (through executeSkill)', () => {
  it('PlayPlan gate applies to mujoco.simulate', async () => {
    const out = await executeSkill('mujoco.simulate', { scene: 'simple.xml', steps: 10 })
    expect(out.status).toBe('needs_input')
  })

  it('a real run records engine/version/scene provenance and replays', async () => {
    const out = await executeSkill('mujoco.simulate', { scene: 'humanoid.xml', steps: 100, sampleEvery: 50 }, plan)
    expect(out.status).toBe('ok')
    if (out.status !== 'ok' || !out.run) return
    expect(out.run.engine).toBe('mujoco-wasm')
    expect(out.run.engineVersion).toBe('3.12.0')
    expect(out.run.spec.kind).toBe('mujoco.sim')
    expect((out.run.spec.model as { scene: string; scenesChecksum: string }).scene).toBe('humanoid.xml')
    expect((out.run.spec.model as { scenesChecksum: string }).scenesChecksum).toBe(scenesChecksum())
    expect((out.run.result as { metrics: { allFinite: boolean } }).metrics.allFinite).toBe(true)

    const replay = await replayRun(out.run.runId)
    expect(replay.status).toBe('ok')
    if (replay.status === 'ok' && replay.run) {
      const a = (out.run.result as { metrics: { qposNormFinal: number } }).metrics.qposNormFinal
      const b = (replay.run.result as { metrics: { qposNormFinal: number } }).metrics.qposNormFinal
      expect(b).toBeCloseTo(a, 12)
    }
  })

  it('fork doubles gravity INTO the child run (parent lineage kept)', async () => {
    const base = await executeSkill('mujoco.simulate', { scene: 'simple.xml', steps: 200, sampleEvery: 100, params: { gravityZ: -9.81 } }, plan)
    expect(base.status).toBe('ok')
    if (base.status !== 'ok' || !base.run) return
    const fork = await executeSkill('experiment.fork', {
      sourceRunId: base.run.runId,
      parameterChanges: { gravityZ: -19.62 },
    }, plan)
    expect(fork.status).toBe('ok')
    if (fork.status !== 'ok' || !fork.run) return
    expect(fork.run.parentRunId).toBe(base.run.runId)
    expect(fork.run.spec.params.gravityZ).toBe(-19.62)
    const baseNorm = (base.run.result as { metrics: { qposNormFinal: number } }).metrics.qposNormFinal
    const forkNorm = (fork.run.result as { metrics: { qposNormFinal: number } }).metrics.qposNormFinal
    expect(forkNorm).not.toBeCloseTo(baseNorm, 3) // stronger gravity ⇒ different physics
    expect(getExperimentRun(fork.run.runId)).toBeDefined()
    // unknown parameter names are refused (never silently ignored)
    const bad = await executeSkill('experiment.fork', { sourceRunId: base.run.runId, parameterChanges: { warp: 9 } }, plan)
    expect(bad.status).toBe('error')
  })
})

describe('Stage B — playback interface (pure machine; evidence stays in Runs)', () => {
  it('set_params clamps, pauses, and flags a needed simulate', () => {
    const s0 = initialPlayback('run-1')
    const { state, needsSimulate } = playbackCommand(s0, { op: 'set_params', params: { gravityZ: -1e9 } })
    expect(state.params.gravityZ).toBe(-100) // clamped
    expect(needsSimulate).toBe(true)
    const running = playbackCommand({ ...state, phase: 'running' }, { op: 'set_params', params: { windX: 3 } })
    expect(running.state.phase).toBe('paused') // changing params pauses playback
  })
  it('start requires an attached run; reset rewinds without touching the run', () => {
    const noRun = playbackCommand(initialPlayback(''), { op: 'start' })
    expect(noRun.state.phase).toBe('idle') // refused — nothing to play
    const s = playbackCommand({ ...initialPlayback('run-1'), phase: 'running', cursor: 7 }, { op: 'reset' })
    expect(s.state.cursor).toBe(0)
    expect(s.state.phase).toBe('idle')
  })
  it('export_run is a request — the machine itself produces no numbers', () => {
    const out = playbackCommand(initialPlayback('run-1'), { op: 'export_run' })
    expect(out.request).toBe('export_run')
    expect(out.state).toEqual(initialPlayback('run-1'))
  })
})
