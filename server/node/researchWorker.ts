// J1.2b — the research worker: consumes research deliveries, runs ONE bounded
// DSH activation per turn (which may make many science tool calls), collects
// the committed run ids from the trace, and settles the turn. A turn without
// provider credentials is settled blocked-credential — never faked as AI.
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { PgBoss } from 'pg-boss'
import type { Pool } from './db.ts'
import { RESEARCH_QUEUE, claimResearchTurn, settleResearchTurn } from './researchLedger.ts'
import { ActivationCancelled, isFallbackWorthyFailure, readFallbackConfig, readModelChain, readQwenConfig, runResearchActivation, type ActivationConfig, type ActivationTrace } from './dsh/activate.ts'
import { loadRun } from './runs.ts'

export interface ResearchWorkerOptions {
  pool: Pool
  boss: PgBoss
  /** override for tests: run the activation locally instead of DSH */
  runActivation?: (cfg: ActivationConfig, prompt: string, sessionId?: string, shouldAbort?: () => boolean) => Promise<ActivationTrace>
  concurrency?: number
  reconcileMs?: number
}

const LIVE_JOB_STATES = new Set(['created', 'retry', 'active'])
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function ensureResearchQueue(boss: PgBoss): Promise<void> {
  if (await boss.getQueue(RESEARCH_QUEUE)) return
  await boss.createQueue(RESEARCH_QUEUE, { retryLimit: 2, retryDelay: 5, expireInSeconds: 3600, deleteAfterSeconds: 7 * 24 * 3600 })
}

export interface ResearchWorker {
  owner: string
  stop: () => Promise<void>
}

