// A1.1: the framework-agnostic scientific tool port. The SAME registry and
// the SAME executor — the port only gives AgentScope/SSE/HTTP one typed
// contract (catalog + invocation receipt) instead of each surface hand-rolling
// its own. Semantics must be IDENTICAL to calling executeSkill directly.
import { beforeEach, describe, expect, it } from 'vitest'
import { executeSkill } from './executor'
import { buildPlan } from './playPlan'
import { toolCatalog, invokeScientificTool, invokeScientificOperation, resetOperationLedger } from './toolPort'
import { SKILL_REGISTRY } from './registry'

const expr = ['Multiply', 'a', 'x']
const input = { expression: expr, bindings: { a: 2, x: 3 } }
const anchor = { docId: 'port-test', anchorId: 'p1', title: 'Declared test anchor' }
const planId = () => buildPlan({ skill: 'formula.evaluate', goal: 'port consistency', inputs: input }).planId

describe('toolCatalog — the contract comes from the Registry, not a second list', () => {
  it('lists every registered skill with aliases, version, evidence and BOTH schemas', () => {
    const catalog = toolCatalog()
    expect(catalog.tools).toHaveLength(SKILL_REGISTRY.length)
    for (const skill of SKILL_REGISTRY) {
      const entry = catalog.tools.find((t) => t.name === skill.name)
      expect(entry, skill.name).toBeDefined()
      expect(entry!.aliases).toEqual(skill.aliases ?? [])
      expect(entry!.version).toBe(skill.version)
      expect(entry!.evidence).toBe(skill.evidence)
      expect(entry!.inputSchema).toEqual(skill.inputSchema)
      expect(entry!.outputSchema).toEqual(skill.outputSchema)
      expect(entry!.runKind ?? null).toBe(skill.runKind ?? null)
    }
  })

  it('carries a port version so consumers can pin the contract', () => {
    expect(toolCatalog().portVersion).toMatch(/^tool-port@\d+\.\d+$/)
  })
})

describe('invokeScientificTool — identical semantics to the executor', () => {
  it('same params through the port and the executor produce the same evidence', async () => {
    const viaPort = await invokeScientificTool('formula.evaluate', input, { planId: planId(), source: anchor })
    const direct = await executeSkill('formula.evaluate', input, { planId: planId(), source: anchor })
    expect(viaPort.state).toBe('completed')
    expect(direct.status).toBe('ok')
    const portRun = viaPort.run!
    const directRun = (direct as { run: NonNullable<typeof portRun> }).run
    // runIds are per-execution identity; the EVIDENCE is what must match
    expect(portRun.result).toEqual(directRun.result)
    expect(portRun.status).toBe(directRun.status)
    expect(portRun.spec.source).toEqual(directRun.spec.source)
    expect(portRun.engine).toBe(directRun.engine)
    expect(portRun.spec.kind).toBe(directRun.spec.kind)
    // invocation identity echoes back for correlation
    expect(viaPort.invocationId).toBeUndefined()
  })

  it('a canonical alias resolves to the same implementation through the port', async () => {
    const viaPort = await invokeScientificTool('measure_volume', { deltaExp: 4, nTubes: 16, packing: 0.5, res: 16 }, { planId: buildPlan({ skill: 'kakeya.measure', goal: 'alias via port' }).planId })
    expect(viaPort.state).toBe('completed')
    expect(viaPort.run!.spec.kind).toBe('kakeya.voxel')
  })

  it('unknown tool → terminal receipt with errorCode, never a run', async () => {
    const out = await invokeScientificTool('not.a.tool', {})
    expect(out.state).toBe('error')
    expect(out.errorCode).toBe('unknown_skill')
    expect(out.run).toBeUndefined()
    expect(out.message).toMatch(/not.a.tool/)
  })

  it('missing plan → needs_input receipt with missingFields', async () => {
    const out = await invokeScientificTool('formula.plot', {
      expression: expr, parameters: ['a'], independent: 'x', range: [-1, 1], values: { a: 1 },
    })
    expect(out.state).toBe('needs_input')
    expect(out.missingFields).toContain('planId')
    expect(out.run).toBeUndefined()
  })

  it('invalid input → error receipt with errorCode invalid_input', async () => {
    const out = await invokeScientificTool('kakeya.measure', { deltaExp: 4, nTubes: 'many', packing: 0.5 }, { planId: 'x' })
    expect(out.state).toBe('error')
    expect(out.errorCode).toBe('invalid_input')
  })

  it('an execution failure keeps the error Run in the receipt (no silent drop)', async () => {
    const failInput = { expression: ['Divide', 1, 'x'], bindings: { x: 0 } }
    const failPlan = buildPlan({ skill: 'formula.evaluate', goal: 'port failure path', inputs: failInput })
    const out = await invokeScientificTool('formula.evaluate', failInput, { planId: failPlan.planId })
    expect(out.state).toBe('error')
    expect(out.errorCode).toBe('execution_failed')
    expect(out.run?.status).toBe('error')
    expect(out.run?.result).toBeUndefined()
  })

  it('an invocationId set by the caller echoes back for correlation', async () => {
    const out = await invokeScientificTool('formula.evaluate', input, { planId: planId(), invocationId: 'inv-7' })
    expect(out.invocationId).toBe('inv-7')
  })
})

