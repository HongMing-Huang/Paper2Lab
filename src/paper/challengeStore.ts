// Packing Challenge (AGENTS.md v6 §9.7) — the differentiating gameplay.
// Rules: δ and direction count are FROZEN; the player drags tube packing
// (in 3D) to minimize finite-scale occupied volume. Every submission is a
// real ExperimentRun from the SAME engine the UI uses. "Let Agent Try" runs
// an automated parameter search through the very same worker — no privileged
// compute, runs recorded side by side.
import { executeSpec, ENGINES, type ExperimentRun } from '../experiments/protocol'
import { fibonacciDirections } from '../kakeya/directions'
import { makeTubes, type Tube3 } from '../kakeya/tubes'
import type { VoxelResult } from '../kakeya/voxels3d'
import { isWorkerAvailable, measureVoxelCover } from '../workers/voxelClient'
import { computeVoxelCoverage } from '../kakeya/voxels3d'

export interface ChallengeAttempt {
  by: 'user' | 'agent'
  /** frozen challenge baseline */
  deltaExp: number
  nTubes: number
  packing: number
  res: number
  runId: string
  occupiedVolume: number
  maxMultiplicity: number
  durationMs: number
  at: number
}

/** agent search grid over packing — same engine, zero privilege */
export const AGENT_PACKING_CANDIDATES = [1.0, 0.95, 0.9, 0.85, 0.8]

class ChallengeStore {
  attempts: ChallengeAttempt[] = []
  /** the frozen baseline when a challenge starts */
  baseline: { deltaExp: number; nTubes: number; res: number } | null = null
  agentBusy = false
  /** bumped on every mutation — useSyncExternalStore snapshot */
  version = 0
  private listeners = new Set<() => void>()

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  notify() {
    this.version++
    for (const l of this.listeners) l()
  }

  start(deltaExp: number, nTubes: number, res: number) {
    this.baseline = { deltaExp, nTubes, res }
    this.notify()
  }

  add(attempt: ChallengeAttempt) {
    this.attempts = [...this.attempts, attempt]
    this.notify()
  }

  best(by: 'user' | 'agent'): ChallengeAttempt | null {
    const mine = this.attempts.filter((a) => a.by === by)
    if (mine.length === 0) return null
    return mine.reduce((b, a) => (a.occupiedVolume < b.occupiedVolume ? a : b))
  }
}

export const challengeStore = new ChallengeStore()

/** one real finite-scale measurement through the shared engine */
export async function runChallengeMeasurement(
  deltaExp: number,
  nTubes: number,
  packing: number,
  res: number,
): Promise<ExperimentRun<VoxelResult>> {
  const delta = 2 ** -deltaExp
  const dirs = fibonacciDirections(nTubes)
  const tubes: Tube3[] = makeTubes(dirs, delta, packing)
  return executeSpec(
    { kind: 'kakeya.voxel', params: { deltaExp, packing, nTubes }, seed: 20250224, res },
    ENGINES.kakeyaWorker,
    () =>
      isWorkerAvailable()
        ? measureVoxelCover(tubes, res, 16)
        : computeVoxelCoverage(tubes, res, 16),
  )
}

/** "Let Agent Try": deterministic search over the packing grid using the
 *  same worker; records every probe as its own attempt. */
export async function agentTry(
  onProgress?: (done: number, total: number) => void,
): Promise<ChallengeAttempt | null> {
  const b = challengeStore.baseline
  if (!b) return null
  challengeStore.agentBusy = true
  challengeStore.notify()
  let best: ChallengeAttempt | null = null
  const total = AGENT_PACKING_CANDIDATES.length
  for (let i = 0; i < total; i++) {
    const packing = AGENT_PACKING_CANDIDATES[i]
    const run = await runChallengeMeasurement(b.deltaExp, b.nTubes, packing, b.res)
    if (run.result) {
      const attempt: ChallengeAttempt = {
        by: 'agent',
        deltaExp: b.deltaExp,
        nTubes: b.nTubes,
        packing,
        res: b.res,
        runId: run.runId,
        occupiedVolume: run.result.occupiedVolume,
        maxMultiplicity: run.result.maxMultiplicity,
        durationMs: run.durationMs,
        at: Date.now(),
      }
      challengeStore.add(attempt)
      if (!best || attempt.occupiedVolume < best.occupiedVolume) best = attempt
    }
    onProgress?.(i + 1, total)
  }
  challengeStore.agentBusy = false
  challengeStore.notify()
  return best
}
