// Stage D protocol-link tests: the headless client drives the FULL agent
// protocol (plan → require_execution → real execution → resume → done)
// against an in-process SSE transport that speaks the exact server event
// grammar of server/agent.py. Execution is the REAL explorer+executor stack —
// only the HTTP transport is a test double.
import { afterEach, describe, expect, it } from 'vitest'
import { explorerStore } from '../desk/explorerStore'
import { analyzeFormula } from '../formula/analyze'
import { buildExplorerSpec } from '../formula/spec'
import { getExperimentRun } from '../experiments/protocol'
import { createDesk, readSse, runProtocolTurn, HeadlessProtocolError, type ProtocolTransport } from './protocolClient'

function seedExplorer(id: string, a = 2) {
  const { spec, compiled } = buildExplorerSpec(
    analyzeFormula('y = a\\sin(bx)'),
    { docId: 'doc-proto', page: 1, bbox: { x: 0.1, y: 0.2, w: 0.4, h: 0.05 }, latex: 'y = a\\sin(bx)' },
  )
  explorerStore.create(id, spec, compiled as never)
  if (a !== 1) explorerStore.setParams(id, { a })
  return id
}

afterEach(() => explorerStore.ids().forEach((id) => explorerStore.dispose(id)))

/** transport that replays the deterministic SOP server grammar */
function sopTransport(intents: Record<string, string[]>): ProtocolTransport & { resumes: unknown[] } {
  const resumes: unknown[] = []
  return {
    resumes,
    async *turn(body: Record<string, unknown>) {
      if (body.resume) {
        resumes.push(body.resume)
        const rows = (body.resume as { executionResults: Array<{ status: string; result?: { runs?: unknown[]; comparison?: unknown } }> }).executionResults
        const ok = rows.every((r) => r.status === 'ok')
        const text = ok
          ? [
              `data: ${JSON.stringify({ type: 'experiment_completed', runId: 'r-1', metrics: {} })}`,
              `data: ${JSON.stringify({ type: 'comparison_created' })}`,
              `data: ${JSON.stringify({ type: 'observation_ready', text: '完成', evidence: 'AI_INFERENCE' })}`,
              `data: ${JSON.stringify({ type: 'done', reason: 'completed' })}`,
            ]
          : [`data: ${JSON.stringify({ type: 'experiment_failed', toolCallId: 't', error: 'x' })}`, `data: ${JSON.stringify({ type: 'done', reason: 'execution_failed' })}`]
        yield text.join('\n\n') + '\n\n'
        return
      }
      const intent = String(body.intent ?? '')
      const script = intents[intent]
      if (!script) {
        yield `data: ${JSON.stringify({ type: 'done', reason: 'not-an-experiment' })}\n\n`
        return
      }
      yield script.join('\n\n') + '\n\n'
    },
  }
}

const DOUBLE_A_SCRIPT = [
  `data: ${JSON.stringify({ type: 'plan_created', plan: { planId: 'p1', goal: 'double a', skill: 'formula.plot', metrics: ['peak'], nonClaims: [] } })}`,
  `data: ${JSON.stringify({ type: 'require_execution', toolCallId: 'tc-1', replyId: 'rp-1', tool: 'scientific_execute', args: { deskKind: 'formula', steps: [
    { op: 'experiment.fork' }, { op: 'formula.scale', param: 'a', value: 2 }, { op: 'formula.plot' }, { op: 'experiment.compare' },
  ] } })}`,
].map((s) => s)

