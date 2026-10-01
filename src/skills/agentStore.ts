// Agent run state: the structured action strip shown on the paper.
import type { AgentAction, ExperimentPlan } from './planner'

export interface AgentRunState {
  plan: ExperimentPlan | null
  statuses: Array<'pending' | 'running' | 'done' | 'error'>
  reading: string | null
  startedAt: number | null
}

let state: AgentRunState = { plan: null, statuses: [], reading: null, startedAt: null }
const listeners = new Set<() => void>()

export const agentStore = {
  subscribe(cb: () => void): () => void {
    listeners.add(cb)
    return () => {
      listeners.delete(cb)
    }
  },
  get(): AgentRunState {
    return state
  },
  start(plan: ExperimentPlan) {
    state = { plan, statuses: plan.actions.map(() => 'pending'), reading: null, startedAt: Date.now() }
    for (const cb of listeners) cb()
  },
  setStatus(i: number, s: 'pending' | 'running' | 'done' | 'error') {
    state = { ...state, statuses: state.statuses.map((v, k) => (k === i ? s : v)) }
    for (const cb of listeners) cb()
  },
  finish(reading: string | null) {
    state = { ...state, reading }
    for (const cb of listeners) cb()
  },
  clear() {
    state = { plan: null, statuses: [], reading: null, startedAt: null }
    for (const cb of listeners) cb()
  },
}

export type { AgentAction }
