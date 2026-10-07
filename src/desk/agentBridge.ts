// Agent bridge (AGENTS.md v6 §10-§12): the ONLY channel from the Research
// Orchestrator (server/agent.py, AgentScope or deterministic SOP) to the
// desk. Server streams normalized events over SSE; when it needs real
// computation it emits require_execution — the BROWSER executes registered
// scientific skills / canvas ops (the single source of CALCULATED numbers)
// and posts the result back, resuming the agent. No prose-driven UI, ever.

export interface AgentSseEvent {
  type: string
  plan?: { planId: string; goal: string; skill: string; metrics: string[]; nonClaims: string[] }
  tool?: string
  toolCallId?: string
  replyId?: string
  /** #29 provider truth — the first event of an AI-backend turn */
  provider?: string
  model?: string | null
  backend?: string
  aiVerified?: boolean
  /** #29 explicit SOP fallback + done events — reason travels in-band */
  /** Lane B round token — echoed back on resume; stale rounds are rejected */
  roundId?: string
  args?: { deskKind?: 'formula' | 'kakeya'; steps?: Array<Record<string, unknown>>; ops?: Array<Record<string, unknown>> }
  runId?: string
  parentRunId?: string
  durationMs?: number
  metrics?: Record<string, number>
  comparison?: unknown
  text?: string
  evidence?: string
  reason?: string
  message?: string
  /** experiment_failed events: what went wrong in the external execution */
  error?: string
}

export interface DeskAgentContext {
  deskKind: 'formula' | 'kakeya'
  paperTitle: string
  /** formula desk: parameter names · kakeya desk: deltaExp/nTubes/packing */
  params: string[]
  paramValues?: Record<string, number>
  selectedRunId?: string | null
  anchorId?: string | null
}

export interface AgentExecutors {
  /** run the real scientific steps locally (same engine as the UI); returns
   *  the payload the agent receives — runs with ids, never prose numbers */
  scientificExecute: (args: NonNullable<AgentSseEvent['args']>) => Promise<unknown>
  /** apply structured canvas ops (compare / highlight-source / focus / fork) */
  canvasApply: (ops: Array<Record<string, unknown>>) => Promise<unknown>
  onEvent?: (e: AgentSseEvent) => void
}

/** parse one SSE chunk into event objects (split lines starting with `data: `) */
export function parseSseChunk(chunk: string): AgentSseEvent[] {
  const out: AgentSseEvent[] = []
  for (const line of chunk.split('\n')) {
    const t = line.trim()
    if (t.startsWith('data: ')) {
      try {
        out.push(JSON.parse(t.slice(6)) as AgentSseEvent)
      } catch {
        /* ignore malformed frame */
      }
    }
  }
  return out
}

let sessionSeq = 0
export function newAgentSessionId(): string {
  return `desk-${Date.now().toString(36)}-${(sessionSeq++).toString(36)}`
}

async function* streamTurn(body: Record<string, unknown>): AsyncGenerator<AgentSseEvent> {
  const res = await fetch('/api/agent/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok || !res.body) throw new Error(`agent turn failed (${res.status})`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      for (const e of parseSseChunk(frame)) yield e
    }
  }
  for (const e of parseSseChunk(buffer)) yield e
}

/** one full agent turn incl. external-execution resume rounds (≤5 rounds) */
export async function runAgentTurn(
  intent: string,
  context: DeskAgentContext,
  sessionId: string,
  exec: AgentExecutors,
): Promise<void> {
  let resume: Record<string, unknown> | null = null
  for (let round = 0; round < 5; round++) {
    const pending: AgentSseEvent[] = []
    for await (const e of streamTurn({ sessionId, intent, context, resume })) {
      exec.onEvent?.(e)
      if (e.type === 'error') throw new Error(e.message ?? 'Agent execution failed')
      // the server recorded an execution failure for this turn — terminal
      if (e.type === 'experiment_failed') {
        throw new Error(String(e.error ?? 'external execution failed'))
      }
      if (e.type === 'plan_created' && e.plan) {
        // surfaced to the paper via agentState by the caller's onEvent
      }
      if (e.type === 'require_execution') {
        if (!e.toolCallId || !e.tool || !['canvas_apply', 'scientific_execute'].includes(e.tool)) throw new Error('Unknown or malformed external tool')
        pending.push(e)
      }
    }
    if (!pending.length) return
    const replyId = pending[0].replyId
    if (pending.some((p) => p.replyId !== replyId)) throw new Error('Mixed reply ids in tool batch')
    if (new Set(pending.map((p) => p.toolCallId)).size !== pending.length) throw new Error('Duplicate tool call id')
    const executionResults = []
    for (const call of pending) {
      try {
        const result = call.tool === 'canvas_apply'
          ? await exec.canvasApply(call.args?.ops ?? [])
          : await exec.scientificExecute(call.args ?? {})
        executionResults.push({ toolCallId: call.toolCallId, tool: call.tool, status: 'ok', result })
      } catch (err) {
        // failures are RESUMED as failures — the server session must end in
        // experiment_failed, never dangle waiting for a result that never
        // comes (and never auto-retry into a second fork)
        executionResults.push({
          toolCallId: call.toolCallId,
          tool: call.tool,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    resume = { replyId, executionResults, roundId: pending[0].roundId }
    // if every call in the batch failed, this turn is over after the resume —
    // surface locally too (badges/notes) but do NOT throw before feeding back
    const allFailed = executionResults.every((r) => r.status === 'error')
    if (allFailed) {
      // feed the failure back so the server records experiment_failed, then stop
      for await (const e of streamTurn({ sessionId, intent, context, resume })) {
        exec.onEvent?.(e)
      }
      throw new Error(`External tool failed: ${executionResults.map((r) => r.error).join('; ')}`)
    }
  }
  throw new Error('Agent exceeded the maximum execution rounds')
}
