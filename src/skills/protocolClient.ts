// Headless protocol client (Stage D) — runs the FULL agent protocol without
// a browser: SSE events from the server orchestrator, external execution
// answered by the REAL scientific executor stack (explorer store + unified
// skill executor + canvas-free fork/compare bookkeeping). No mock compute,
// no DOM. Used by vitest protocol tests and any CLI harness.
//
// Transport is injectable so tests can drive the client against a recorded
// SSE stream or a live server; execution is never injected.
import { explorerStore, type CurveRun } from '../desk/explorerStore'
import { executeFormulaSteps } from './formulaExecutor'
import { getExperimentRun } from '../experiments/protocol'

export interface ProtocolEvent {
  type: string
  [k: string]: unknown
}

/** minimal SSE frame parser over a byte/string stream */
export async function* readSse(chunks: AsyncIterable<string>): AsyncGenerator<ProtocolEvent> {
  let buffer = ''
  for await (const chunk of chunks) {
    buffer += chunk
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      for (const line of frame.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            yield JSON.parse(line.slice(6)) as ProtocolEvent
          } catch {
            /* malformed frame ignored */
          }
        }
      }
    }
  }
  for (const line of buffer.split('\n')) {
    if (line.startsWith('data: ')) {
      try {
        yield JSON.parse(line.slice(6)) as ProtocolEvent
      } catch {
        /* ignore */
      }
    }
  }
}

export interface HeadlessDesk {
  /** the single (or selected) explorer the agent operates on */
  explorerId: string
  /** simple canvas: forks create new explorers below the current one */
  forkedIds: string[]
}

export interface ProtocolClientResult {
  events: ProtocolEvent[]
  /** runs produced during external execution (real ids) */
  runs: Array<{ runId: string; metrics: Record<string, number> }>
  comparison: unknown
  summary: string
  targetExplorerId: string
}

export interface ProtocolTransport {
  /** POST /api/agent/turn and yield raw SSE chunks */
  turn(body: Record<string, unknown>): AsyncIterable<string>
}

export class HeadlessProtocolError extends Error {
  constructor(message: string, public readonly events: ProtocolEvent[]) {
    super(message)
  }
}

/** in-memory desk that mirrors what the tldraw canvas does, minus rendering */
export function createDesk(specId: string): HeadlessDesk {
  return { explorerId: specId, forkedIds: [] }
}

/**
 * Drive one full agent turn: plan → require_execution → REAL execution in
 * this process (explorer + executor) → resume → observation. Mirrors
 * src/desk/agentBridge.ts semantics without fetch or tldraw.
 */
export async function runProtocolTurn(
  desk: HeadlessDesk,
  intent: string,
  context: { deskKind: 'formula' | 'kakeya'; params: string[]; paperTitle?: string; selectedRunId?: string | null },
  transport: ProtocolTransport,
  sessionId: string,
): Promise<ProtocolClientResult> {
  const events: ProtocolEvent[] = []
  let resume: Record<string, unknown> | null = null
  let result: ProtocolClientResult = {
    events,
    runs: [],
    comparison: null,
    summary: '',
    targetExplorerId: desk.explorerId,
  }

  for (let round = 0; round < 5; round++) {
    const pending: Array<{ toolCallId: string; replyId: string; tool: string; args: Record<string, unknown> }> = []
    for await (const e of readSse(transport.turn({ sessionId, intent, context, resume }))) {
      events.push(e)
      if (e.type === 'error') throw new HeadlessProtocolError(String(e.message ?? 'agent error'), events)
      if (e.type === 'require_execution') {
        const tool = String(e.tool)
        if (!['scientific_execute', 'canvas_apply'].includes(tool)) {
          throw new HeadlessProtocolError(`unknown external tool: ${tool}`, events)
        }
        pending.push({
          toolCallId: String(e.toolCallId ?? ''),
          replyId: String(e.replyId ?? ''),
          tool,
          args: (e.args ?? {}) as Record<string, unknown>,
        })
      }
    }
    if (pending.length === 0) return result

    const replyId = pending[0].replyId
    if (pending.some((p) => p.replyId !== replyId)) {
      throw new HeadlessProtocolError('mixed reply ids in one batch', events)
    }

    const executionResults: Array<Record<string, unknown>> = []
    for (const call of pending) {
      try {
        if (call.tool === 'canvas_apply') {
          const ops = (call.args.ops ?? []) as unknown[]
          executionResults.push({ toolCallId: call.toolCallId, tool: call.tool, status: 'ok', result: { applied: ops.length } })
          continue
        }
        // scientific_execute → the REAL executor stack, same as the UI
        const executed = await executeFormulaSteps(
          desk.explorerId,
          (call.args.steps ?? []) as Array<Record<string, unknown>>,
          {
            fork: (id) => {
              const newId = `fork-${desk.forkedIds.length + 1}`
              explorerStore.fork(id, newId)
              desk.forkedIds.push(newId)
              desk.explorerId = newId // subsequent ops act on the branch
              return newId
            },
            compare: () => {},
          },
        )
        result = {
          ...result,
          runs: executed.runs,
          comparison: executed.comparison,
          summary: executed.summary,
          targetExplorerId: executed.targetId,
        }
        executionResults.push({ toolCallId: call.toolCallId, tool: call.tool, status: 'ok', result: { runs: executed.runs, comparison: executed.comparison, summary: executed.summary } })
      } catch (err) {
        executionResults.push({
          toolCallId: call.toolCallId,
          tool: call.tool,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    const anyFailed = executionResults.some((r) => r.status === 'error')
    resume = { replyId, executionResults }
    if (anyFailed) {
      // surface immediately — partial execution must not re-fork on retry
      const failed = executionResults.filter((r) => r.status === 'error')
      events.push({ type: 'client_execution_failed', failures: failed.map((f) => f.error) })
      throw new HeadlessProtocolError(`external execution failed: ${failed.map((f) => f.error).join('; ')}`, events)
    }
  }
  throw new HeadlessProtocolError('exceeded 5 execution rounds', events)
}

/** wait until an explorer has a settled run matching its current params */
export async function settledRun(explorerId: string): Promise<CurveRun> {
  return explorerStore.waitForRun(explorerId)
}

export { getExperimentRun }