describe('protocol client — full turn with REAL execution', () => {
  it('"把参数翻倍" produces a real child run + comparison + lineage', async () => {
    const baseId = seedExplorer('proto-base', 2)
    await explorerStore.waitForRun(baseId)
    const baseRun = explorerStore.get(baseId)!.run!

    const desk = createDesk(baseId)
    const transport = sopTransport({ '把 a 翻倍': DOUBLE_A_SCRIPT })
    const out = await runProtocolTurn(desk, '把 a 翻倍', { deskKind: 'formula', params: ['a', 'b'] }, transport, 'sess-1')

    // real child run exists in the protocol history with the fork's params
    expect(out.runs.length).toBeGreaterThanOrEqual(1)
    const childRun = getExperimentRun(out.runs[0].runId)
    expect(childRun).toBeTruthy()
    expect(childRun!.spec.params.a).toBe(4) // 2 × 2
    expect(childRun!.parentRunId).toBe(baseRun.runId)
    // comparison payload references exactly the two runs
    const cmp = out.comparison as { runA: string; runB: string; rows: Array<{ key: string; delta: number | null }> }
    expect(cmp.runA).toBe(baseRun.runId)
    expect(cmp.runB).toBe(childRun!.runId)
    const peakRow = cmp.rows.find((r) => r.key === 'peak')!
    expect(peakRow.delta).toBeCloseTo(2, 3) // 4·|sin|−2·|sin| in grid tolerance
    // protocol completed with observation + done
    const kinds = out.events.map((e) => e.type)
    expect(kinds).toContain('experiment_completed')
    expect(kinds).toContain('done')
    // resume carried exactly one batch with the real run ids
    expect(transport.resumes).toHaveLength(1)
  })

  it('"在这个分支上减半" operates the SELECTED branch, not the base', async () => {
    const baseId = seedExplorer('branch-base', 2)
    await explorerStore.waitForRun(baseId)
    explorerStore.fork(baseId, 'branch-child')
    explorerStore.setParams('branch-child', { a: 4 })
    await explorerStore.waitForRun('branch-child')

    const desk = createDesk('branch-child')
    const halveScript = [
      `data: ${JSON.stringify({ type: 'plan_created', plan: { planId: 'p2', skill: 'formula.plot', metrics: [], nonClaims: [] } })}`,
      `data: ${JSON.stringify({ type: 'require_execution', toolCallId: 'tc-2', replyId: 'rp-2', tool: 'scientific_execute', args: { deskKind: 'formula', steps: [
        { op: 'experiment.fork' }, { op: 'formula.scale', param: 'a', value: 0.5 }, { op: 'formula.plot' },
      ] } })}`,
    ]
    const out = await runProtocolTurn(desk, '在这个分支上减半', { deskKind: 'formula', params: ['a', 'b'] }, sopTransport({ 在这个分支上减半: halveScript }), 'sess-2')

    const forkRun = getExperimentRun(out.runs[0].runId)!
    expect(forkRun.spec.params.a).toBe(2) // 4 × 0.5 — came from the BRANCH
    expect(forkRun.spec.params.a).not.toBe(1) // not the base (2 × 0.5)
    // base untouched
    expect(explorerStore.get('branch-base')!.params.a).toBe(2)
  })

  it('unknown external tool is rejected before execution', async () => {
    seedExplorer('proto-bad')
    const bad = [
      `data: ${JSON.stringify({ type: 'plan_created', plan: { planId: 'p3', skill: 'x', metrics: [], nonClaims: [] } })}`,
      `data: ${JSON.stringify({ type: 'require_execution', toolCallId: 'tc-3', replyId: 'rp-3', tool: 'rm -rf', args: {} })}`,
    ]
    await expect(
      runProtocolTurn(createDesk('proto-bad'), 'x', { deskKind: 'formula', params: ['a'] }, sopTransport({ x: bad }), 'sess-3'),
    ).rejects.toThrow(/unknown external tool/)
  })

  it('SSE error event fails the turn (never silently succeeds)', async () => {
    seedExplorer('proto-err')
    const err = [`data: ${JSON.stringify({ type: 'error', message: 'model exploded' })}`]
    await expect(
      runProtocolTurn(createDesk('proto-err'), 'y', { deskKind: 'formula', params: ['a'] }, sopTransport({ y: err }), 'sess-4'),
    ).rejects.toBeInstanceOf(HeadlessProtocolError)
  })

  it('execution failure in the batch fails the turn — no re-fork loop', async () => {
    const baseId = seedExplorer('proto-fail')
    await explorerStore.waitForRun(baseId)
    // steps reference an unknown op → executeFormulaSteps throws before fork
    const badSteps = [
      `data: ${JSON.stringify({ type: 'plan_created', plan: { planId: 'p4', skill: 'formula.plot', metrics: [], nonClaims: [] } })}`,
      `data: ${JSON.stringify({ type: 'require_execution', toolCallId: 'tc-4', replyId: 'rp-4', tool: 'scientific_execute', args: { deskKind: 'formula', steps: [
        { op: 'experiment.fork' }, { op: 'formula.set', param: 'zzz', value: 5 },
      ] } })}`,
    ]
    const before = explorerStore.ids().length
    await expect(
      runProtocolTurn(createDesk(baseId), 'z', { deskKind: 'formula', params: ['a'] }, sopTransport({ z: badSteps }), 'sess-5'),
    ).rejects.toThrow(/Invalid formula parameter|Unsupported scientific/)
    // validation fired before any fork: no new explorer was created
    expect(explorerStore.ids().length).toBe(before)
  })

  it('readSse parses real server frame grammar', async () => {
    async function* chunks(): AsyncIterable<string> {
      yield 'data: {"type":"plan_created"}\n\n: heartbeat\n'
      yield 'data: {"type":"require_execution","toolCallId":"t1"}\n\ndata: {"type":"done"}'
    }
    const events = []
    for await (const e of readSse(chunks())) events.push(e)
    expect(events.map((e) => e.type)).toEqual(['plan_created', 'require_execution', 'done'])
  })
})
