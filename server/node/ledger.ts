// J1.2a — the domain ledger: submit/claim/commit/cancel for science tasks with
// lease + fencing. Every state change is an atomic conditional UPDATE under the
// task row lock, so a duplicate delivery, a cancelled task or a settled task is
// never re-run and a fenced-out (stale) attempt can never publish. pg-boss only
// DELIVERS; this ledger is the authority (the same rule the RQ parse ledger in
// server/jobs.py follows — that ledger now filters kind='parse').
import { createHash } from 'node:crypto'
import type { Client, Pool } from './db.ts'
import type { ExperimentRun } from '../../src/experiments/protocol.ts'
import { canonicalJson } from '../../src/skills/playPlan.ts'

export const SCIENCE_QUEUE = 'paper2lab.science'
export const TASK_KIND = 'science'
export const DEFAULT_LEASE_SECONDS = 120

export function runContentSha256(run: ExperimentRun): string {
  return createHash('sha256').update(canonicalJson(run)).digest('hex')
}

function event(client: Client, taskId: number, eventType: string, body: Record<string, unknown>): Promise<unknown> {
  return client.query('INSERT INTO outbox_events (task_id, event_type, body) VALUES ($1, $2, $3::jsonb)', [taskId, eventType, JSON.stringify(body)])
}

export interface OperationRow {
  operationPk: number
  workspace: string
  operationId: string
  idempotencyKey: string
  skill: string
  inputDigest: string
  request: Record<string, unknown>
  taskId: number
  state: string
  runId: string | null
  receipt: Record<string, unknown> | null
}

export async function findOperation(db: Pool | Client, workspace: string, operationId: string, idempotencyKey: string): Promise<OperationRow | null> {
  const { rows } = await db.query<OperationRow>(
    'SELECT id AS "operationPk", workspace_id AS workspace, operation_id AS "operationId", idempotency_key AS "idempotencyKey", skill, input_digest AS "inputDigest", request, task_id AS "taskId", state, run_id AS "runId", receipt FROM science_operations WHERE workspace_id = $1 AND operation_id = $2 AND idempotency_key = $3',
    [workspace, operationId, idempotencyKey],
  )
  return rows[0] ? { ...rows[0], taskId: Number(rows[0].taskId) } : null
}

export async function operationForTask(db: Pool | Client, taskId: number): Promise<OperationRow | null> {
  const { rows } = await db.query<OperationRow>(
    'SELECT id AS "operationPk", workspace_id AS workspace, operation_id AS "operationId", idempotency_key AS "idempotencyKey", skill, input_digest AS "inputDigest", request, task_id AS "taskId", state, run_id AS "runId", receipt FROM science_operations WHERE task_id = $1',
    [taskId],
  )
  return rows[0] ? { ...rows[0], taskId: Number(rows[0].taskId) } : null
}

/** task + first attempt + queued event + operation receipt, on the caller's
 *  transaction client (the API route enqueues on the SAME client before COMMIT) */
export async function insertOperation(
  client: Client,
  args: { workspace: string; operationId: string; idempotencyKey: string; skill: string; inputDigest: string; request: Record<string, unknown> },
): Promise<{ taskId: number; operationPk: number }> {
  const { rows: taskRows } = await client.query<{ id: string }>(
    'INSERT INTO research_tasks (kind, payload) VALUES ($1, $2::jsonb) RETURNING id',
    [TASK_KIND, JSON.stringify({ skill: args.skill, operationId: args.operationId })],
  )
  const taskId = Number(taskRows[0].id)
  await client.query('INSERT INTO job_attempts (task_id, status, fence, detail) VALUES ($1, $2, $3, $4)', [taskId, 'queued', 0, 'submit'])
  await event(client, taskId, 'task.queued', { skill: args.skill, operationId: args.operationId })
  const { rows: opRows } = await client.query<{ id: string }>(
    'INSERT INTO science_operations (workspace_id, operation_id, idempotency_key, skill, input_digest, request, task_id) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING id',
    [args.workspace, args.operationId, args.idempotencyKey, args.skill, args.inputDigest, JSON.stringify(args.request), taskId],
  )
  return { taskId, operationPk: Number(opRows[0].id) }
}

