// Packing Challenge (AGENTS.md v6 §9.7) — the differentiating gameplay.
// Rules: δ and direction count are FROZEN; the player drags tube packing
// (in 3D) to minimize finite-scale occupied volume. Every submission goes
// through the UNIFIED skill executor (`kakeya.measure`) — user and agent
// share one registered engine, zero privilege, runs recorded side by side.
import type { ExperimentRun } from '../experiments/protocol'
import { executeSkill } from '../skills/executor'
import type { VoxelResult } from '../kakeya/voxels3d'

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

export class ChallengeStore {
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
    this.attempts = []
    this.notify()
  }

  add(attempt: ChallengeAttempt) {
    const b = this.baseline
    if (!b || attempt.deltaExp !== b.deltaExp || attempt.nTubes !== b.nTubes || attempt.res !== b.res) throw new Error('Challenge conditions differ from the frozen baseline')
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

/** one real finite-scale measurement — ALWAYS via the unified skill executor */
export async function runChallengeMeasurement(
  deltaExp: number,
  nTubes: number,
  packing: number,
  res: number,
  parentRunId?: string,
): Promise<ExperimentRun<VoxelResult>> {
  const outcome = await executeSkill<VoxelResult>(
    'kakeya.measure',
    { deltaExp, nTubes, packing, res },
    { planId: `challenge:${deltaExp}/${nTubes}/${res}`, parentRunId },
  )
  if (outcome.status !== 'ok' || !outcome.run) {
    throw new Error(outcome.status === 'error' ? outcome.message : `kakeya.measure returned ${outcome.status}`)
  }
  return outcome.run as ExperimentRun<VoxelResult>
}

/** "Let Agent Try": deterministic search over the packing grid through the
 *  unified executor (kakeya.measure); records every probe as its own attempt.
 *  `store` is injectable for headless tests; defaults to the UI singleton. */
export async function agentTry(
  onProgress?: (done: number, total: number) => void,
  store: ChallengeStore = challengeStore,
): Promise<ChallengeAttempt | null> {
  const b = store.baseline
  if (!b) return null
  store.agentBusy = true
  store.notify()
  let best: ChallengeAttempt | null = null
  const total = AGENT_PACKING_CANDIDATES.length
  try {
  for (let i = 0; i < total; i++) {
    const packing = AGENT_PACKING_CANDIDATES[i]
    // agent attempts descend from the current best USER attempt — an
    // independent branch of the same experiment, never a mixed leaderboard
    const parent = store.best('user')?.runId
    const run = await runChallengeMeasurement(b.deltaExp, b.nTubes, packing, b.res, parent)
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
      store.add(attempt)
      if (!best || attempt.occupiedVolume < best.occupiedVolume) best = attempt
    }
    onProgress?.(i + 1, total)
  }
  } finally {
    store.agentBusy = false
    store.notify()
  }
  return best
}
