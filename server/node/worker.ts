// J1.2a — the science worker. pg-boss delivers {taskId}; the DOMAIN ledger
// decides (claim with a fresh fence). Each delivery runs ONE owned engine child
// in candidate mode, verification happens in prepare.ts against the Registry,
// and publishing is one fenced short transaction in the ledger. Computation
// happens outside every transaction; the lease is renewed in the background so
// a long compute never looks dead, and health reads the ledger instead of
// pinging a busy engine.
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { PgBoss } from 'pg-boss'
import type { Pool } from './db.ts'
import {
  SCIENCE_QUEUE,
  DEFAULT_LEASE_SECONDS,
  claimScienceTask,
  commitRun,
  isCancelRequested,
  operationForTask,
  queuedTasks,
  recordEngineStarted,
  releaseClaim,
  renewLease,
  requeueExpiredLeases,
  setQueueJob,
  settleWithoutRun,
  type Claim,
  type OperationRow,
} from './ledger.ts'
import { runEngine, type EngineCommand, type EngineResult } from './engine.ts'
import { prepareEngineRequest, verifyCandidate } from './prepare.ts'
import type { ExperimentRun } from '../../src/experiments/protocol.ts'

export interface WorkerHooks {
  afterCompute?: (claim: Claim) => Promise<void> | void
  beforeCommit?: (claim: Claim) => Promise<void> | void
  afterCommit?: (claim: Claim) => Promise<void> | void
}

export interface ScienceWorkerOptions {
  pool: Pool
  boss: PgBoss
  engine: EngineCommand
  owner?: string
  concurrency?: number
  leaseSeconds?: number
  engineTimeoutMs?: number
  reconcileMs?: number
  cancelPollMs?: number
  hooks?: WorkerHooks
}

export interface ScienceWorker {
  owner: string
  stop: () => Promise<void>
  inflightPids: () => Map<number, number | undefined>
  reconcile: () => Promise<void>
}

/** a queue job still WAITING for delivery. An 'active' job whose task the
 *  ledger holds as queued is stale — its worker died and the lease expired —
 *  so the reconciler re-delivers without waiting for pg-boss's own expiry
 *  (claims are idempotent: a duplicate delivery only records a skip). */
