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
