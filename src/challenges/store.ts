// Challenge store — per-level attempt history with best record, retry and
// save/restore. Scores/hits read ONLY from computed ChallengeResults; the
// store records, it never computes: every attempt runs through an EXECUTOR
// (the page uses the backend engine — same kernels the agent uses — and the
// result lands as an imported ExperimentRun; tests run the local kernel).
import type { ChallengeResult, SceneSpec } from './levels'

/** executes one spec → {result, runId}; throws on failure */
export type ChallengeExecutor = (spec: SceneSpec) => Promise<{ result: ChallengeResult; runId: string | null }>
// (named runAttempt at call sites — this is a typed compute callback, NOT
// child_process.exec; there is no shell anywhere in this module)

export interface AttemptRecord {
  attemptId: string
  /** which run of the level this attempt answered (null when execution failed) */
  runId: string | null
  actor: 'user' | 'agent'
  spec: SceneSpec
  result: ChallengeResult | null
  score: number
  createdAt: number
}

export interface LevelState {
  kind: SceneSpec['kind']
  /** the frozen level definition (goal/constraints/budget) */
  level: SceneSpec
  attempts: AttemptRecord[]
  bestScore: number
  bestByActor: { user: number; agent: number }
  solved: boolean
  /** computation budget: attempts allowed (user + agent share it) */
  budgetRemaining: number
}

const clone = (s: SceneSpec): SceneSpec => JSON.parse(JSON.stringify(s))

export function createLevel(level: SceneSpec, budget = 20): LevelState {
  return {
    kind: level.kind,
    level: clone(level),
    attempts: [],
    bestScore: 0,
    bestByActor: { user: 0, agent: 0 },
    solved: false,
    budgetRemaining: budget,
  }
}

let attemptSeq = 0
function nextAttemptId(actor: AttemptRecord['actor']): string {
  attemptSeq += 1
  return `attempt-${actor}-${Date.now().toString(36)}-${attemptSeq.toString(36)}`
}

/** apply a param delta to a FROZEN level (the manipulable surface per kind) */
export function deriveSpec(
  level: SceneSpec,
  changes: Record<string, number | number[]>,
): SceneSpec {
  const spec = clone(level)
  if (spec.kind === 'projectile') {
    if (typeof changes.angleDeg === 'number') spec.angleDeg = changes.angleDeg
    if (typeof changes.speed === 'number') spec.speed = changes.speed
  } else if (spec.kind === 'pendulum') {
    if (typeof changes.length === 'number') spec.length = changes.length
    if (typeof changes.angleDeg === 'number') spec.angleDeg = changes.angleDeg
  } else {
    if (Array.isArray(changes.offsets)) {
      const o = changes.offsets.map((v) => Math.min(1, Math.max(0, v)))
      spec.offsets = o
    } else if (typeof changes.offset === 'number' && typeof changes.cluster === 'number') {
      const i = Math.floor(changes.cluster)
      if (i >= 0 && i < spec.offsets.length) {
        spec.offsets = spec.offsets.map((v, k) => (k === i ? Math.min(1, Math.max(0, changes.offset as number)) : v))
      }
    }
  }
  return spec
}

/**
 * Run ONE attempt under the shared budget. Records the outcome whatever it
 * is (failure included); returns the record. Budget exhausted → explicit
 * error, never a silent skip.
 */
export async function attempt(
  state: LevelState,
  actor: AttemptRecord['actor'],
  changes: Record<string, number | number[]>,
  runAttempt: ChallengeExecutor,
): Promise<AttemptRecord> {
  if (state.budgetRemaining <= 0) {
    throw new Error('challenge budget exhausted — start a new level')
  }
  const spec = deriveSpec(state.level, changes)
  const record: AttemptRecord = {
    attemptId: nextAttemptId(actor),
    runId: null,
    actor,
    spec,
    result: null,
    score: 0,
    createdAt: Date.now(),
  }
  try {
    const { result, runId } = await runAttempt(spec)
    record.result = result
    record.runId = runId
    record.score = result.score
    if (record.score > state.bestScore) state.bestScore = record.score
    if (record.score > state.bestByActor[actor]) state.bestByActor[actor] = record.score
    const solved =
      record.result.kind === 'projectile' ? record.result.hit
      : record.result.kind === 'pendulum' ? record.result.matched
      : record.result.withinBudget
    if (solved) state.solved = true
  } catch (err) {
    // compute failed (invalid spec / engine error): the attempt still counts
    // against the budget — retry feedback is the error message itself
    state.attempts.push(record)
    state.budgetRemaining -= 1
    throw err
  }
  state.attempts.push(record)
  state.budgetRemaining -= 1
  return record
}

/** save/restore (challenge sessions survive restarts via the run log) */
export function saveLevel(state: LevelState): string {
  return JSON.stringify(state)
}
export function loadLevel(text: string): LevelState {
  const s = JSON.parse(text) as LevelState
  if (!s.level || !Array.isArray(s.attempts)) throw new Error('corrupt level state')
  return s
}
