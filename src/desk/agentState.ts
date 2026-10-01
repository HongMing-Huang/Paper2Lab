// AgentState (AGENTS.md v6 §15 layer 3) — what the orchestrator is doing to
// WHICH paper right now. The canvas renders phases, never "AI is thinking…":
// plan → RUNNING → LOCAL COMPUTE · Nms → CALCULATED, driven by server events.
export type AgentPhase =
  | { kind: 'idle' }
  | { kind: 'plan'; goal: string; skill: string }
  | { kind: 'running'; tool: string }
  | { kind: 'computed'; runId: string; durationMs: number }
  | { kind: 'error'; message: string }

export interface AgentUiState {
  phase: AgentPhase
  /** the explorer/experiment the current agent turn is working on */
  explorerId: string | null
  /** last short observation (AI_INFERENCE, cites run ids) */
  observation: string | null
  /** active PlayPlan (FAROS-style contract) for display/trace */
  plan: { planId: string; goal: string; skill: string; metrics: string[]; nonClaims: string[] } | null
  nonce: number
}

class AgentStateStore {
  private state: AgentUiState = { phase: { kind: 'idle' }, explorerId: null, observation: null, plan: null, nonce: 0 }
  private listeners = new Set<() => void>()

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getSnapshot = () => this.state

  set(patch: Partial<Omit<AgentUiState, 'nonce'>>) {
    this.state = { ...this.state, ...patch, nonce: this.state.nonce + 1 }
    for (const l of this.listeners) l()
  }
  reset() {
    this.set({ phase: { kind: 'idle' }, explorerId: null })
  }
}

export const agentState = new AgentStateStore()
