import { describe, expect, it } from 'vitest'
import { parseSseChunk } from './agentBridge'

describe('agentBridge SSE parsing', () => {
  it('parses data frames and ignores comments/malformed lines', () => {
    const chunk = 'data: {"type":"plan_created","plan":{"planId":"p1"}}\n: heartbeat\ndata: not-json\n\n'
    const events = parseSseChunk(chunk)
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('plan_created')
    expect((events[0].plan as { planId: string }).planId).toBe('p1')
  })

  it('handles several events in one frame', () => {
    const frame = 'data: {"type":"tool_started","tool":"scientific_execute"}\ndata: {"type":"require_execution","toolCallId":"tc-1","tool":"scientific_execute","args":{"deskKind":"formula","steps":[{"op":"experiment.fork"}]}}'
    const events = parseSseChunk(frame)
    expect(events.map((e) => e.type)).toEqual(['tool_started', 'require_execution'])
    expect(events[1].args?.steps).toHaveLength(1)
  })
})

import { afterEach, vi } from 'vitest'
import { runAgentTurn } from './agentBridge'
afterEach(() => vi.unstubAllGlobals())
function response(events: unknown[]) {
  const declared = [{ type: 'backend', provider: 'openai', backend: 'agentscope-openai' }, ...events]
  return new Response(declared.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } })
}
it('executes every external call and resumes with a complete batch', async () => {
  const bodies: Array<Record<string, unknown>> = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    bodies.push(JSON.parse(init.body))
    return bodies.length === 1 ? response([
      { type: 'require_execution', replyId: 'reply', toolCallId: 'one', tool: 'scientific_execute', args: { steps: [] } },
      { type: 'require_execution', replyId: 'reply', toolCallId: 'two', tool: 'canvas_apply', args: { ops: [] } },
    ]) : response([{ type: 'done' }])
  }))
  const scientificExecute = vi.fn(async () => ({ runs: [] }))
  const canvasApply = vi.fn(async () => ({ applied: 1 }))
  await runAgentTurn('double', { deskKind: 'formula', paperTitle: '', params: [] }, 'session', { scientificExecute, canvasApply })
  expect(scientificExecute).toHaveBeenCalledTimes(1)
  expect(canvasApply).toHaveBeenCalledTimes(1)
  expect((bodies[1].resume as { executionResults: unknown[] }).executionResults).toHaveLength(2)
})
it('surfaces an SSE error instead of silently succeeding', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response([{ type: 'error', message: 'model unavailable' }])))
  await expect(runAgentTurn('q', { deskKind: 'formula', paperTitle: '', params: [] }, 's', {
    scientificExecute: async () => ({}), canvasApply: async () => ({}),
  })).rejects.toThrow('model unavailable')
})

it('a failed execution is RESUMED as a failure before the turn throws (server records experiment_failed)', async () => {
  const bodies: Array<Record<string, unknown>> = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    bodies.push(JSON.parse(init.body))
    if (bodies.length === 1) {
      return response([
        { type: 'require_execution', replyId: 'r', toolCallId: 'boom', tool: 'scientific_execute', args: { steps: [] } },
      ])
    }
    // the failure-resume round: server must answer experiment_failed + done
    return response([
      { type: 'experiment_failed', toolCallId: 'boom', error: 'compile failed' },
      { type: 'done', reason: 'execution_failed' },
    ])
  }))
  const scientificExecute = vi.fn(async () => { throw new Error('compile failed') })
  const seen: string[] = []
  await expect(runAgentTurn('q', { deskKind: 'formula', paperTitle: '', params: [] }, 's2', {
    scientificExecute,
    canvasApply: async () => ({}),
    onEvent: (e) => seen.push(e.type),
  })).rejects.toThrow('compile failed')
  // the failure WAS fed back: exactly one resume carrying status 'error'
  expect(bodies).toHaveLength(2)
  const resume = bodies[1].resume as { executionResults: Array<{ toolCallId: string; status: string; error: string }> }
  expect(resume.executionResults[0]).toMatchObject({ toolCallId: 'boom', status: 'error', error: 'compile failed' })
  // and the client observed the server's failure events
  expect(seen).toContain('experiment_failed')
})

it('partial failure in a batch: successes resume normally, the error row carries status error', async () => {
  const bodies: Array<Record<string, unknown>> = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    bodies.push(JSON.parse(init.body))
    return bodies.length === 1
      ? response([
          { type: 'require_execution', replyId: 'r', toolCallId: 'ok1', tool: 'canvas_apply', args: { ops: [{}] } },
          { type: 'require_execution', replyId: 'r', toolCallId: 'bad1', tool: 'scientific_execute', args: { steps: [] } },
        ])
      : response([{ type: 'experiment_failed', toolCallId: 'bad1', error: 'x' }, { type: 'done', reason: 'execution_failed' }])
  }))
  await expect(runAgentTurn('q', { deskKind: 'formula', paperTitle: '', params: [] }, 's3', {
    scientificExecute: async () => { throw new Error('x') },
    canvasApply: async () => ({ applied: 1 }),
  })).rejects.toThrow('x')
  const resume = bodies[1].resume as { executionResults: Array<{ toolCallId: string; status: string }> }
  const byId = Object.fromEntries(resume.executionResults.map((r) => [r.toolCallId, r.status]))
  expect(byId).toEqual({ ok1: 'ok', bad1: 'error' })
})

it('does not execute SOP as an AI turn or replay a failed provider', async () => {
  const scientificExecute = vi.fn(async () => ({}))
  for (const event of [{ type: 'backend', provider: 'sop', backend: 'sop-deterministic' }, { type: 'sop_fallback', reason: 'provider unavailable' }]) {
    vi.stubGlobal('fetch', vi.fn(async () => response([event, { type: 'require_execution', replyId: 'r', toolCallId: 't', tool: 'scientific_execute' }])))
    await expect(runAgentTurn('double a', { deskKind: 'formula', paperTitle: '', params: ['a'] }, 's', {
      scientificExecute, canvasApply: async () => ({}),
    })).rejects.toThrow('SOP')
  }
  expect(scientificExecute).not.toHaveBeenCalled()
})

it('rejects the real legacy SOP protocol with no backend declaration', async () => {
  const scientificExecute = vi.fn(async () => ({}))
  vi.stubGlobal('fetch', vi.fn(async () => new Response('data: {"type":"require_execution","tool":"scientific_execute","toolCallId":"sop-1","replyId":"r"}\n\n')))
  await expect(runAgentTurn('a double', { deskKind: 'formula', paperTitle: '', params: ['a'] }, 'sop', {
    scientificExecute, canvasApply: async () => ({}),
  })).rejects.toThrow('后端声明')
  expect(scientificExecute).not.toHaveBeenCalled()
})