const PENDING_JOB_STATES = new Set(['created', 'retry'])
/** pg-boss job ids are uuid-shaped; anything else never matches a job */
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function asTaskId(value: unknown): number | null {
  const n = Number(value)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

function asJobId(value: unknown): string | null {
  return typeof value === 'string' && JOB_ID_PATTERN.test(value) ? value : null
}

export async function ensureScienceQueue(boss: PgBoss): Promise<void> {
  if (await boss.getQueue(SCIENCE_QUEUE)) return
  // delivery only: retries re-deliver the taskId; the ledger decides whether
  // anything runs. Long expiry — the DOMAIN lease, not pg-boss, times attempts.
  await boss.createQueue(SCIENCE_QUEUE, { retryLimit: 5, retryDelay: 1, expireInSeconds: 3600, deleteAfterSeconds: 7 * 24 * 3600 })
}

/** start the science worker; the returned handle stops it (kills in-flight
 *  engines, hands tasks back to the queue under a superseded fence) */
export async function startScienceWorker(opts: ScienceWorkerOptions): Promise<ScienceWorker> {
  const { pool, boss, engine } = opts
  const owner = opts.owner ?? `node-worker:${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`
  const leaseSeconds = opts.leaseSeconds ?? DEFAULT_LEASE_SECONDS
  const engineTimeoutMs = opts.engineTimeoutMs ?? 300_000
  const hooks = opts.hooks ?? {}
  const inflight = new Map<number, { abort: AbortController; pid?: number }>()
  let stopping = false
  let reconcileTimer: NodeJS.Timeout | null = null
  let workId: string | null = null

  await ensureScienceQueue(boss)

  const requeueMissing = async (): Promise<void> => {
    await requeueExpiredLeases(pool)
    for (const row of await queuedTasks(pool)) {
      const taskId = asTaskId(row.taskId)
      if (taskId === null) continue
      const jobId = asJobId(row.queueJobId)
      const job = jobId ? await boss.getJobById(SCIENCE_QUEUE, jobId) : null
      // a never-claimed task's 'active' job is being delivered right now; a
      // requeued task's 'active' job belongs to the dead attempt
      if (job && (PENDING_JOB_STATES.has(job.state) || (!row.requeued && job.state === 'active'))) continue
      const id = await boss.send(SCIENCE_QUEUE, { taskId })
      if (id) await setQueueJob(pool, taskId, id)
    }
  }

  const receiptBase = (op: OperationRow, claim: Claim): Record<string, unknown> => ({
    operationId: op.operationId,
    idempotencyKey: op.idempotencyKey,
    skill: op.skill,
    inputDigest: op.inputDigest,
    taskId: claim.taskId,
    attemptId: claim.attemptId,
    fence: claim.fence,
  })

  const execute = async (claim: Claim, abort: AbortController): Promise<void> => {
    const op = await operationForTask(pool, claim.taskId)
    if (!op) throw new Error(`task ${claim.taskId} has no science operation`)
    const base = receiptBase(op, claim)
    const prepareStarted = performance.now()
    const prepared = await prepareEngineRequest(pool, op)
    const prepareMs = Math.round(performance.now() - prepareStarted)
    if ('refusal' in prepared) {
      await settleWithoutRun(pool, claim, { ...base, ...prepared.refusal })
      return
    }
    let enginePid: number | undefined
    const result: EngineResult = await runEngine(engine, prepared.request, {
      signal: abort.signal,
      timeoutMs: engineTimeoutMs,
      onSpawn: (pid) => {
        enginePid = pid
        const tracked = inflight.get(claim.taskId)
        if (tracked) tracked.pid = pid
        recordEngineStarted(pool, claim, { pid, artifact: engine.artifact }).catch(() => {})
      },
    })
    void enginePid
    await hooks.afterCompute?.(claim)
    // phase spans of this attempt: each measured in the process that ran it
    // (worker: prepare/engine wall/verify; engine: boot/read/execute) — the
    // engine spans nest inside engineWallMs and must not be added to it
    const usage: Record<string, unknown> = {
      engineWallMs: result.wallMs,
      enginePid: result.pid,
      engineArtifact: engine.artifact,
      engineMode: 'once-process-per-task',
      ...(claim.queueWaitMs !== undefined ? { queueWaitMs: claim.queueWaitMs } : {}),
      prepareMs,
      ...(result.kind === 'outcome' && result.timing ? { engine: result.timing } : {}),
    }
    if (result.kind === 'aborted') {
      if (result.reason === 'shutdown') {
        await releaseClaim(pool, claim, `worker shutdown (engine exit ${result.exit.signal ?? result.exit.code})`)
        return
      }
      const timedOut = result.reason === 'timeout'
      await settleWithoutRun(pool, claim, {
        ...base,
        state: timedOut ? 'error' : 'cancelled',
        ...(timedOut ? { errorCode: 'timeout', message: `engine exceeded ${engineTimeoutMs} ms and was killed` } : { message: 'cancelled; owned engine process confirmed exited' }),
        engineExit: result.exit,
        usage,
      })
      return
    }
    if (result.kind === 'failed') {
      await settleWithoutRun(pool, claim, { ...base, state: 'error', errorCode: 'engine_failed', message: result.message, stderrTail: result.stderrTail.slice(-600), engineExit: result.exit, usage })
      return
    }
    const outcome = result.outcome
    const receipt: Record<string, unknown> = { ...base, ...receiptFromOutcome(outcome), usage }
    const run = (outcome.run ?? undefined) as ExperimentRun | undefined
    if (run) {
      const verifyStarted = performance.now()
      const rejection = verifyCandidate(run, op, prepared.expect)
      usage.verifyMs = Math.round(performance.now() - verifyStarted)
      if (rejection) {
        await settleWithoutRun(pool, claim, { ...base, state: 'error', errorCode: 'candidate_rejected', message: rejection, usage })
        return
      }
      await hooks.beforeCommit?.(claim)
      receipt.run = runSummary(run)
      await commitRun(pool, claim, run, receipt, prepared.governingPlan, op.skill)
      await hooks.afterCommit?.(claim)
      return
    }
    await hooks.beforeCommit?.(claim)
    await settleWithoutRun(pool, claim, receipt)
    await hooks.afterCommit?.(claim)
  }

  const processTask = async (taskId: number, jobSignal: AbortSignal): Promise<void> => {
    if (stopping) throw new Error('worker stopping')
    const claim = await claimScienceTask(pool, taskId, owner, leaseSeconds)
    if (claim === null || claim === 'leased') return
    const abort = new AbortController()
    inflight.set(taskId, { abort })
    const renew = setInterval(() => {
      renewLease(pool, claim, leaseSeconds).catch(() => {})
    }, Math.max(500, (leaseSeconds * 1000) / 4))
    const cancelPoll = setInterval(() => {
      isCancelRequested(pool, claim).then((requested) => {
        if (requested) abort.abort('cancel')
      }).catch(() => {})
    }, opts.cancelPollMs ?? 300)
    const onJobAbort = () => abort.abort('shutdown')
    jobSignal.addEventListener('abort', onJobAbort, { once: true })
    try {
      await execute(claim, abort)
    } finally {
      clearInterval(renew)
      clearInterval(cancelPoll)
      jobSignal.removeEventListener('abort', onJobAbort)
      inflight.delete(taskId)
    }
  }

  workId = await boss.work<{ taskId: number }>(
    SCIENCE_QUEUE,
    { localConcurrency: opts.concurrency ?? 2, batchSize: 1, pollingIntervalSeconds: 0.5 },
    async (jobs) => {
      for (const job of jobs) {
        const taskId = asTaskId(job.data?.taskId)
        if (taskId === null) throw new Error('science delivery carried a malformed taskId')
        await processTask(taskId, job.signal)
      }
    },
  )
  reconcileTimer = setInterval(() => {
    requeueMissing().catch((err) => console.error('[paper2lab-node] reconcile failed:', err instanceof Error ? err.message : err))
  }, opts.reconcileMs ?? 5_000)
  reconcileTimer.unref()
  await requeueMissing()

  return {
    owner,
    reconcile: requeueMissing,
    inflightPids: () => new Map([...inflight.entries()].map(([taskId, e]) => [taskId, e.pid])),
    stop: async () => {
      stopping = true
      if (reconcileTimer) clearInterval(reconcileTimer)
      for (const entry of inflight.values()) entry.abort.abort('shutdown')
      if (workId) await boss.offWork(SCIENCE_QUEUE, { id: workId, wait: true }).catch(() => {})
    },
  }
}

/** the transport receipt from an executor outcome — toolPort semantics */
function receiptFromOutcome(outcome: Record<string, unknown>): Record<string, unknown> {
  switch (outcome.status) {
    case 'ok':
      return { state: 'completed', ...(outcome.payload !== undefined ? { payload: outcome.payload } : {}) }
    case 'needs_input':
      return { state: 'needs_input', missingFields: outcome.missing, message: outcome.message }
    case 'unsupported':
      return { state: 'unsupported', message: outcome.message }
    default:
      return { state: 'error', errorCode: outcome.code ?? 'execution_failed', message: outcome.message }
  }
}

function runSummary(run: ExperimentRun): Record<string, unknown> {
  return {
    runId: run.runId,
    kind: run.spec.kind,
    status: run.status,
    parentRunId: run.parentRunId ?? null,
    engine: run.engine,
    engineVersion: run.engineVersion,
    durationMs: run.durationMs,
    errors: run.errors,
  }
}