export async function recordQueueJob(client: Client, taskId: number, jobId: string): Promise<void> {
  await client.query('UPDATE research_tasks SET queue_job_id = $1 WHERE id = $2', [jobId, taskId])
}

export interface Claim {
  taskId: number
  operationPk: number
  workspace: string
  attemptId: number
  fence: number
  owner: string
  /** ms the task waited between submit and this claim (one DB clock) */
  queueWaitMs?: number
}

/** atomic queued→running claim with a fresh fence. null = duplicate/cancelled/
 *  settled delivery (recorded as task.delivery_skipped); 'leased' = another
 *  attempt still holds a live lease (the reconciler requeues it on expiry).
 *  A task whose cancel was requested while an earlier attempt ran (and was
 *  then requeued by a crash/shutdown/lease expiry) is NEVER recomputed: the
 *  claim finalizes it as cancelled instead. */
export async function claimScienceTask(pool: Pool, taskId: number, owner: string, leaseSeconds = DEFAULT_LEASE_SECONDS): Promise<Claim | null | 'leased'> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{ fence: string; queue_wait_ms: string }>(
      "UPDATE research_tasks SET status = 'running', started_at = now(), lease_owner = $1, lease_expires_at = now() + make_interval(secs => $2), fence = fence + 1 WHERE id = $3 AND kind = $4 AND status = 'queued' AND cancel_requested_at IS NULL RETURNING fence, round(extract(epoch FROM (now() - created_at)) * 1000)::bigint AS queue_wait_ms",
      [owner, leaseSeconds, taskId, TASK_KIND],
    )
    if (rows.length === 0) {
      const { rows: current } = await client.query<{ status: string; live: boolean; cancel: boolean }>(
        'SELECT status, (lease_expires_at IS NOT NULL AND lease_expires_at > now()) AS live, (cancel_requested_at IS NOT NULL) AS cancel FROM research_tasks WHERE id = $1 FOR UPDATE',
        [taskId],
      )
      const row = current[0]
      if (row?.status === 'queued' && row.cancel) {
        await finalizeRequestedCancel(client, taskId, 'cancel requested before this delivery')
        await client.query('COMMIT')
        return null
      }
      if (row) await event(client, taskId, 'task.delivery_skipped', { status: row.status, worker: owner })
      await client.query('COMMIT')
      return row?.status === 'running' && row.live ? 'leased' : null
    }
    const fence = Number(rows[0].fence)
    const queueWaitMs = Number(rows[0].queue_wait_ms)
    const { rows: attemptRows } = await client.query<{ id: string }>(
      'INSERT INTO job_attempts (task_id, status, fence, detail) VALUES ($1, $2, $3, $4) RETURNING id',
      [taskId, 'running', fence, owner],
    )
    const { rows: opRows } = await client.query<{ id: string; workspace: string }>(
      'SELECT id, workspace_id AS workspace FROM science_operations WHERE task_id = $1',
      [taskId],
    )
    await event(client, taskId, 'task.running', { worker: owner, fence })
    await client.query('COMMIT')
    return { taskId, operationPk: Number(opRows[0].id), workspace: opRows[0].workspace, attemptId: Number(attemptRows[0].id), fence, owner, queueWaitMs }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** lease renewal while the engine computes (one short statement, fenced) */
export async function renewLease(pool: Pool, claim: Claim, leaseSeconds = DEFAULT_LEASE_SECONDS): Promise<boolean> {
  const { rowCount } = await pool.query(
    "UPDATE research_tasks SET lease_expires_at = now() + make_interval(secs => $1) WHERE id = $2 AND status = 'running' AND fence = $3 AND lease_owner = $4",
    [leaseSeconds, claim.taskId, claim.fence, claim.owner],
  )
  return rowCount === 1
}

export async function isCancelRequested(pool: Pool, claim: Claim): Promise<boolean> {
  const { rows } = await pool.query<{ requested: boolean }>(
    'SELECT (cancel_requested_at IS NOT NULL) AS requested FROM research_tasks WHERE id = $1 AND fence = $2',
    [claim.taskId, claim.fence],
  )
  return rows[0]?.requested === true
}

