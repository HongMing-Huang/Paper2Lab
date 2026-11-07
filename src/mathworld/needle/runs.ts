// Needle Run records (CLI-129). Every accepted action and every solve becomes
// an immutable ExperimentRun through the PUBLIC protocol boundary
// (executeSpec → sealResult → frozen history) so export/import/finite gates
// all apply. Kinds 'needle.move'/'needle.solve' are NOT yet in the shared
// ExperimentKind union (registry/protocol are the integration owner's files) —
// they are cast here and listed as a minimal patch for serial integration;
// the protocol performs no runtime kind enumeration, so these runs remain
// fully valid ExperimentRun records.
import { executeSpec, type ExperimentKind, type ExperimentRun } from '../../experiments/protocol'
import { NEEDLE_GEOM_VERSION, type GoalCheck, type NeedleAction, type NeedleModel, type NeedleState, type Point, type SweepCertificate } from './model'
import type { SolveResult } from './solve'

const NEEDLE_ENGINE = { engine: 'needle-geom', version: NEEDLE_GEOM_VERSION }

export interface NeedleSource {
  kind: 'mathworld-needle'
  worldId: string
  worldDigest: string
  sessionId: string
  action: string
  revision: number
  actor: string
  note: string
}

const p2 = (p: Point): { x: number; y: number } => ({ x: round(p.x), y: round(p.y) })
const s2 = (s: NeedleState) => ({ cx: round(s.cx), cy: round(s.cy), k: s.k })
const round = (v: number) => Number(v.toFixed(12))

/** record one accepted action (or blocked/unknown attempt) as a needle.move Run */
export async function recordMoveRun(input: {
  world: NeedleModel
  source: NeedleSource
  actionId: string
  action: NeedleAction
  from: NeedleState
  outcome:
    | { status: 'accepted'; to: NeedleState; goal: GoalCheck }
    | { status: 'blocked' | 'unknown'; attempted: NeedleState }
  certificate: SweepCertificate
  parentRunId?: string
}): Promise<ExperimentRun> {
  const { world, source, actionId, action, from, outcome, certificate } = input
  return executeSpec(
    {
      kind: 'needle.move' as ExperimentKind,
      params: { cx: round(from.cx), cy: round(from.cy), k: from.k },
      seed: 0,
      model: {
        bounds: world.bounds, cell: world.cell, walls: world.walls, exit: world.exit,
        halfLen: world.halfLen, radius: world.radius, sweepBudget: world.sweepBudget,
        actionId, action,
      },
      source,
    },
    NEEDLE_ENGINE,
    () => ({
      actionId,
      from: s2(from),
      outcome:
        outcome.status === 'accepted'
          ? { status: 'accepted', to: s2(outcome.to), goal: { contained: outcome.goal.contained, oriented: outcome.goal.oriented, margins: outcome.goal.margins.map(round) } }
          : { status: outcome.status, attempted: s2(outcome.attempted) },
      certificate: {
        status: certificate.status,
        minClearance: round(certificate.minClearance),
        intervals: certificate.intervals,
        computeMs: round(certificate.computeMs),
        ...(certificate.blockedAt ? { blockedAt: { t: round(certificate.blockedAt.t), contact: p2(certificate.blockedAt.contact), source: certificate.blockedAt.source } } : {}),
      },
      policy: `整段运动界认证 L=‖Δc‖+h|Δθ|，安全余量 1e-9；${NEEDLE_GEOM_VERSION}`,
    }),
    { parentRunId: input.parentRunId },
  )
}

/** record a solver verification (witness replay-verified / unsat-in-finite-graph / unknown) */
export async function recordSolveRun(input: {
  world: NeedleModel
  source: NeedleSource
  start: NeedleState
  result: SolveResult
}): Promise<ExperimentRun> {
  const { world, source, start, result } = input
  return executeSpec(
    {
      kind: 'needle.solve' as ExperimentKind,
      params: { cx: round(start.cx), cy: round(start.cy), k: start.k },
      seed: 0,
      model: {
        bounds: world.bounds, cell: world.cell, walls: world.walls, exit: world.exit,
        halfLen: world.halfLen, radius: world.radius, solver: 'bfs-same-transition',
      },
      source,
    },
    NEEDLE_ENGINE,
    () => ({
      status: result.status,
      visited: result.status === 'solved' ? result.visited : result.visited,
      unknownEdges: result.unknownEdges,
      computeMs: round(result.computeMs),
      ...(result.status === 'solved'
        ? { pathLength: result.path.length, finalState: s2(result.finalState), minCertifiedClearance: round(result.minCertifiedClearance), replayVerified: true }
        : {}),
      ...(result.status === 'unknown' ? { reason: result.reason } : {}),
      policy: '与玩家同一 transition 的 BFS；见证须从起点重放复核；unknown≠无解；unsat 仅指本有限动作图',
    }),
    {},
  )
}
