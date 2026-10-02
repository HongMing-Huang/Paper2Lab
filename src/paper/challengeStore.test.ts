import { describe, expect, it } from 'vitest'
import { ChallengeStore, runChallengeMeasurement, agentTry, AGENT_PACKING_CANDIDATES } from './challengeStore'
import { getExperimentRun, listExperimentRuns } from '../experiments/protocol'

describe('fair challenge baselines', () => {
  it('rejects runs with different N/delta/res and clears scores for a new baseline', () => {
    const store = new ChallengeStore()
    store.start(4, 96, 48)
    const row = { by: 'user' as const, deltaExp: 4, nTubes: 96, res: 48, packing: 1, runId: 'r', occupiedVolume: 1, maxMultiplicity: 1, durationMs: 1, at: 0 }
    store.add(row)
    expect(() => store.add({ ...row, nTubes: 48 })).toThrow()
    expect(() => store.add({ ...row, deltaExp: 5 })).toThrow()
    expect(() => store.add({ ...row, res: 64 })).toThrow()
    store.start(5, 96, 48)
    expect(store.best('user')).toBeNull()
  })
})

describe('challenge execution (real kernel through the unified executor)', () => {
  it('every measurement is a REAL kakeya.voxel run in the shared history', async () => {
    const run = await runChallengeMeasurement(4, 16, 0.5, 12)
    expect(run.spec.kind).toBe('kakeya.voxel')
    expect(run.spec.params).toEqual({ deltaExp: 4, packing: 0.5, nTubes: 16 })
    expect(run.spec.res).toBe(12)
    expect(run.spec.seed).toBe(20250224)
    expect(getExperimentRun(run.runId)).toBeTruthy()
    expect(run.result!.occupiedVolume).toBeGreaterThan(0)
    expect(run.result!.maxMultiplicity).toBeLessThanOrEqual(16)
  })

  it('agentTry probes the full grid, keeps every run, and descends from the user best', async () => {
    const store = new ChallengeStore()
    store.start(3, 12, 10)
    // user scores one attempt first
    const userRun = await runChallengeMeasurement(3, 12, 0.2, 10)
    store.add({
      by: 'user', deltaExp: 3, nTubes: 12, packing: 0.2, res: 10,
      runId: userRun.runId, occupiedVolume: userRun.result!.occupiedVolume,
      maxMultiplicity: userRun.result!.maxMultiplicity, durationMs: userRun.durationMs, at: Date.now(),
    })
    const voxelsBefore = listExperimentRuns({ kind: 'kakeya.voxel', limit: 1000 }).length

    const agentBest = await agentTry(undefined, store)

    const attempts = store.attempts
    const agentAttempts = attempts.filter((a) => a.by === 'agent')
    expect(agentAttempts).toHaveLength(AGENT_PACKING_CANDIDATES.length)
    for (const a of agentAttempts) {
      const run = getExperimentRun(a.runId)
      expect(run).toBeTruthy() // every probe kept as a real run
      expect(run!.parentRunId).toBe(userRun.runId) // independent branch of the user best
    }
    expect(agentBest).not.toBeNull()
    expect(agentBest!.occupiedVolume).toBeLessThanOrEqual(agentAttempts[0].occupiedVolume + 1e-12)
    // real voxel runs were produced for the whole grid
    const voxelsAfter = listExperimentRuns({ kind: 'kakeya.voxel', limit: 1000 }).length
    expect(voxelsAfter - voxelsBefore).toBe(AGENT_PACKING_CANDIDATES.length)
  })
})
