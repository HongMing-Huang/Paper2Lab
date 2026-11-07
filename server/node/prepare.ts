// J1.2a — engine request preparation and candidate verification. Lineage the
// engine needs comes from PostgreSQL, not from a legacy run log: referenced
// runs plus the plans that governed them are injected into the request.
import type { Pool } from './db.ts'
import type { OperationRow } from './ledger.ts'
import { loadRun } from './runs.ts'
import { validateImportedRun, type ExperimentRun } from '../../src/experiments/protocol.ts'
import { getSkill, schemaError, SKILL_REGISTRY } from '../../src/skills/registry.ts'

export interface Expectation {
  kind: string
  parentRunId: string | null
}

export type Prepared =
  | { request: Record<string, unknown>; governingPlan: unknown; expect: Expectation | null }
  | { refusal: Record<string, unknown> }

/** build the candidate-mode request for one operation; 'refusal' settles the
 *  operation without an engine run (unknown lineage references are rejected) */
export async function prepareEngineRequest(pool: Pool, op: OperationRow): Promise<Prepared> {
  const req = op.request as {
    input: Record<string, unknown>
    plan?: Record<string, unknown> | null
    planId?: string | null
    parentRunId?: string | null
    source?: unknown
  }
  const priorRuns: ExperimentRun[] = []
  const priorPlans: unknown[] = []
  let governingPlan: unknown = req.plan ?? null
  let expect: Expectation | null = null
  const refuse = (message: string): { refusal: Record<string, unknown> } => ({ refusal: { state: 'error', errorCode: 'invalid_input', message } })
  if (op.skill === 'experiment.fork') {
    const sourceRunId = String(req.input.sourceRunId)
    const source = await loadRun(pool, op.workspace, sourceRunId)
    if (!source) return refuse(`Unknown run: ${sourceRunId}`)
    priorRuns.push(source.record)
    if (source.governingPlan) priorPlans.push(source.governingPlan)
    governingPlan = source.governingPlan ?? governingPlan
    expect = { kind: source.record.spec.kind, parentRunId: sourceRunId }
  } else if (op.skill === 'experiment.compare') {
    for (const key of ['runA', 'runB'] as const) {
      const id = String(req.input[key])
      const found = await loadRun(pool, op.workspace, id)
      if (!found) return refuse(`Unknown run: ${id}`)
      if (!priorRuns.some((r) => r.runId === found.record.runId)) priorRuns.push(found.record)
    }
  } else {
    const kind = getSkill(op.skill)?.runKind
    if (kind) expect = { kind, parentRunId: req.parentRunId ?? null }
    if (req.parentRunId && !(await loadRun(pool, op.workspace, req.parentRunId))) return refuse(`Unknown parent run: ${req.parentRunId}`)
  }
  const request: Record<string, unknown> = {
    skill: op.skill,
    input: req.input,
    ...(req.plan ? { plan: req.plan } : {}),
    ...(req.planId ? { planId: req.planId } : {}),
    ...(req.parentRunId ? { parentRunId: req.parentRunId } : {}),
    ...(req.source !== undefined && req.source !== null ? { source: req.source } : {}),
    priorRuns,
    priorPlans,
  }
  return { request, governingPlan, expect }
}

/** the repository's own gate on a runtime candidate (defense in depth: the
 *  engine already validated; a stale or corrupt engine must still not publish).
 *  Returns a rejection reason, or null when the candidate may be committed. */
export function verifyCandidate(run: ExperimentRun, op: OperationRow, expect: Expectation | null): string | null {
  try {
    validateImportedRun(run)
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
  if (run.evidence !== 'CALCULATED') return `candidate evidence '${String(run.evidence)}' is not CALCULATED`
  if (typeof run.runId !== 'string' || run.runId.length === 0 || run.runId.length > 160) return 'candidate runId is malformed'
  if (!run.engine || !run.engineVersion) return 'candidate lacks engine identity'
  if (!expect) return `skill ${op.skill} is not expected to produce a run`
  if (run.spec.kind !== expect.kind) return `candidate kind '${run.spec.kind}' does not match expected '${expect.kind}'`
  if ((run.parentRunId ?? null) !== expect.parentRunId) return `candidate lineage parent '${run.parentRunId ?? 'none'}' does not match expected '${expect.parentRunId ?? 'none'}'`
  if (run.status === 'resolved') {
    const producer = SKILL_REGISTRY.find((s) => s.runKind === run.spec.kind)
    if (!producer) return `no registered skill produces kind ${run.spec.kind}`
    const invalid = schemaError(producer.outputSchema, run.result, `${producer.name} result`)
    if (invalid) return `candidate result violates ${producer.name} output schema: ${invalid}`
  }
  return null
}