/** audit: which OS process computed this attempt, from which engine artifact */
export async function recordEngineStarted(pool: Pool, claim: Claim, details: Record<string, unknown>): Promise<void> {
  await pool.query('INSERT INTO outbox_events (task_id, event_type, body) VALUES ($1, $2, $3::jsonb)', [claim.taskId, 'engine.started', JSON.stringify({ ...details, fence: claim.fence })])
}

export type CommitResult = 'committed' | 'fenced' | 'cancelled' | 'settled'

/** lock the task row and check this attempt still owns it */
async function lockOwned(client: Client, claim: Claim): Promise<{ owned: boolean; cancelRequested: boolean }> {
  const { rows } = await client.query<{ status: string; fence: string; lease_owner: string | null; cancel: boolean }>(
    'SELECT status, fence, lease_owner, (cancel_requested_at IS NOT NULL) AS cancel FROM research_tasks WHERE id = $1 FOR UPDATE',
    [claim.taskId],
  )
  const row = rows[0]
  const owned = !!row && row.status === 'running' && Number(row.fence) === claim.fence && row.lease_owner === claim.owner
  return { owned, cancelRequested: owned && row.cancel }
}

async function finishTask(client: Client, claim: Claim, status: string, result: Record<string, unknown>, detail: string): Promise<void> {
  await client.query(
    'UPDATE research_tasks SET status = $1, result = $2::jsonb, finished_at = now(), lease_owner = NULL, lease_expires_at = NULL WHERE id = $3 AND fence = $4',
    [status, JSON.stringify(result), claim.taskId, claim.fence],
  )
  await client.query('UPDATE job_attempts SET status = $1, detail = $2 WHERE id = $3', [status, detail.slice(0, 500), claim.attemptId])
}

async function settleCancelled(client: Client, claim: Claim, receipt: Record<string, unknown>): Promise<void> {
  await client.query(
    "UPDATE science_operations SET state = 'cancelled', receipt = $1::jsonb, settled_at = now() WHERE id = $2 AND state = 'accepted'",
    [JSON.stringify(receipt), claim.operationPk],
  )
  await finishTask(client, claim, 'cancelled', { cancelled: true }, 'cancelled by request')
  await event(client, claim.taskId, 'task.cancelled', { fence: claim.fence, discardedRunId: receipt.discardedRunId ?? null })
}

/** a task whose cancel was already requested and that holds no live attempt
 *  (requeued after a crash/shutdown/lease expiry) settles cancelled without
 *  computing again; caller holds the task row lock */
async function finalizeRequestedCancel(client: Client, taskId: number, reason: string): Promise<void> {
  await client.query("UPDATE research_tasks SET status = 'cancelled', finished_at = now(), lease_owner = NULL, lease_expires_at = NULL WHERE id = $1", [taskId])
  await client.query(
    "UPDATE science_operations SET state = 'cancelled', receipt = $1::jsonb, settled_at = now() WHERE task_id = $2 AND state = 'accepted'",
    [JSON.stringify({ state: 'cancelled', message: reason }), taskId],
  )
  await client.query("INSERT INTO job_attempts (task_id, status, detail) VALUES ($1, 'cancelled', $2)", [taskId, reason.slice(0, 500)])
  await event(client, taskId, 'task.cancelled', { reason })
}

/** THE publish point: one fenced short transaction commits the Run row, the
 *  settled operation receipt, the task/attempt terminal state and the outbox
 *  event — or nothing. A cancel requested before this point wins: the result
 *  is discarded (its compute is still reported in the receipt), never
 *  published as evidence. */
