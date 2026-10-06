// Playable 0.1 — three challenge levels, headless acceptance:
//   success AND failure cases per level · deterministic replay · spec ranges
//   · shared budget between user and agent · retry after failure · best
//   record · save/restore · scores read only from computed results
import { beforeAll, describe, expect, it } from 'vitest'
import '../challenges/registerChallengeRunner'
import { executeSkill, replayRun } from '../skills/executor'
import {
  runChallenge, validateSpec, projectileMjcf,
  type ProjectileResult, type PendulumResult, type TubesResult, type ProjectileSpec, type PendulumSpec, type TubesSpec,
} from './kernel'
import { attempt, createLevel, deriveSpec, loadLevel, saveLevel, type ChallengeExecutor } from './store'

/** local-kernel executor (headless tests run the REAL kernels in-process) */
const localExec: ChallengeExecutor = async (spec) => ({ result: await runChallenge(spec), runId: null })

const plan = { planId: 'plan-challenges' }
const PROJ: ProjectileSpec = { kind: 'projectile', angleDeg: 30, speed: 10, gravity: 9.81, targetX: 22.9, tolerance: 0.5 }
const PEND: PendulumSpec = { kind: 'pendulum', length: 0.6, angleDeg: 25, gravity: 9.81, targetPeriod: 2.0, tolerance: 0.05 }
const TUBES: TubesSpec = { kind: 'tubes', offsets: [0, 0, 0, 0], nTubes: 32, deltaExp: 4, res: 24, budget: 0.19 }

beforeAll(async () => {
  // boot wasm once for the MJCF levels
  await runChallenge(PROJ)
}, 180_000)

describe('projectile — hit / miss / real trajectory', () => {
  it('success: 45° × 15 m/s lands within tolerance (real MuJoCo flight)', async () => {
    const r = (await runChallenge({ ...PROJ, angleDeg: 45, speed: 15 })) as ProjectileResult
    expect(r.kind).toBe('projectile')
    expect(r.x.length).toBeGreaterThan(50) // real sampled trajectory
    expect(r.hit).toBe(true)
    expect(r.error).toBeLessThanOrEqual(r.tolerance)
    expect(r.score).toBeGreaterThan(1000) // hit bonus
  })
  it('failure: 10° × 10 m/s falls short — feedback carries the measured error', async () => {
    const r = (await runChallenge({ ...PROJ, angleDeg: 10, speed: 10 })) as ProjectileResult
    expect(r.hit).toBe(false)
    expect(r.error).toBeGreaterThan(r.tolerance)
    // physics sanity: 10°/10 m/s lands near v²sin2θ/g ≈ 3.5 m → far from 22.9
    expect(r.landingX).toBeLessThan(8)
  })
  it('trajectory obeys gravity: apex time ≈ vz/g within integration error', async () => {
    const spec = { ...PROJ, angleDeg: 60, speed: 20 }
    const r = (await runChallenge(spec)) as ProjectileResult
    const rad = (60 * Math.PI) / 180
    const vz = Math.sin(rad) * spec.speed
    const apexIdx = r.z.indexOf(Math.max(...r.z))
    expect(Math.abs(r.t[apexIdx] - vz / spec.gravity)).toBeLessThan(0.05)
  })
  it('MJCF is entity-free and carries the launch keyframe', () => {
    const xml = projectileMjcf(PROJ)
    expect(xml).not.toMatch(/<!DOCTYPE|<!ENTITY/i)
    expect(xml).toMatch(/<key name="launch"/)
  })
})

describe('pendulum — measured period matches / mismatches', () => {
  it('success: L≈0.994 measures T≈2.0 (measured from the swing)', async () => {
    const r = (await runChallenge({ ...PEND, length: 0.994 })) as PendulumResult
    expect(r.kind).toBe('pendulum')
    expect(r.measuredPeriod).not.toBeNull()
    expect(r.measuredPeriod!).toBeGreaterThan(1.95)
    expect(r.measuredPeriod!).toBeLessThan(2.05)
    expect(r.matched).toBe(true)
  })
  it('failure: L=0.5 measures T≈1.43 — mismatch feedback with the delta', async () => {
    const r = (await runChallenge({ ...PEND, length: 0.5 })) as PendulumResult
    expect(r.measuredPeriod!).toBeCloseTo(1.43, 1)
    expect(r.matched).toBe(false)
    expect(r.error!).toBeGreaterThan(PEND.tolerance)
  })
  it('period scales with √L (real physics, not a formula)', async () => {
    const t1 = (await runChallenge({ ...PEND, length: 0.5 })) as PendulumResult
    const t2 = (await runChallenge({ ...PEND, length: 1.0 })) as PendulumResult
    expect(t2.measuredPeriod! / t1.measuredPeriod!).toBeCloseTo(Math.SQRT2, 2)
  })
})