describe('invokeScientificOperation — operation identity and idempotency (A1.2)', () => {
  beforeEach(() => resetOperationLedger())

  const payload = { skill: 'formula.evaluate', input }

  it('the same operationId + same payload replays the SAME receipt without re-executing', async () => {
    const opts = { planId: planId(), invocationId: 'op-1-call' }
    const first = await invokeScientificOperation({ operationId: 'op-1', ...payload }, opts)
    const second = await invokeScientificOperation({ operationId: 'op-1', ...payload }, { ...opts, invocationId: 'op-1-retry' })
    expect(first.state).toBe('completed')
    expect(second.state).toBe('completed')
    expect(second.run?.runId).toBe(first.run!.runId) // ONE execution, replayed
    // the retry's invocationId is the replay caller's, for correlation
    expect(second.invocationId).toBe('op-1-retry')
    expect(second.replayed).toBe(true)
  })

  it('the same operationId + DIFFERENT payload is refused as a conflict, never executed', async () => {
    const first = await invokeScientificOperation({ operationId: 'op-2', ...payload }, { planId: planId() })
    expect(first.state).toBe('completed')
    const tampered = await invokeScientificOperation(
      { operationId: 'op-2', skill: 'formula.evaluate', input: { expression: expr, bindings: { a: 99, x: 99 } } },
      { planId: planId() },
    )
    expect(tampered.state).toBe('error')
    expect(tampered.errorCode).toBe('operation_conflict')
    expect(tampered.run).toBeUndefined()
    expect(tampered.message).toMatch(/op-2/)
    // the original receipt is still what a same-payload retry gets
    const replay = await invokeScientificOperation({ operationId: 'op-2', ...payload }, { planId: planId() })
    expect(replay.state).toBe('completed')
    expect(replay.run?.runId).toBe(first.run!.runId)
  })

  it('an unknown tool under an operationId is refused and NOT cached as the operation result', async () => {
    const bad = await invokeScientificOperation({ operationId: 'op-3', skill: 'no.such.tool', input: {} })
    expect(bad.state).toBe('error')
    expect(bad.errorCode).toBe('unknown_skill')
    // a protocol-level refusal is not an operation outcome: the same id can
    // still be used for a real call afterwards
    const good = await invokeScientificOperation({ operationId: 'op-3', skill: 'formula.evaluate', input }, { planId: planId() })
    expect(good.state).toBe('completed')
  })

  it('the idempotencyKey participates in identity: same operationId, different keys both execute', async () => {
    const a = await invokeScientificOperation({ operationId: 'op-4', idempotencyKey: 'k1', ...payload }, { planId: planId() })
    const b = await invokeScientificOperation({ operationId: 'op-4', idempotencyKey: 'k2', ...payload }, { planId: planId() })
    expect(a.state).toBe('completed')
    expect(b.state).toBe('completed')
    expect(b.run?.runId).not.toBe(a.run!.runId)
  })

  it('a failed execution IS cached: retrying the operation returns the same failure, no re-run', async () => {
    const failInput = { expression: ['Divide', 1, 'x'], bindings: { x: 0 } }
    const failPlan = buildPlan({ skill: 'formula.evaluate', goal: 'op fail', inputs: failInput })
    const first = await invokeScientificOperation({ operationId: 'op-5', skill: 'formula.evaluate', input: failInput }, { planId: failPlan.planId })
    expect(first.state).toBe('error')
    const runId = first.run!.runId
    const retry = await invokeScientificOperation({ operationId: 'op-5', skill: 'formula.evaluate', input: failInput }, { planId: failPlan.planId })
    expect(retry.state).toBe('error')
    expect(retry.run?.runId).toBe(runId)
    expect(retry.replayed).toBe(true)
  })

  it('workspaces are isolated: the same operationId in two workspaces executes twice', async () => {
    const a = await invokeScientificOperation({ operationId: 'op-6', workspace: 'ws-a', ...payload }, { planId: planId() })
    const b = await invokeScientificOperation({ operationId: 'op-6', workspace: 'ws-b', ...payload }, { planId: planId() })
    expect(a.state).toBe('completed')
    expect(b.state).toBe('completed')
    expect(b.run?.runId).not.toBe(a.run!.runId)
  })

  it('the ledger is in-process only: reset clears it (J1 owns persistence)', async () => {
    await invokeScientificOperation({ operationId: 'op-7', ...payload }, { planId: planId() })
    resetOperationLedger()
    const after = await invokeScientificOperation({ operationId: 'op-7', ...payload }, { planId: planId() })
    expect(after.replayed).toBeUndefined() // a fresh execution, not a replay
  })

  it('needs_input does NOT burn the operationId — fixing the call retries for real', async () => {
    const miss = await invokeScientificOperation({ operationId: 'op-8', skill: 'formula.plot', input: { expression: expr, parameters: ['a'], independent: 'x', range: [-1, 1], values: { a: 1 } } })
    expect(miss.state).toBe('needs_input')
    const goodPlan = buildPlan({ skill: 'formula.plot', goal: 'op-8 fixed', inputs: { expression: expr, parameters: ['a'], independent: 'x', range: [-1, 1], values: { a: 1 } } })
    const fixed = await invokeScientificOperation({ operationId: 'op-8', skill: 'formula.plot', input: { expression: expr, parameters: ['a'], independent: 'x', range: [-1, 1], values: { a: 1 } } }, { planId: goodPlan.planId })
    expect(fixed.state).toBe('completed')
    expect(fixed.replayed).toBeUndefined()
  })

  it('a replay without a new invocationId does not echo the FIRST caller\'s id', async () => {
    const first = await invokeScientificOperation({ operationId: 'op-9', ...payload }, { planId: planId(), invocationId: 'first-caller' })
    expect(first.invocationId).toBe('first-caller')
    const replay = await invokeScientificOperation({ operationId: 'op-9', ...payload }, { planId: planId() })
    expect(replay.replayed).toBe(true)
    expect(replay.invocationId).toBeUndefined()
  })
})
