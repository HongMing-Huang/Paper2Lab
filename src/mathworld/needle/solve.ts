// Same-rules solver (CLI-129 needle slice). BFS over the finite lattice×
// notch graph using EXACTLY the player's applyAction for every edge; the
// witness is then REPLAYED from the start through the same transition — the
// solver's terminal state or "solved" flag is never trusted. Exhausted queue
// with zero unknown edges = unsat IN THIS FINITE ACTION GRAPH (never claimed
// for the continuous plane); any unknown edge or timeout = unknown.
import { applyAction } from './transition'
import { checkGoal, NEEDLE_ACTIONS, stateKey, type NeedleAction, type NeedleModel, type NeedleState, type SweepCertificate } from './model'

export interface SolveEdge { from: string; actionId: string; status: 'accepted' | 'blocked' | 'unknown' }

export type SolveResult =
  | {
      status: 'solved'
      path: string[] /** action ids from start */
      finalState: NeedleState
      minCertifiedClearance: number
      visited: number
      unknownEdges: number
      replayVerified: true
      computeMs: number
    }
  | {
      /** queue exhausted, every edge decided, goal unreachable */
      status: 'unsat-in-finite-graph'
      visited: number
      unknownEdges: 0
      computeMs: number
    }
  | {
      status: 'unknown'
      visited: number
      unknownEdges: number
      reason: 'unknown-edges' | 'budget'
      computeMs: number
    }

export interface SolveOpts {
  maxNodes?: number
  timeMs?: number
}

export function solveNeedle(m: NeedleModel, start: NeedleState, opts: SolveOpts = {}): SolveResult {
  const t0 = performance.now()
  const maxNodes = opts.maxNodes ?? 20000
  const timeMs = opts.timeMs ?? 4000
  const byId = new Map<string, NeedleAction>(NEEDLE_ACTIONS.map((a) => [a.id, a.action]))
  const visited = new Set<string>([stateKey(start)])
  const parent = new Map<string, { key: string; actionId: string }>()
  let unknownEdges = 0
  const queue: NeedleState[] = [start]
  while (queue.length > 0) {
    if (performance.now() - t0 > timeMs || visited.size > maxNodes) {
      return { status: 'unknown', visited: visited.size, unknownEdges, reason: 'budget', computeMs: performance.now() - t0 }
    }
    const q = queue.shift()!
    for (const { id } of NEEDLE_ACTIONS) {
      const action = byId.get(id)!
      const r = applyAction(m, q, action)
      if (r.status === 'unknown') {
        unknownEdges++
        if (unknownEdges > 64) return { status: 'unknown', visited: visited.size, unknownEdges, reason: 'unknown-edges', computeMs: performance.now() - t0 }
        continue
      }
      if (r.status !== 'accepted') continue
      const key = stateKey(r.to)
      if (visited.has(key)) continue
      visited.add(key)
      parent.set(key, { key: stateKey(q), actionId: id })
      if (r.goal.contained && r.goal.oriented) {
        // witness found — VERIFY by replaying from the start through the SAME transition
        const path: string[] = []
        let cur = key
        while (parent.has(cur)) {
          const p = parent.get(cur)!
          path.push(p.actionId)
          cur = p.key
        }
        path.reverse()
        const replay = replayPath(m, start, path)
        if (replay.status === 'verified') {
          return {
            status: 'solved', path, finalState: replay.finalState,
            minCertifiedClearance: replay.minClearance,
            visited: visited.size, unknownEdges, replayVerified: true,
            computeMs: performance.now() - t0,
          }
        }
        // replay disagreed: the witness is invalid — treat as unknown, do not ship it
        return { status: 'unknown', visited: visited.size, unknownEdges: unknownEdges + 1, reason: 'unknown-edges', computeMs: performance.now() - t0 }
      }
      queue.push(r.to)
    }
  }
  if (unknownEdges > 0) {
    return { status: 'unknown', visited: visited.size, unknownEdges, reason: 'unknown-edges', computeMs: performance.now() - t0 }
  }
  return { status: 'unsat-in-finite-graph', visited: visited.size, unknownEdges: 0, computeMs: performance.now() - t0 }
}

export type ReplayResult =
  | { status: 'verified'; finalState: NeedleState; steps: number; minClearance: number; certificates: SweepCertificate[] }
  | { status: 'invalid'; step: number; actionId: string; reason: string; legalState: NeedleState }

/** replay an action-id path from a start state through the SAME transition;
 *  goal is recomputed by the caller — replay never grants it */
export function replayPath(m: NeedleModel, start: NeedleState, path: string[]): ReplayResult {
  const byId = new Map<string, NeedleAction>(NEEDLE_ACTIONS.map((a) => [a.id, a.action]))
  let q = start
  let minClearance = Infinity
  const certificates: SweepCertificate[] = []
  for (let i = 0; i < path.length; i++) {
    const actionId = path[i]!
    const action = byId.get(actionId)
    if (!action) return { status: 'invalid', step: i, actionId, reason: `未知动作 ${actionId}`, legalState: q }
    const r = applyAction(m, q, action)
    if (r.status === 'accepted') {
      q = r.to
      minClearance = Math.min(minClearance, r.certificate.minClearance)
      certificates.push(r.certificate)
    } else {
      const reason = r.status === 'rejected' ? r.reason : `${r.status}（净距 ${r.certificate.minClearance.toFixed(4)}）`
      return { status: 'invalid', step: i, actionId, reason, legalState: q }
    }
  }
  return { status: 'verified', finalState: q, steps: path.length, minClearance: minClearance === Infinity ? 0 : minClearance, certificates }
}

export { checkGoal, stateKey }
