// The single action transition (CLI-129 needle slice). Player input, solver
// edges and replay ALL go through applyAction — there is no second code path
// that could move the needle. Inputs carry the action identity; the world is
// frozen by the caller (session binds digest + revision); illegal geometry
// answers blocked/unknown and the caller keeps its last legal state.
import type { NeedleModel } from './model'
import {
  certifyAction,
  checkGoal,
  isOnLattice,
  nextState,
  staticClearance,
  SAFETY_EPS,
  type GoalCheck,
  type NeedleAction,
  type NeedleState,
  type SweepCertificate,
} from './model'

export type TransitionResult =
  | {
      status: 'accepted'
      from: NeedleState
      to: NeedleState
      certificate: SweepCertificate
      goal: GoalCheck
    }
  | {
      status: 'blocked'
      from: NeedleState
      /** the pose the action would have produced (display only) */
      attempted: NeedleState
      certificate: SweepCertificate
    }
  | {
      status: 'unknown'
      from: NeedleState
      attempted: NeedleState
      certificate: SweepCertificate
    }
  | {
      status: 'rejected'
      from: NeedleState
      reason: string
    }

/** apply one action at state q — the ONE transition everything shares */
export function applyAction(m: NeedleModel, q: NeedleState, a: NeedleAction): TransitionResult {
  const latticeErr = isOnLattice(m, q)
  if (latticeErr) return { status: 'rejected', from: q, reason: `当前状态非法：${latticeErr}` }
  if (a.type === 'move' && (a.dx === 0) === (a.dy === 0)) {
    return { status: 'rejected', from: q, reason: '平移动作必须恰好沿一个轴移动一格' }
  }
  if (a.type === 'rotate' && a.dir !== 1 && a.dir !== -1) {
    return { status: 'rejected', from: q, reason: '旋转动作必须是 ±1 档' }
  }
  const attempted = nextState(m, q, a)
  const outErr = isOnLattice(m, attempted)
  if (outErr) return { status: 'rejected', from: q, reason: `目标状态非法：${outErr}` }
  const cert = certifyAction(m, q, a)
  if (cert.status === 'blocked') return { status: 'blocked', from: q, attempted, certificate: cert }
  if (cert.status === 'unknown') return { status: 'unknown', from: q, attempted, certificate: cert }
  return { status: 'accepted', from: q, to: cert.next, certificate: cert, goal: checkGoal(m, cert.next) }
}

/** static legality of a pose (level validation / restore gate): on-lattice
 *  and strictly clear of contact. Contact (≤ SAFETY_EPS) is not safe. */
export function staticallySafe(m: NeedleModel, q: NeedleState): { ok: boolean; clearance: number; source: string } {
  const err = isOnLattice(m, q)
  if (err) return { ok: false, clearance: NaN, source: err }
  const d = staticClearance(m, q)
  return { ok: d.clearance > SAFETY_EPS, clearance: d.clearance, source: d.source }
}
