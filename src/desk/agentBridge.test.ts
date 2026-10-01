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
  return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } })
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
