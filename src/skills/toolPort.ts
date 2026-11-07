// A1.1 — the framework-agnostic scientific tool port (PLAN §3.1).
// ONE contract exported from the Registry, ONE execution path through the
// unified executor. AgentScope, the SSE bridge and future surfaces consume
// this instead of hand-rolling tool schemas and result envelopes; no second
// dispatcher exists here — invokeScientificTool literally calls executeSkill
// and translates the outcome into the transport receipt.
import type { ExperimentRun } from '../experiments/protocol'
import { SKILL_REGISTRY, getSkill, type ScientificSkill } from './registry'
import { executeSkill, type ExecuteOptions, type SkillOutcome } from './executor'
import { planInputDigest } from './playPlan'

export const TOOL_PORT_VERSION = 'tool-port@1.0'

export interface ToolCatalogEntry {
  name: string
  aliases: string[]
  description: string
  version: string
  evidence: ScientificSkill['evidence']
  /** null when the skill produces no run (orchestration/canvas skills) */
  runKind: ScientificSkill['runKind'] | null
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
}

export interface ToolCatalog {
  portVersion: string
  tools: ToolCatalogEntry[]
}

/** the full registered contract — consumers generate THEIR tool schemas from
 *  this; nothing about AgentScope or SSE leaks into the registry */
export function toolCatalog(): ToolCatalog {
  return {
    portVersion: TOOL_PORT_VERSION,
    tools: SKILL_REGISTRY.map((s) => ({
      name: s.name,
      aliases: s.aliases ?? [],
      description: s.description,
      version: s.version,
      evidence: s.evidence,
      runKind: s.runKind ?? null,
      inputSchema: s.inputSchema,
      outputSchema: s.outputSchema,
    })),
  }
}

/** receipt states per PLAN §3.1 (accepted/retryable join with J1 persistence) */
export type ToolReceiptState = 'completed' | 'needs_input' | 'unsupported' | 'error'

export interface ToolReceipt {
  state: ToolReceiptState
  /** caller-supplied correlation id, echoed back untouched */
  invocationId?: string
  /** the real run when one exists (evidence travels with the receipt) */
  run?: ExperimentRun
  payload?: unknown
  /** executor error code when state = error (unknown_skill / invalid_input /
   *  execution_failed / output_invalid) */
  errorCode?: string
  /** needs_input fields the caller must supply (planId, plan.inputs, …) */
  missingFields?: string[]
  message?: string
}

export interface ToolInvocationOptions extends ExecuteOptions {
  invocationId?: string
}

/** run ONE registered skill through the unified executor and wrap the
 *  outcome in the transport receipt — semantics are executeSkill's, verbatim */
export async function invokeScientificTool(
  name: string,
  input: unknown,
  opts: ToolInvocationOptions = {},
): Promise<ToolReceipt> {
  const { invocationId, ...executeOpts } = opts
  const receipt = (partial: Omit<ToolReceipt, 'invocationId'>): ToolReceipt =>
    invocationId !== undefined ? { invocationId, ...partial } : partial

  if (!getSkill(name)) {
    return receipt({
      state: 'error',
      errorCode: 'unknown_skill',
      message: `Unknown tool: ${name} — the catalog is the registry, nothing else is callable`,
    })
  }
  const outcome: SkillOutcome = await executeSkill(name, input, executeOpts)
  return receipt(outcomeToReceipt(outcome))
}

function outcomeToReceipt(outcome: SkillOutcome): Omit<ToolReceipt, 'invocationId'> {
  switch (outcome.status) {
    case 'ok':
      return { state: 'completed', run: outcome.run ?? undefined, payload: outcome.payload }
    case 'needs_input':
      return { state: 'needs_input', missingFields: outcome.missing, message: outcome.message }
    case 'unsupported':
      return { state: 'unsupported', message: outcome.message }
    case 'error':
      return { state: 'error', errorCode: outcome.code, message: outcome.message, run: outcome.run }
  }
}

// ---------------------------------------------------------------------------
// A1.2 — operation identity (PLAN §3.3): operationId names ONE semantic
// operation; a retry replays the recorded receipt instead of re-executing, and
// the same key with a DIFFERENT payload is a conflict. The ledger is IN-PROCESS
// (single-user default workspace); J1 owns the persistent version — until then
// a restart replays nothing and claims no cross-restart idempotency.
// ---------------------------------------------------------------------------

export interface ScientificOperation {
  /** ONE semantic operation — retries/replays reuse it */
  operationId: string
  /** distinguishes independent operations under the same operationId */
  idempotencyKey?: string
  /** single-user deployments use the default workspace; J1 issues real ones */
  workspace?: string
  skill: string
  input: unknown
}

export interface OperationReceipt extends ToolReceipt {
  /** true when this response is a replay of a recorded receipt, not a new execution */
  replayed?: boolean
}

interface LedgerEntry {
  payloadDigest: string
  receipt: OperationReceipt
}

const LEDGER_LIMIT = 512
const operationLedger = new Map<string, LedgerEntry>()

/** tests and fresh sessions start empty; production never calls this */
export function resetOperationLedger(): void {
  operationLedger.clear()
}

function operationKey(op: ScientificOperation): string {
  return `${op.workspace ?? 'default'}|${op.operationId}|${op.idempotencyKey ?? ''}`
}

/** execute (or replay) ONE scientific operation under operation identity */
export async function invokeScientificOperation(
  op: ScientificOperation,
  opts: ToolInvocationOptions = {},
): Promise<OperationReceipt> {
  const key = operationKey(op)
  // canonical digest over (skill, input): key order in the caller's JSON
  // must not turn a replay into a false conflict
  const payloadDigest = planInputDigest({ skill: op.skill, input: op.input } as Record<string, unknown>)
  const recorded = operationLedger.get(key)
  if (recorded) {
    if (recorded.payloadDigest !== payloadDigest) {
      return {
        state: 'error',
        errorCode: 'operation_conflict',
        message: `operation '${op.operationId}' is already recorded with a DIFFERENT payload — same key, different input is refused (use a new operationId)`,
      }
    }
    // replay: the FIRST caller's invocation id does not leak into this
    // response — only this caller's own id (if any) is attached
    const { invocationId: _first, ...replayBase } = recorded.receipt
    return { ...replayBase, replayed: true, ...(opts.invocationId !== undefined ? { invocationId: opts.invocationId } : {}) }
  }
  const receipt = await invokeScientificTool(op.skill, op.input, opts)
  // protocol-level refusals (unknown tool) and caller-side prerequisites
  // (needs_input / unsupported) are NOT operation outcomes — the operation
  // never executed, so the id stays usable once the caller fixes the call
  if (receipt.state === 'needs_input' || receipt.state === 'unsupported' || receipt.errorCode === 'unknown_skill') {
    return receipt
  }
  if (operationLedger.size >= LEDGER_LIMIT) {
    const oldest = operationLedger.keys().next().value
    if (oldest !== undefined) operationLedger.delete(oldest)
  }
  operationLedger.set(key, { payloadDigest, receipt })
  return receipt
}