export async function startResearchWorker(opts: ResearchWorkerOptions): Promise<ResearchWorker> {
  const { pool, boss } = opts
  const owner = `research-worker:${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`
  const runActivation = opts.runActivation ?? runResearchActivation
  let stopping = false
  let workId: string | null = null
  let reconcileTimer: NodeJS.Timeout | null = null

  await ensureResearchQueue(boss)

  /** one model turn can run for many minutes; a lease keeps the reconciler
   *  from requeueing it while the wall clock is legitimately still ticking */
  const renew = (taskId: number) => setInterval(() => {
    pool.query("UPDATE research_tasks SET lease_expires_at = now() + make_interval(secs => $1) WHERE id = $2 AND status = 'running' AND lease_owner = $3", [900, taskId, owner]).catch(() => {})
  }, 120_000)

  const processTask = async (taskId: number): Promise<void> => {
    if (stopping) throw new Error('research worker stopping')
    const claim = await claimResearchTurn(pool, taskId, owner)
    if (claim === null) return
    const lease = renew(taskId)
    try {
      const cfg = readQwenConfig()
      if ('error' in cfg) {
        await settleResearchTurn(pool, taskId, { kind: 'failed', error: cfg.error, provider: 'qwen', model: 'unconfigured' })
        return
      }
      // who actually answers this turn (primary unless the fallback fired)
      let activeProvider = cfg
      // seed the turn with what already exists, so the model can pick up the
      // session's committed runs by id instead of re-listing everything
      const seed = claim.sessionId ? await sessionSeed(pool, claim.workspace, claim.sessionId) : ''
      const prompt = seed ? `${claim.prompt}\n\n[session context] Committed runs so far (newest last):\n${seed}` : claim.prompt
      // cooperative cancel: the API sets cancel_requested_at; poll it while
      // the model runs — a cancel closes the DSH runtime and discards the
      // partial answer instead of letting it run to completion
      let abortFlag = false
      const abortPoll = setInterval(() => {
        pool.query('SELECT (cancel_requested_at IS NOT NULL) AS requested FROM research_tasks WHERE id = $1', [taskId])
          .then(({ rows }) => {
            if (rows[0]?.requested === true) abortFlag = true
          })
          .catch(() => {})
      }, 1_000)
      const isAborted = () => abortFlag
      let trace: ActivationTrace
      const triedModels: string[] = []
      try {
        // 百炼模型 ID 故障切换链：主模型不可用（配额/认证/模型不存在类，
        // 且没有产生任何回答）时，同一 key 按序立刻换下一个 ID；一轮最多
        // 试 3 个（这类失败通常秒级返回），谁先答上谁就是本回合的模型。
        const chain = readModelChain().slice(0, 3)
        trace = undefined as unknown as ActivationTrace
        for (const model of chain) {
          const modelCfg: ActivationConfig = model === cfg.model ? cfg : { ...cfg, model }
          const t = await runActivation(modelCfg, prompt, (trace as ActivationTrace | undefined)?.sessionId || claim.sessionId || undefined, isAborted)
          trace = t
          triedModels.push(modelCfg.model)
          activeProvider = modelCfg
          if (t.finalResponse || !isFallbackWorthyFailure(t)) break
        }
        // quota-exhaustion fallback with a SEPARATE key (if configured) runs
        // after the same-key model chain is exhausted. Cancellation is never retried.
        const fallback = readFallbackConfig()
        if (fallback && isFallbackWorthyFailure(trace)) {
          trace = await runActivation(fallback, prompt, trace.sessionId || claim.sessionId || undefined, isAborted)
          activeProvider = fallback
        }
      } catch (err) {
        if (err instanceof ActivationCancelled) {
          await settleResearchTurn(pool, taskId, { kind: 'cancelled', reason: 'cancelled while the model was running; runtime closed, partial output discarded' })
          return
        }
        throw err
      } finally {
        clearInterval(abortPoll)
      }
      if (!trace.runtimeClosed) {
        // the answer exists but the runtime did not confirm shutdown — report
        // it; never present a turn whose host may still be mutating
        await settleResearchTurn(pool, taskId, { kind: 'failed', error: `DSH runtime close failed (finishReason ${trace.finishReason ?? 'unknown'})`, provider: activeProvider.provider, model: activeProvider.model })
        return
      }
      const runIds: string[] = []
      for (const step of trace.steps) {
        const meta = step.meta as { run?: { runId?: string }; runIds?: string[] } | undefined
        if (meta?.run?.runId) runIds.push(String(meta.run.runId))
        if (Array.isArray(meta?.runIds)) for (const id of meta.runIds) runIds.push(String(id))
      }
      // a turn whose runtime reported finishReason=error produced NO model
      // answer — settling it "succeeded" with an empty finalResponse would
      // surface as a blank success in the UI. Some providers stream text but
      // never send a final block: the last assistant text is then the answer.
      const lastAssistant = trace.assistantTexts.at(-1)?.text?.trim() ?? ''
      const answer = trace.finalResponse || lastAssistant
      if (!answer && (trace.finishReason === 'error' || trace.finishReason === null)) {
        await settleResearchTurn(pool, taskId, {
          kind: 'failed',
          error: `模型回合以 finishReason=${trace.finishReason ?? 'unknown'} 结束且没有产生回答（供应商错误或凭据问题；已按序尝试 ${triedModels.join(' → ')}；provider=${activeProvider.provider} model=${activeProvider.model}${trace.sessionId ? `；会话 ${trace.sessionId} 历史已保留` : ''}）`,
          provider: activeProvider.provider,
          model: activeProvider.model,
          sessionId: trace.sessionId || undefined,
        })
        return
      }
      await settleResearchTurn(pool, taskId, {
        kind: 'succeeded',
        sessionId: trace.sessionId,
        finishReason: trace.finishReason,
        finalResponse: answer,
        steps: trace.steps as unknown as Array<Record<string, unknown>>,
        assistantTexts: trace.assistantTexts as unknown as Array<Record<string, unknown>>,
        usage: trace.usage as Array<Record<string, unknown>>,
        runIds: [...new Set(runIds)],
        provider: activeProvider.provider,
        model: activeProvider.model,
      })
    } catch (err) {
      await settleResearchTurn(pool, taskId, { kind: 'failed', error: err instanceof Error ? err.message : String(err), provider: 'qwen', model: '' }).catch(() => {})
      throw err
    } finally {
      clearInterval(lease)
    }
  }

  workId = await boss.work<{ taskId: number }>(
    RESEARCH_QUEUE,
    { localConcurrency: opts.concurrency ?? 1, batchSize: 1, pollingIntervalSeconds: 1 },
    async (jobs) => {
      for (const job of jobs) {
        const taskId = Number(job.data?.taskId)
        if (!Number.isSafeInteger(taskId) || taskId <= 0) throw new Error('research delivery carried a malformed taskId')
        await processTask(taskId)
      }
    },
  )

  const reconcile = async (): Promise<void> => {
    if (stopping) return
    // a research turn whose lease expired was interrupted (worker crash /
    // kill). NEVER re-prompt automatically — the model may have billed, and a
    // replay could double-spend. Settle it failed with an explicit reason so
    // the UI shows a terminal state and the user can submit a fresh turn; the
    // grace window (2× lease) covers a legitimately slow renewing owner.
    const { rows: orphaned } = await pool.query<{ id: string }>(
      "SELECT id FROM research_tasks WHERE kind = $1 AND status = 'running' AND lease_expires_at < now() - make_interval(secs => $2::int)",
      ['research', 1_800],
    )
    for (const row of orphaned) {
      await settleResearchTurn(pool, Number(row.id), { kind: 'failed', error: 'interrupted: the owning activation lost its lease (worker crash or restart) — submit a new turn to continue; the session history survives', provider: 'qwen', model: '' }).catch(() => {})
    }
    // still-queued turns whose delivery vanished get re-sent (no model call
    // has happened, so re-prompting cannot double-spend)
    const { rows } = await pool.query<{ id: string; queue_job_id: string | null }>(
      "SELECT t.id, t.queue_job_id FROM research_tasks t WHERE t.kind = $1 AND t.status = 'queued' ORDER BY t.id",
      ['research'],
    )
    for (const row of rows) {
      const taskId = Number(row.id)
      const jobId = row.queue_job_id
      const job = jobId && JOB_ID_PATTERN.test(jobId) ? await boss.getJobById(RESEARCH_QUEUE, jobId) : null
      if (job && LIVE_JOB_STATES.has(job.state)) continue
      const id = await boss.send(RESEARCH_QUEUE, { taskId })
      if (id) await pool.query("UPDATE research_tasks SET queue_job_id = $1 WHERE id = $2 AND status = 'queued'", [id, taskId])
    }
  }
  reconcileTimer = setInterval(() => {
    reconcile().catch((err) => console.error('[paper2lab-node] research reconcile failed:', err instanceof Error ? err.message : err))
  }, opts.reconcileMs ?? 5_000)
  reconcileTimer.unref()
  await reconcile()

  return {
    owner,
    stop: async () => {
      stopping = true
      if (reconcileTimer) clearInterval(reconcileTimer)
      if (workId) await boss.offWork(RESEARCH_QUEUE, { id: workId, wait: true }).catch(() => {})
      // in-flight activations finish their current turn (settle already ran or
      // will run); their tasks keep the lease until then
    },
  }
}

/** a compact id list of the session's runs, verified against experiment_runs */
async function sessionSeed(pool: Pool, workspace: string, sessionId: string): Promise<string> {
  const { rows } = await pool.query<{ run_ids: unknown }>('SELECT run_ids FROM research_turns WHERE workspace_id = $1 AND session_id = $2 AND status = $3', [workspace, sessionId, 'succeeded'])
  const ids: string[] = []
  for (const row of rows) {
    const parsed = Array.isArray(row.run_ids) ? row.run_ids : JSON.parse(String(row.run_ids || '[]'))
    for (const id of parsed) if (typeof id === 'string') ids.push(id)
  }
  const existing: string[] = []
  for (const id of [...new Set(ids)].slice(-8)) {
    if (await loadRun(pool, workspace, id)) existing.push(id)
  }
  return existing.map((id) => `- ${id}`).join('\n')
}