export async function commitRun(
  pool: Pool,
  claim: Claim,
  run: ExperimentRun,
  receipt: Record<string, unknown>,
  governingPlan: unknown,
  skill: string,
): Promise<CommitResult> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { owned, cancelRequested } = await lockOwned(client, claim)
    if (!owned) {
      await client.query('ROLLBACK')
      return 'fenced'
    }
    if (cancelRequested) {
      await settleCancelled(client, claim, { ...receipt, state: 'cancelled', discardedRunId: run.runId, run: undefined })
      await client.query('COMMIT')
      return 'cancelled'
    }
    const { rows: op } = await client.query<{ state: string }>('SELECT state FROM science_operations WHERE id = $1 FOR UPDATE', [claim.operationPk])
    if (op[0]?.state !== 'accepted') {
      await client.query('ROLLBACK')
      return 'settled'
    }
    await client.query(
      'INSERT INTO experiment_runs (run_id, workspace_id, operation_pk, task_id, attempt_id, fence, skill, kind, status, parent_run_id, engine, engine_version, record_json, governing_plan, content_sha256) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15)',
      [run.runId, claim.workspace, claim.operationPk, claim.taskId, claim.attemptId, claim.fence, skill, run.spec.kind, run.status, run.parentRunId ?? null, run.engine, run.engineVersion, JSON.stringify(run), governingPlan === undefined || governingPlan === null ? null : JSON.stringify(governingPlan), runContentSha256(run)],
    )
    const finalState = receipt.state === 'completed' ? 'completed' : 'error'
    await client.query(
      'UPDATE science_operations SET state = $1, receipt = $2::jsonb, run_id = $3, settled_at = now() WHERE id = $4',
      [finalState, JSON.stringify(receipt), run.runId, claim.operationPk],
    )
    const taskStatus = finalState === 'completed' ? 'succeeded' : 'failed'
    await finishTask(client, claim, taskStatus, { runId: run.runId, runStatus: run.status }, `fence ${claim.fence} ${run.status}`)
    await event(client, claim.taskId, taskStatus === 'succeeded' ? 'run.committed' : 'task.failed', { runId: run.runId, runStatus: run.status, kind: run.spec.kind, fence: claim.fence })
    await client.query('COMMIT')
    return 'committed'
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** settle a claim WITHOUT a run: engine refusal (needs_input/unsupported/
 *  invalid_input), a payload-only completion (compare), timeout/crash, or a
 *  confirmed cancellation */
export async function settleWithoutRun(
  pool: Pool,
  claim: Claim,
  receipt: Record<string, unknown>,
): Promise<CommitResult> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { owned, cancelRequested } = await lockOwned(client, claim)
    if (!owned) {
      await client.query('ROLLBACK')
      return 'fenced'
    }
    if (cancelRequested || receipt.state === 'cancelled') {
      await settleCancelled(client, claim, { ...receipt, state: 'cancelled' })
      await client.query('COMMIT')
      return 'cancelled'
    }
    const state = String(receipt.state)
    await client.query(
      "UPDATE science_operations SET state = $1, receipt = $2::jsonb, settled_at = now() WHERE id = $3 AND state = 'accepted'",
      [state, JSON.stringify(receipt), claim.operationPk],
    )
    const taskStatus = state === 'completed' ? 'succeeded' : 'failed'
    await finishTask(client, claim, taskStatus, { state, errorCode: receipt.errorCode ?? null }, String(receipt.message ?? state))
    await event(client, claim.taskId, taskStatus === 'succeeded' ? 'task.succeeded' : 'task.failed', { state, errorCode: receipt.errorCode ?? null })
    await client.query('COMMIT')
    return 'committed'
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** graceful shutdown / pg-boss abort: hand the task back to the queue under
 *  the same fence (the next claim bumps it, fencing this attempt out). A task
 *  whose cancel was requested is settled cancelled here instead — a requeue
 *  must never resurrect a cancelled operation. */
export async function releaseClaim(pool: Pool, claim: Claim, reason: string): Promise<boolean> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { owned, cancelRequested } = await lockOwned(client, claim)
    if (!owned) {
      await client.query('ROLLBACK')
      return false
    }
    if (cancelRequested) {
      await settleCancelled(client, claim, { state: 'cancelled', message: `cancelled (attempt released: ${reason})` })
      await client.query('COMMIT')
      return true
    }
    await client.query("UPDATE research_tasks SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL WHERE id = $1", [claim.taskId])
    await client.query("UPDATE job_attempts SET status = 'interrupted', detail = $1 WHERE id = $2", [reason.slice(0, 500), claim.attemptId])
    await event(client, claim.taskId, 'task.requeued', { reason, fence: claim.fence })
    await client.query('COMMIT')
    return true
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** API cancel. queued → cancelled at once; running → cancel_requested (the
 *  owning worker kills ITS engine, confirms exit, then settles cancelled).
 *  A settled task is final: a late cancel never overwrites a committed result. */
