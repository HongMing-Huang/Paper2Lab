// J1.2a — the science API surface (Fastify). POST /api/v1/science/operations
// validates, computes the canonical digest SERVER-side (a client-submitted
// hash proves nothing), writes task+attempt+event+operation receipt and the
// queue job in ONE transaction (boss.send shares the pg client), and answers
// 202. Same key+same digest replays the recorded receipt; same key+different
// digest is a 409 conflict. Errors stay errors — nothing is a silent success.
import Fastify, { type FastifyInstance } from 'fastify'
import type { Pool } from './db.ts'
import { bossDb } from './db.ts'
import {
  SCIENCE_QUEUE,
  findOperation,
  insertOperation,
  recordQueueJob,
  requestCancel,
} from './ledger.ts'
import { loadRun, listRuns } from './runs.ts'
import { registerBearerAuth } from './auth.ts'
import { planCoversInput, planCoversSkill, planInputDigest, type PlayPlan } from '../../src/skills/playPlan.ts'
import { getSkill, validateSkillInput } from '../../src/skills/registry.ts'

export interface ApiOptions {
  pool: Pool
  boss: import('pg-boss').PgBoss
  workspace?: string
  maxInputBytes?: number
}

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/

/** the executor's plan gate applies to every run-producing (formal) skill;
 *  science.test.ts guards this against executor.ts FORMAL_SKILLS */
export function requiresPlan(skill: { runKind?: string }): boolean {
  return skill.runKind !== undefined
}

/** shape-check a submitted plan WITHOUT registering it anywhere: coverage
 *  only reads skill + inputs; the engine process registers the real plan */
function asPlan(raw: unknown): PlayPlan | null {
  const p = raw as Partial<PlayPlan> | null
  if (!p || typeof p !== 'object' || typeof p.planId !== 'string' || typeof p.skill !== 'string' || typeof p.goal !== 'string') return null
  if (p.inputs !== undefined && (p.inputs === null || typeof p.inputs !== 'object' || Array.isArray(p.inputs))) return null
  return { ...(p as PlayPlan), inputs: (p.inputs ?? {}) as Record<string, unknown> }
}

