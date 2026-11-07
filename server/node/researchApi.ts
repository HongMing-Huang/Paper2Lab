// J1.2b — the research API: submit a question (a research turn), poll its
// trace, read the session's history, and check provider readiness. CORS is
// open for the local Vite origin; credentials never appear in any response.
import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import type { Pool } from './db.ts'
import { bossDb } from './db.ts'
import { registerBearerAuth } from './auth.ts'
import { RESEARCH_QUEUE, getResearchTurn, listRecentTurns, listSessionTurns, insertResearchTurn, type ResearchTurnRow } from './researchLedger.ts'
import { readQwenConfig } from './dsh/activate.ts'
import type { PgBoss } from 'pg-boss'

export interface ResearchApiOptions {
  pool: Pool
  boss: PgBoss
  workspace?: string
  maxPromptChars?: number
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/

function turnView(turn: ResearchTurnRow): Record<string, unknown> {
  return {
    turnId: turn.turnId,
    taskId: turn.taskId,
    sessionId: turn.sessionId,
    prompt: turn.prompt,
    status: turn.status,
    finishReason: turn.finishReason,
    finalResponse: turn.finalResponse,
    steps: turn.steps,
    assistantTexts: turn.assistantTexts,
    usage: turn.usage,
    runIds: turn.runIds,
    provider: turn.provider,
    model: turn.model,
    error: turn.error,
  }
}

export function buildResearchApi(opts: ResearchApiOptions & { app?: FastifyInstance }): FastifyInstance {
  // register on the caller's instance when given (one listener for science +
  // research), else on a fresh one (tests / a standalone research service)
  const app = opts.app ?? Fastify({ logger: false })
  registerBearerAuth(app)
  const { pool, boss } = opts
  const workspace = opts.workspace ?? 'default'
  const maxPromptChars = opts.maxPromptChars ?? 8000

  // CORS: local development origins only (Vite on the loopback); same-origin
  // requests and the curl/CLI path need no CORS at all. Preflights for the
  // research routes are answered here, so no wildcard OPTIONS route is needed.
  const LOOPBACK_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/
  app.addHook('onRequest', async (req, reply) => {
    const origin = String(req.headers.origin ?? '')
    if (!LOOPBACK_ORIGIN.test(origin) || !req.url.startsWith('/api/v1/')) return
    reply.header('access-control-allow-origin', origin)
    reply.header('vary', 'origin')
    reply.header('access-control-allow-methods', 'GET, POST, OPTIONS')
    reply.header('access-control-allow-headers', 'content-type')
    if (req.method === 'OPTIONS') return reply.code(204).send()
  })

  app.get('/api/v1/research/health', async () => {
    const cfg = readQwenConfig()
    const configured = !('error' in cfg)
    // the runner loads the isolated SDK dynamically; probe the entry file the
    // same way the runner will
    let dshInstalled = false
    try {
      const { SDK_ENTRY } = await import('./dsh/activate.ts')
      await import('node:fs/promises').then((fs) => fs.access(SDK_ENTRY))
      dshInstalled = true
    } catch {
      dshInstalled = false
    }
    const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM research_turns WHERE workspace_id = $1', [workspace])
    return {
      ok: configured && dshInstalled,
      provider: 'qwen',
      configured,
      dshInstalled,
      model: configured ? (cfg as { model: string }).model : null,
      turns: rows[0].n,
      backend: 'paper2lab-node-research',
    }
  })

  app.post<{ Body: { prompt?: unknown; sessionId?: unknown } }>('/api/v1/research/turns', {
    schema: {
      body: {
        type: 'object',
        required: ['prompt'],
        additionalProperties: false,
        properties: {
          prompt: { type: 'string', minLength: 1 },
          sessionId: { type: ['string', 'null'], maxLength: 120 },
        },
      },
    },
  }, async (req, reply) => {
    const prompt = String(req.body.prompt).trim()
    if (prompt.length > maxPromptChars) {
      return reply.code(413).send({ error: 'prompt_too_long', message: `prompt exceeds ${maxPromptChars} characters` })
    }
    const sessionId = typeof req.body.sessionId === 'string' && req.body.sessionId.length > 0 ? req.body.sessionId : ''
    if (sessionId && !SESSION_ID_PATTERN.test(sessionId)) {
      return reply.code(422).send({ error: 'invalid_session', message: 'sessionId may only contain [A-Za-z0-9._:-]' })
    }
    // a resuming session must already exist in this workspace
    if (sessionId) {
      const { rows } = await pool.query('SELECT 1 FROM research_turns WHERE workspace_id = $1 AND session_id = $2', [workspace, sessionId])
      if (rows.length === 0) return reply.code(422).send({ error: 'unknown_session', message: `no research session '${sessionId}' in this workspace` })
    }
    // one in-flight turn per session: the model owns the session state
    if (sessionId) {
      const { rows } = await pool.query("SELECT 1 FROM research_turns WHERE workspace_id = $1 AND session_id = $2 AND status IN ('queued','running')", [workspace, sessionId])
      if (rows.length > 0) return reply.code(409).send({ error: 'session_busy', message: 'this session already has a turn in flight' })
    }
    const client = await pool.connect()
    let jobId: string | null = null
    let turnId = 0
    let taskId = 0
    try {
      await client.query('BEGIN')
      const inserted = await insertResearchTurn(client, { workspace, prompt, sessionId })
      turnId = inserted.turnId
      taskId = inserted.taskId
      jobId = await boss.send(RESEARCH_QUEUE, { taskId: inserted.taskId }, { db: bossDb(client) })
      if (jobId === null) {
        await client.query('ROLLBACK')
        client.release()
        return reply.code(503).send({ error: 'queue_unavailable', message: 'queue send returned no job id; submission rolled back — retry' })
      }
      await client.query('UPDATE research_tasks SET queue_job_id = $1 WHERE id = $2', [jobId, inserted.taskId])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      client.release()
      throw err
    }
    client.release()
    return reply.code(202).send({ turnId, taskId, queueJobId: jobId, sessionId: sessionId || null })
  })

  app.get<{ Params: { turnId: string } }>('/api/v1/research/turns/:turnId', async (req, reply) => {
    const turnId = Number(req.params.turnId)
    if (!Number.isSafeInteger(turnId) || turnId <= 0) return reply.code(422).send({ error: 'invalid_turn' })
    const turn = await getResearchTurn(pool, workspace, turnId)
    if (!turn) return reply.code(404).send({ error: 'unknown_turn' })
    return turnView(turn)
  })

  app.get<{ Querystring: { sessionId?: string; limit?: number } }>('/api/v1/research/turns', {
    schema: { querystring: { type: 'object', properties: { sessionId: { type: 'string', maxLength: 120 }, limit: { type: 'integer', minimum: 1, maximum: 100 } } } },
  }, async (req) => {
    if (req.query.sessionId) {
      return { turns: (await listSessionTurns(pool, workspace, req.query.sessionId)).map(turnView) }
    }
    return { turns: (await listRecentTurns(pool, workspace, req.query.limit ?? 20)).map(turnView) }
  })

  app.post<{ Params: { turnId: string } }>('/api/v1/research/turns/:turnId/cancel', async (req, reply) => {
    const turnId = Number(req.params.turnId)
    if (!Number.isSafeInteger(turnId) || turnId <= 0) return reply.code(422).send({ error: 'invalid_turn' })
    const turn = await getResearchTurn(pool, workspace, turnId)
    if (!turn) return reply.code(404).send({ error: 'unknown_turn' })
    if (turn.status !== 'queued' && turn.status !== 'running') return reply.code(409).send({ error: 'already_final' })
    const { rows } = await pool.query("UPDATE research_tasks SET cancel_requested_at = COALESCE(cancel_requested_at, now()) WHERE id = $1 AND status IN ('queued','running') RETURNING id", [turn.taskId])
    await pool.query('INSERT INTO outbox_events (task_id, event_type, body) VALUES ($1, $2, $3::jsonb)', [turn.taskId, 'task.cancel_requested', JSON.stringify({ kind: 'research' })])
    return reply.code(202).send({ result: rows.length > 0 ? 'cancel_requested' : 'already_final' })
  })

  return app
}