export async function requestCancel(pool: Pool, taskId: number): Promise<'cancelled' | 'cancel_requested' | 'already_final' | 'unknown'> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{ status: string }>('SELECT status FROM research_tasks WHERE id = $1 AND kind = $2 FOR UPDATE', [taskId, TASK_KIND])
    if (rows.length === 0) {
      await client.query('ROLLBACK')
      return 'unknown'
    }
    const status = rows[0].status
    if (status === 'queued') {
      await client.query("UPDATE research_tasks SET status = 'cancelled', finished_at = now() WHERE id = $1", [taskId])
      await client.query(
        "UPDATE science_operations SET state = 'cancelled', receipt = $1::jsonb, settled_at = now() WHERE task_id = $2 AND state = 'accepted'",
        [JSON.stringify({ state: 'cancelled', message: 'cancelled while queued (no attempt running)' }), taskId],
      )
      await client.query("INSERT INTO job_attempts (task_id, status, detail) VALUES ($1, 'cancelled', 'cancelled while queued')", [taskId])
      await event(client, taskId, 'task.cancelled', { while: 'queued' })
      await client.query('COMMIT')
      return 'cancelled'
    }
    if (status === 'running') {
      await client.query('UPDATE research_tasks SET cancel_requested_at = COALESCE(cancel_requested_at, now()) WHERE id = $1', [taskId])
      await event(client, taskId, 'task.cancel_requested', {})
      await client.query('COMMIT')
      return 'cancel_requested'
    }
    await client.query('ROLLBACK')
    return 'already_final'
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** reconciler: a running task whose lease expired lost its worker (crash,
 *  kill -9, partition). Its attempt is marked interrupted and fenced out; the
 *  task goes back to queued — or, when a cancel was requested meanwhile, is
 *  finalized cancelled right here instead of waiting for another delivery. */
export async function requeueExpiredLeases(pool: Pool): Promise<number[]> {
  const { rows: expired } = await pool.query<{ id: string }>(
    "SELECT id FROM research_tasks WHERE kind = $1 AND status = 'running' AND lease_expires_at < now() ORDER BY id",
    [TASK_KIND],
  )
  const requeued: number[] = []
  for (const row of expired) {
    const taskId = Number(row.id)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      // re-check under the row lock: the owner may have renewed or settled
      const { rows } = await client.query<{ fence: string; cancel: boolean }>(
        "SELECT fence, (cancel_requested_at IS NOT NULL) AS cancel FROM research_tasks WHERE id = $1 AND status = 'running' AND lease_expires_at < now() FOR UPDATE",
        [taskId],
      )
      if (rows.length === 0) {
        await client.query('ROLLBACK')
        continue
      }
      await client.query("UPDATE job_attempts SET status = 'interrupted', detail = 'lease expired' WHERE task_id = $1 AND fence = $2 AND status = 'running'", [taskId, Number(rows[0].fence)])
      if (rows[0].cancel) {
        await finalizeRequestedCancel(client, taskId, 'cancelled (owning attempt lost its lease)')
      } else {
        await client.query("UPDATE research_tasks SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL WHERE id = $1", [taskId])
        await event(client, taskId, 'task.requeued', { reason: 'lease_expired' })
        requeued.push(taskId)
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }
  return requeued
}

/** reconciler: queued science tasks, their recorded queue job id, and whether
 *  an attempt already claimed them before (a requeued task's old job is stale) */
export async function queuedTasks(pool: Pool): Promise<Array<{ taskId: number; queueJobId: string | null; requeued: boolean }>> {
  const { rows } = await pool.query<{ id: string; queue_job_id: string | null; requeued: boolean }>(
    "SELECT id, queue_job_id, (started_at IS NOT NULL) AS requeued FROM research_tasks WHERE kind = $1 AND status = 'queued' ORDER BY id",
    [TASK_KIND],
  )
  return rows.map((r) => ({ taskId: Number(r.id), queueJobId: r.queue_job_id, requeued: r.requeued }))
}

export async function setQueueJob(pool: Pool, taskId: number, jobId: string): Promise<void> {
  await pool.query("UPDATE research_tasks SET queue_job_id = $1 WHERE id = $2 AND status = 'queued'", [jobId, taskId])
}