export function buildScienceApi(opts: ApiOptions): FastifyInstance {
  const app = Fastify({ logger: false })
  registerBearerAuth(app)
  const { pool, boss } = opts
  const workspace = opts.workspace ?? 'default'
  const maxInputBytes = opts.maxInputBytes ?? 256 * 1024

  interface OperationBody {
    skill?: unknown
    input?: unknown
    plan?: unknown
    parentRunId?: unknown
    source?: unknown
    operationId?: unknown
    idempotencyKey?: unknown
    /** UI convenience: multiply named source-run parameters by factors instead
     *  of the caller doing the arithmetic (resolved server-side against the
     *  source run's recorded values before experiment.fork runs) */
    parameterScale?: unknown
  }

  app.get('/api/v1/science/health', async () => {
    const { rows } = await pool.query<{ ok: boolean }>('SELECT true AS ok')
    return { ok: rows[0]?.ok === true, backend: 'paper2lab-node-science', queue: SCIENCE_QUEUE }
  })

  app.get('/api/v1/science/skills', async () => {
    // the catalog is the registry — nothing else is callable (A1.1 rule)
    const { SKILL_REGISTRY } = await import('../../src/skills/registry.ts')
    return {
      portVersion: 'tool-port@1.0',
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
  })

  app.post<{ Body: OperationBody }>('/api/v1/science/operations', {
    schema: {
      body: {
        type: 'object',
        required: ['skill', 'input'],
        additionalProperties: true,
        properties: {
          skill: { type: 'string', minLength: 1, maxLength: 64 },
          input: { type: 'object' },
          plan: { type: ['object', 'null'] },
          parentRunId: { type: ['string', 'null'], maxLength: 160 },
          source: {},
          operationId: { type: ['string', 'null'], maxLength: 120 },
          idempotencyKey: { type: ['string', 'null'], maxLength: 120 },
        },
      },
    },
  }, async (req, reply) => {
    let body = req.body
    // registry identity first (Fastify's schema is shape-only; the registry
    // governs and gives the canonical name the digest is computed over)
    const skill = getSkill(String(body.skill))
    if (!skill) {
      return reply.code(404).send({ error: 'unknown_skill', message: `Unknown tool: ${body.skill}` })
    }
    const size = Buffer.byteLength(JSON.stringify(body.input ?? {}))
    if (size > maxInputBytes) {
      return reply.code(413).send({ error: 'input_too_large', message: `input exceeds ${maxInputBytes} bytes` })
    }
    const operationId = typeof body.operationId === 'string' && body.operationId.length > 0 ? body.operationId : `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : ''
    if (!ID_PATTERN.test(operationId) || (idempotencyKey.length > 0 && !ID_PATTERN.test(idempotencyKey))) {
      return reply.code(422).send({ error: 'invalid_id', message: 'operationId/idempotencyKey may only contain [A-Za-z0-9._:-]' })
    }
    if (skill.name === 'experiment.fork') {
      // resolve parameterScale against the SOURCE run first: the server does
      // the arithmetic (a caller never submits a number it claims came from a
      // run), and the digest below then covers the operation that will run
      const preSourceRunId = String((body.input as { sourceRunId?: unknown }).sourceRunId ?? '')
      const preSource = await loadRun(pool, workspace, preSourceRunId)
      if (preSource && body.parameterScale != null) {
        const scale = body.parameterScale
        if (typeof scale !== 'object' || scale === null || Array.isArray(scale)) {
          return reply.code(422).send({ state: 'error', error: 'invalid_input', message: 'parameterScale must be an object of parameter → number' })
        }
        const params = preSource.record.spec.params as Record<string, unknown>
        const changes = { ...((body.input as { parameterChanges?: Record<string, number> }).parameterChanges ?? {}) }
        for (const [key, factor] of Object.entries(scale as Record<string, unknown>)) {
          if (typeof factor !== 'number' || !Number.isFinite(factor)) {
            return reply.code(422).send({ state: 'error', error: 'invalid_input', message: `parameterScale.${key} must be a finite number` })
          }
          if (key in changes) {
            return reply.code(422).send({ state: 'error', error: 'invalid_input', message: `parameter ${key} is given both as an absolute change and a scale factor` })
          }
          if (typeof params[key] !== 'number') {
            return reply.code(422).send({ state: 'error', error: 'invalid_input', message: `source run ${preSourceRunId} records no numeric parameter '${key}' (known: ${Object.keys(params).join(', ') || 'none'})` })
          }
          changes[key] = (params[key] as number) * factor
        }
        if (Object.keys(scale as Record<string, unknown>).length > 0) {
          body = { ...body, input: { ...(body.input as Record<string, unknown>), parameterChanges: changes } }
        }
      }
    }
    // canonical digest over the OPERATION payload — computed server-side over
    // the post-resolution input
    const digestInput: Record<string, unknown> = { skill: skill.name, input: body.input ?? {} }
    if (body.plan != null) digestInput.plan = body.plan
    if (body.parentRunId != null) digestInput.parentRunId = body.parentRunId
    if (body.source !== undefined) digestInput.source = body.source
    const inputDigest = planInputDigest(digestInput)
    // idempotency (persistent, cross-restart — toolPort's J1 version). A
    // recorded operation replays its receipt BEFORE today's gates run: the
    // answer to an already-accepted operation never changes with the code.
    const existing = await findOperation(pool, workspace, operationId, idempotencyKey)
    if (existing) {
      if (existing.inputDigest !== inputDigest) {
        return reply.code(409).send({ error: 'operation_conflict', message: `operation '${operationId}' is recorded with a DIFFERENT payload — same key, different input is refused` })
      }
      return reply.code(200).send({
        status: existing.state,
        taskId: existing.taskId,
        operationId,
        replayed: true,
        runId: existing.runId,
        receipt: existing.receipt,
      })
    }
    if (skill.name === 'paper.trace-source') {
      // the candidate engine sees only injected runs, never the full history
      // an anchor lookup needs; answering "no run carries this anchor" would
      // be a false negative — refuse honestly until the PG anchor index exists
      return reply.code(422).send({ state: 'unsupported', error: 'unsupported', message: 'paper.trace-source is not served by the science API yet (needs the PostgreSQL anchor index)' })
    }
    const inputCheck = validateSkillInput(skill.name, body.input ?? {})
    if (!inputCheck.ok) {
      return reply.code(422).send({ state: 'error', error: 'invalid_input', message: inputCheck.error ?? 'input violates the registry schema' })
    }
    // a plan the caller submits must itself be shape-valid (the engine's plan
    // registry re-checks; nothing is registered in THIS process)
    const plan = body.plan == null ? null : asPlan(body.plan)
    if (body.plan != null && plan === null) {
      return reply.code(422).send({ state: 'error', error: 'invalid_plan', message: 'plan JSON must carry string planId, skill and goal, and object inputs when present' })
    }
    // the executor's plan gate, evaluated BEFORE anything is recorded: a
    // caller-side prerequisite is not an operation outcome, so the operationId
    // stays usable once the caller supplies the plan (toolPort A1.2 rule). The
    // engine re-checks every gate anyway (defense in depth).
    if (requiresPlan(skill)) {
      if (plan === null) {
        return reply.code(422).send({ state: 'needs_input', error: 'needs_input', missingFields: ['plan'], message: `${skill.name} refuses to run without a PlayPlan — submit the full plan` })
      }
      if (!planCoversSkill(plan, skill.name)) {
        return reply.code(422).send({ state: 'needs_input', error: 'needs_input', missingFields: ['plan.skill'], message: `PlayPlan '${plan.planId}' (skill ${plan.skill}) does not cover '${skill.name}'` })
      }
      if (!planCoversInput(plan, body.input ?? {})) {
        return reply.code(422).send({ state: 'needs_input', error: 'needs_input', missingFields: ['plan.inputs'], message: `PlayPlan '${plan.planId}' does not cover this input — the plan governs its registered inputs` })
      }
    }
    const request = {
      input: body.input ?? {},
      ...(body.plan != null ? { plan: body.plan } : {}),
      ...(body.plan != null ? { planId: (body.plan as { planId?: unknown }).planId } : {}),
      ...(body.parentRunId != null ? { parentRunId: body.parentRunId } : {}),
      ...(body.source !== undefined ? { source: body.source } : {}),
    }
    // lineage references must exist before the task is queued (a fork of a
    // phantom run must fail at submit, not after a delivery), and a fork can
    // only re-execute under a plan that governed its source
    if (skill.name === 'experiment.fork') {
      const sourceRunId = String((body.input as { sourceRunId?: unknown }).sourceRunId ?? '')
      const source = await loadRun(pool, workspace, sourceRunId)
      if (!source) {
        return reply.code(422).send({ state: 'error', error: 'invalid_input', message: `Unknown run: ${sourceRunId}` })
      }
      if (source.governingPlan == null && plan === null) {
        return reply.code(422).send({ state: 'needs_input', error: 'needs_input', missingFields: ['plan'], message: `run ${sourceRunId} has no governing plan on record — submit a plan covering its skill to fork it` })
      }
    }
    if (skill.name === 'experiment.compare') {
      for (const key of ['runA', 'runB'] as const) {
        const id = String((body.input as Record<string, unknown>)[key] ?? '')
        if (!(await loadRun(pool, workspace, id))) {
          return reply.code(422).send({ state: 'error', error: 'invalid_input', message: `Unknown run: ${id}` })
        }
      }
    }
    if (body.parentRunId != null && !(await loadRun(pool, workspace, String(body.parentRunId)))) {
      return reply.code(422).send({ state: 'error', error: 'invalid_input', message: `Unknown parent run: ${String(body.parentRunId)}` })
    }
    const client = await pool.connect()
    let jobId: string | null = null
    let insertedTaskId = 0
    try {
      await client.query('BEGIN')
      const inserted = await insertOperation(client, { workspace, operationId, idempotencyKey, skill: skill.name, inputDigest, request })
      insertedTaskId = inserted.taskId
      jobId = await boss.send(SCIENCE_QUEUE, { taskId: inserted.taskId }, { db: bossDb(client) })
      if (jobId === null) {
        // no job id → nothing queued: roll the whole submission back rather
        // than leaving a domain task no worker will ever deliver
        await client.query('ROLLBACK')
        client.release()
        return reply.code(503).send({ error: 'queue_unavailable', message: 'queue send returned no job id; submission rolled back — retry' })
      }
      await recordQueueJob(client, inserted.taskId, jobId)
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      client.release()
      // the UNIQUE constraint raced a concurrent identical submit: replay it
      if (err instanceof Error && 'code' in err && (err as { code?: string }).code === '23505') {
        const raced = await findOperation(pool, workspace, operationId, idempotencyKey)
        if (raced && raced.inputDigest === inputDigest) {
          return reply.code(200).send({ status: raced.state, taskId: raced.taskId, operationId, replayed: true, runId: raced.runId, receipt: raced.receipt })
        }
        return reply.code(409).send({ error: 'operation_conflict', message: `operation '${operationId}' was recorded concurrently with a different payload` })
      }
      throw err
    }
    client.release()
    return reply.code(202).send({ status: 'queued', taskId: insertedTaskId, operationId, queueJobId: jobId })
  })

  app.get<{ Params: { operationId: string }; Querystring: { idempotencyKey?: string } }>('/api/v1/science/operations/:operationId', {
    schema: { querystring: { type: 'object', properties: { idempotencyKey: { type: 'string', maxLength: 120 } } } },
  }, async (req, reply) => {
    const op = await findOperation(pool, workspace, req.params.operationId, req.query.idempotencyKey ?? '')
    if (!op) return reply.code(404).send({ error: 'unknown_operation' })
    return {
      status: op.state,
      operationId: op.operationId,
      taskId: op.taskId,
      runId: op.runId,
      receipt: op.receipt,
    }
  })

  app.get<{ Querystring: { limit?: number; kind?: string; taskId?: number } }>('/api/v1/science/runs', {
    schema: { querystring: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 500 }, kind: { type: 'string', maxLength: 64 }, taskId: { type: 'integer' } } } },
  }, async (req) => {
    if (req.query.taskId !== undefined) {
      const { rows } = await pool.query('SELECT r.record_json AS record, r.governing_plan AS plan, r.committed_at FROM experiment_runs r WHERE r.task_id = $1 AND r.workspace_id = $2', [req.query.taskId, workspace])
      return { runs: rows }
    }
    const runs = await listRuns(pool, workspace, req.query.limit ?? 50, req.query.kind)
    return { runs }
  })

  app.get<{ Params: { runId: string } }>('/api/v1/science/runs/:runId', async (req, reply) => {
    const run = await loadRun(pool, workspace, req.params.runId)
    if (!run) return reply.code(404).send({ error: 'unknown_run' })
    return { run: run.record, governingPlan: run.governingPlan, committedAt: run.committedAt }
  })

  // a task is addressable only through an operation of THIS workspace
  const ownsTask = async (taskId: number): Promise<boolean> => {
    const { rows } = await pool.query('SELECT 1 FROM science_operations WHERE task_id = $1 AND workspace_id = $2', [taskId, workspace])
    return rows.length > 0
  }

  app.post<{ Params: { taskId: number } }>('/api/v1/science/tasks/:taskId/cancel', {
    schema: { params: { type: 'object', properties: { taskId: { type: 'integer' } }, required: ['taskId'] } },
  }, async (req, reply) => {
    if (!(await ownsTask(req.params.taskId))) return reply.code(404).send({ error: 'unknown_task' })
    const outcome = await requestCancel(pool, req.params.taskId)
    if (outcome === 'unknown') return reply.code(404).send({ error: 'unknown_task' })
    return reply.code(outcome === 'already_final' ? 409 : 202).send({ result: outcome })
  })

  app.get<{ Params: { taskId: number } }>('/api/v1/science/tasks/:taskId', {
    schema: { params: { type: 'object', properties: { taskId: { type: 'integer' } }, required: ['taskId'] } },
  }, async (req, reply) => {
    const { rows } = await pool.query('SELECT t.id, t.status, t.stage, t.result, t.fence, o.operation_id, o.state AS operation_state, o.run_id FROM research_tasks t JOIN science_operations o ON o.task_id = t.id WHERE t.id = $1 AND t.kind = $2 AND o.workspace_id = $3', [req.params.taskId, 'science', workspace])
    if (rows.length === 0) return reply.code(404).send({ error: 'unknown_task' })
    return rows[0]
  })

  return app
}