describe('tubes — per-cluster compression beats / misses budget', () => {
  it('clustering all offsets to 1 shrinks the union below the scattered one', async () => {
    const scattered = (await runChallenge({ ...TUBES, offsets: [0, 0.1, 0.2, 0.3] })) as TubesResult
    const packed = (await runChallenge({ ...TUBES, offsets: [1, 1, 1, 1] })) as TubesResult
    expect(packed.occupiedVolume).toBeLessThan(scattered.occupiedVolume)
    expect(packed.withinBudget || packed.occupiedVolume <= TUBES.budget + 0.02).toBe(true)
  })
  it('per-cluster offsets differ from one global packing scalar', async () => {
    // mixed offsets give a DIFFERENT volume than any single value
    const mixed = (await runChallenge({ ...TUBES, offsets: [0, 1, 0, 1] })) as TubesResult
    const all0 = (await runChallenge({ ...TUBES, offsets: [0, 0, 0, 0] })) as TubesResult
    const all1 = (await runChallenge({ ...TUBES, offsets: [1, 1, 1, 1] })) as TubesResult
    expect(mixed.occupiedVolume).not.toBe(all0.occupiedVolume)
    expect(mixed.occupiedVolume).not.toBe(all1.occupiedVolume)
  })
})

describe('spec validation (ranges before any compute)', () => {
  it('rejects out-of-range params for every level', () => {
    expect(validateSpec({ ...PROJ, angleDeg: 95 })).toMatch(/angleDeg/)
    expect(validateSpec({ ...PROJ, speed: 99 })).toMatch(/speed/)
    expect(validateSpec({ ...PEND, length: 0.05 })).toMatch(/length/)
    expect(validateSpec({ ...TUBES, offsets: [1.5] })).toMatch(/offset/)
    expect(validateSpec({ ...TUBES, nTubes: 4 })).toMatch(/nTubes/)
  })
})

describe('skill surface + replay determinism', () => {
  it('challenge.attempt is plan-gated and produces a run of kind challenge.attempt', async () => {
    const gate = await executeSkill('challenge.attempt', { challenge: 'projectile', changes: {} })
    expect(gate.status).toBe('needs_input')
    const out = await executeSkill('challenge.attempt', { challenge: 'projectile', changes: { angleDeg: 45, speed: 15 } }, plan)
    expect(out.status).toBe('ok')
    if (out.status !== 'ok' || !out.run) return
    expect(out.run.spec.kind).toBe('challenge.attempt')
    expect(out.run.engine).toBe('challenge-kernel')
    const replay = await replayRun(out.run.runId)
    expect(replay.status).toBe('ok')
    const strip = (r: unknown) => JSON.stringify(r, (k, v) => (k === 'runId' ? undefined : v))
    if (replay.status === 'ok' && replay.run) expect(strip(replay.run.result)).toBe(strip(out.run.result))
  })
  it('all three levels replay to identical results', async () => {
    for (const [challenge, changes] of [
      ['projectile', { angleDeg: 52, speed: 14 }],
      ['pendulum', { length: 1.2 }],
      ['tubes', { offsets: [0.3, 0.7, 0.1, 0.9] }],
    ] as const) {
      const a = await executeSkill('challenge.attempt', { challenge, changes }, plan)
      if (a.status !== 'ok' || !a.run) throw new Error(`${challenge}: attempt failed`)
      const b = await replayRun(a.run.runId)
      const strip = (r: unknown) => JSON.stringify(r, (k, v) => (k === 'runId' ? undefined : v))
      expect(b.status, challenge).toBe('ok')
      if (b.status === 'ok' && b.run) expect(strip(b.run.result)).toBe(strip(a.run!.result))
    }
  })
})

describe('store — shared budget, retry, best record, save/restore', () => {
  it('user and agent share ONE budget; failures still consume it; best tracked per actor', async () => {
    const state = createLevel(PEND, 4)
    // user fails (L=0.5 far off)
    const miss = await attempt(state, 'user', { length: 0.5 }, localExec)
    expect((miss.result as PendulumResult | null)?.matched).toBe(false)
    // agent fails too (invalid length → compute error, budget still spent)
    await expect(attempt(state, 'agent', { length: 99 }, localExec)).rejects.toThrow(/length/)
    expect(state.budgetRemaining).toBe(2)
    // user retries and matches
    const hit = await attempt(state, 'user', { length: 0.994 }, localExec)
    expect((hit.result as PendulumResult | null)?.matched).toBe(true)
    expect(state.solved).toBe(true)
    expect(state.bestByActor.user).toBe(hit.score)
    expect(state.bestByActor.agent).toBe(0)
    // budget exhausted → explicit error, no silent skip
    await attempt(state, 'agent', { length: 1.0 }, localExec)
    await expect(attempt(state, 'user', { length: 0.994 }, localExec)).rejects.toThrow(/budget exhausted/)
  })
  it('deriveSpec keeps the frozen goal/constraints; only the manipulable surface moves', () => {
    const s = deriveSpec(PROJ, { angleDeg: 60 }) as ProjectileSpec
    expect(s.targetX).toBe(PROJ.targetX) // frozen
    expect(s.tolerance).toBe(PROJ.tolerance)
    expect(s.angleDeg).toBe(60)
    const t = deriveSpec(TUBES, { offsets: [1, 1, 1, 1] }) as TubesSpec
    expect(t.nTubes).toBe(TUBES.nTubes)
    expect(t.budget).toBe(TUBES.budget)
  })
  it('save/restore round-trips the attempt history', async () => {
    const state = createLevel(PROJ, 10)
    await attempt(state, 'user', { angleDeg: 45, speed: 15 }, localExec)
    const text = saveLevel(state)
    const restored = loadLevel(text)
    expect(restored.attempts).toHaveLength(1)
    expect(restored.bestScore).toBe(state.bestScore)
    expect(restored.budgetRemaining).toBe(9)
    expect((restored.attempts[0].result as { hit: boolean }).hit).toBe(true)
  })
})
