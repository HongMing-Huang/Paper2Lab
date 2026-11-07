// J1.2a targeted tests — the failure boundaries of the Node science chain,
// against a REAL PostgreSQL (paper2lab_node_science_test) and the REAL engine
// artifact (scripts/engine_once.mjs candidate mode). No shared database is
// touched; the guard below refuses anything not ending in `_test`.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPool, type Pool } from './db.ts'
import { migrate } from './migrations.ts'
import { buildScienceApi, requiresPlan } from './api.ts'
import { startScienceWorker, type ScienceWorker } from './worker.ts'
import { resolveEngineCommand, processAlive } from './engine.ts'
import { claimScienceTask, commitRun, requeueExpiredLeases, insertOperation, findOperation, releaseClaim, requestCancel } from './ledger.ts'
import { MIGRATIONS } from './migrations.ts'
import type { ExperimentRun } from '../../src/experiments/protocol.ts'
import { SKILL_REGISTRY } from '../../src/skills/registry.ts'
import { PgBoss } from 'pg-boss'
import type { FastifyInstance } from 'fastify'

const TEST_DB = process.env.PAPER2LAB_NODE_TEST_DATABASE_URL ?? 'postgresql:///paper2lab_node_science_test?host=/tmp'
if (!/_test($|\?)/.test(TEST_DB)) throw new Error(`refusing to run J1.2a tests against a non-_test database: ${TEST_DB.replace(/:[^:@/]*@/, ':***@')}`)

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const FORMULA_INPUT = {
  expression: ['Multiply', 'a', ['Sin', ['Multiply', 'b', 'x']]],
  parameters: ['a', 'b'],
  independent: 'x',
  range: [-7, 7],
  values: { a: 2, b: 1 },
  samples: 361,
}
const FORMULA_PLAN = {
  planId: 'plan-j12a-formula',
  goal: 'J1.2a test: real Cortex compute through the Node worker',
  skill: 'formula.plot',
  inputs: {
    expression: FORMULA_INPUT.expression,
    parameters: FORMULA_INPUT.parameters,
    independent: FORMULA_INPUT.independent,
    range: FORMULA_INPUT.range,
  },
}
const LONG_INPUT = { deltaExp: -3, nTubes: 400, packing: 0.5, res: 220 }
const SHORT_INPUT = { deltaExp: -3, nTubes: 400, packing: 0.5, res: 96 }
const KAKEYA_PLAN = {
  planId: 'plan-j12a-kakeya',
  goal: 'J1.2a test: long compute health and cancel isolation',
  skill: 'kakeya.measure',
  inputs: {},
}

let pool: Pool
let boss: PgBoss
let api: FastifyInstance
let worker: ScienceWorker

const submit = async (operationId: string, body: Record<string, unknown>) => {
  const res = await api.inject({ method: 'POST', url: '/api/v1/science/operations', payload: { operationId, ...body } })
  return { status: res.statusCode, body: res.json() as Record<string, unknown> }
}
const taskStatus = async (taskId: number): Promise<Record<string, unknown>> => {
  const res = await api.inject({ method: 'GET', url: `/api/v1/science/tasks/${taskId}` })
  return res.json() as Record<string, unknown>
}
const waitTask = async (taskId: number, wanted: string[], timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const status = await taskStatus(taskId)
    if (wanted.includes(String(status.status))) return status
    if (Date.now() > deadline) throw new Error(`task ${taskId} did not reach ${wanted.join('|')} within ${timeoutMs} ms (last: ${JSON.stringify(status)})`)
    await new Promise((r) => setTimeout(r, 200))
  }
}
const runCount = async (): Promise<number> => {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM experiment_runs')
  return rows[0].n
}
const leaseOf = async (taskId: number): Promise<{ expires: Date | null; owner: string | null }> => {
  const { rows } = await pool.query('SELECT lease_expires_at AS expires, lease_owner AS owner FROM research_tasks WHERE id = $1', [taskId])
  return rows[0]
}

beforeAll(async () => {
  pool = createPool(TEST_DB, 6)
  await migrate(pool)
  await pool.query("INSERT INTO workspaces (id) VALUES ('default') ON CONFLICT DO NOTHING")
  boss = new PgBoss({ connectionString: TEST_DB, schema: 'paper2lab_boss_test' })
  boss.on('error', () => {})
  await boss.start()
  const engine = resolveEngineCommand(REPO_ROOT)
  expect(engine.artifact.mode).toBe('bundle')
  worker = await startScienceWorker({
    pool,
    boss,
    engine,
    leaseSeconds: 30,
    reconcileMs: 400,
    cancelPollMs: 100,
    concurrency: 2,
  })
  api = buildScienceApi({ pool, boss })
  await api.ready()
}, 120_000)

beforeEach(async () => {
  await pool.query('TRUNCATE research_tasks, science_operations, experiment_runs, job_attempts, outbox_events RESTART IDENTITY CASCADE')
})

afterAll(async () => {
  await worker.stop()
  await boss.stop({ graceful: false, timeout: 2000 }).catch(() => {})
  await pool.end()
})

describe('J1.2a — real compute through the transactional worker', () => {
  test('a formula.plot operation commits one real Run and replays idempotently', async () => {
    const body = { skill: 'formula.plot', input: FORMULA_INPUT, plan: FORMULA_PLAN }
    const first = await submit('op-formula', body)
    expect(first.status).toBe(202)
    const taskId = Number(first.body.taskId)
    const done = await waitTask(taskId, ['succeeded'])
    expect(done.operation_state).toBe('completed')
    expect(await runCount()).toBe(1)
    // the committed record is the real Cortex kernel output
    const runRes = await api.inject({ method: 'GET', url: `/api/v1/science/runs/${String(done.run_id)}` })
    expect(runRes.statusCode).toBe(200)
    const record = runRes.json().run
    expect(record.status).toBe('resolved')
    expect(record.result.points).toHaveLength(361)
    expect(record.result.peak).toBeCloseTo(1.9999533, 5)
    expect(record.result.integral).toBeCloseTo(16.9847602, 5)
    // idempotent replay: same key + same payload → the recorded receipt, no second run
    const replay = await submit('op-formula', body)
    expect(replay.status).toBe(200)
    expect(replay.body.replayed).toBe(true)
    expect(replay.body.taskId).toBe(taskId)
    expect(await runCount()).toBe(1)
    // same key, DIFFERENT payload → conflict
    const conflict = await submit('op-formula', { ...body, input: { ...FORMULA_INPUT, values: { a: 3, b: 1 } } })
    expect(conflict.status).toBe(409)
    expect(await runCount()).toBe(1)
  })

  test('a formal skill without a plan is refused at preflight; the operationId stays usable', async () => {
    const refused = await submit('op-noplan', { skill: 'formula.plot', input: FORMULA_INPUT })
    expect(refused.status).toBe(422)
    expect(refused.body.state).toBe('needs_input')
    expect(refused.body.missingFields).toEqual(['plan'])
    // nothing was recorded: no task, no operation
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM science_operations')
    expect(rows[0].n).toBe(0)
    // a plan that does not cover the input is refused the same way
    const uncovered = await submit('op-noplan', { skill: 'formula.plot', input: FORMULA_INPUT, plan: { ...FORMULA_PLAN, inputs: { ...FORMULA_PLAN.inputs, range: [0, 1] } } })
    expect(uncovered.status).toBe(422)
    expect(uncovered.body.missingFields).toEqual(['plan.inputs'])
    // the caller fixes the call and re-uses the SAME operationId (A1.2 rule)
    const fixed = await submit('op-noplan', { skill: 'formula.plot', input: FORMULA_INPUT, plan: FORMULA_PLAN })
    expect(fixed.status).toBe(202)
    const done = await waitTask(Number(fixed.body.taskId), ['succeeded'])
    expect(done.operation_state).toBe('completed')
    expect(await runCount()).toBe(1)
  })

  test('an unknown lineage reference is rejected at submit time', async () => {
    const res = await submit('op-ghost-fork', { skill: 'experiment.fork', input: { sourceRunId: 'formula-curve-does-not-exist' } })
    expect(res.status).toBe(422)
    expect(res.body.error).toBe('invalid_input')
  })

  test('a fork chains onto the PostgreSQL parent with correct lineage and values', async () => {
    const base = await submit('op-fork-base', { skill: 'formula.plot', input: FORMULA_INPUT, plan: FORMULA_PLAN })
    const baseDone = await waitTask(Number(base.body.taskId), ['succeeded'])
    const fork = await submit('op-fork', { skill: 'experiment.fork', input: { sourceRunId: String(baseDone.run_id), parameterChanges: { a: 3 } } })
    expect(fork.status).toBe(202)
    const forkDone = await waitTask(Number(fork.body.taskId), ['succeeded'])
    expect(forkDone.operation_state).toBe('completed')
    const { rows } = await pool.query('SELECT parent_run_id, record_json FROM experiment_runs WHERE run_id = $1', [forkDone.run_id])
    expect(rows[0].parent_run_id).toBe(baseDone.run_id)
    expect(rows[0].record_json.result.peak).toBeCloseTo(2.9999299, 5)
    expect(await runCount()).toBe(2)
  })
})

describe('J1.2a — cancel, isolation and health during long computes', () => {
  test('cancelling a running long compute kills only ITS engine; a parallel task completes', { timeout: 60_000 }, async () => {
    const long = await submit('op-long', { skill: 'kakeya.measure', input: LONG_INPUT, plan: KAKEYA_PLAN })
    const short = await submit('op-short', { skill: 'kakeya.measure', input: SHORT_INPUT, plan: KAKEYA_PLAN })
    // wait until the long engine is actually running
    let pid: number | undefined
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      pid = worker.inflightPids().get(Number(long.body.taskId))
      if (pid) break
      await new Promise((r) => setTimeout(r, 50))
    }
    expect(pid).toBeDefined()
    const cancelRes = await api.inject({ method: 'POST', url: `/api/v1/science/tasks/${Number(long.body.taskId)}/cancel` })
    expect(cancelRes.statusCode).toBe(202)
    expect(cancelRes.json().result).toBe('cancel_requested')
    const longDone = await waitTask(Number(long.body.taskId), ['cancelled'], 20_000)
    expect(longDone.run_id).toBeNull()
    const shortDone = await waitTask(Number(short.body.taskId), ['succeeded'], 30_000)
    expect(shortDone.operation_state).toBe('completed')
    expect(await runCount()).toBe(1)
    // the cancelled engine process is REALLY gone (not just queue-cancelled)
    await new Promise((r) => setTimeout(r, 200))
    expect(processAlive(pid!)).toBe(false)
    // usage evidence: the cancelled compute's receipt keeps its engine usage
    const op = await findOperation(pool, 'default', 'op-long', '')
    const cancelledReceipt = op?.receipt as { usage?: { enginePid?: number; engineArtifact?: { path?: string } } } | null
    expect(cancelledReceipt?.usage?.enginePid).toBe(pid)
    expect(cancelledReceipt?.usage?.engineArtifact?.path).toBe('scripts/engine_once.mjs')
  })

  test('health stays green and the lease renews while a long compute runs', { timeout: 90_000 }, async () => {
    const long = await submit('op-health', { skill: 'kakeya.measure', input: LONG_INPUT, plan: KAKEYA_PLAN })
    await waitTask(Number(long.body.taskId), ['running'], 10_000)
    const first = await leaseOf(Number(long.body.taskId))
    const midHealth = await api.inject({ method: 'GET', url: '/api/v1/science/health' })
    expect(midHealth.statusCode).toBe(200)
    expect(midHealth.json().backend).toBe('paper2lab-node-science')
    // the worker renews every leaseSeconds/4 = 7.5 s; wait past one renewal
    // while the ~10 s compute is still running
    await new Promise((r) => setTimeout(r, 8_200))
    const second = await leaseOf(Number(long.body.taskId))
    expect(second.owner).toBe(first.owner)
    // a renewal moved the expiry forward by ~7.5 s (strict, with margin)
    expect(new Date(second.expires!).getTime() - new Date(first.expires!).getTime()).toBeGreaterThan(5_000)
    const lateHealth = await api.inject({ method: 'GET', url: '/api/v1/science/health' })
    expect(lateHealth.statusCode).toBe(200)
    const done = await waitTask(Number(long.body.taskId), ['succeeded'], 60_000)
    expect(done.operation_state).toBe('completed')
  })
})

describe('J1.2a — fencing and crash recovery', () => {
  test('a stale (fenced-out) attempt can never commit; the current one can', async () => {
    const client = await pool.connect()
    let taskId = 0
    let operationPk = 0
    try {
      const inserted = await insertOperation(client, {
        workspace: 'default', operationId: 'op-fence', idempotencyKey: '', skill: 'formula.plot',
        inputDigest: 'sha256:test', request: { input: FORMULA_INPUT, plan: FORMULA_PLAN },
      })
      taskId = inserted.taskId
      operationPk = inserted.operationPk
    } finally {
      client.release()
    }
    const asClaim = (v: import('./ledger.ts').Claim | null | 'leased'): import('./ledger.ts').Claim => {
      if (v === null || v === 'leased') throw new Error('expected a successful claim')
      return v
    }
    const first = asClaim(await claimScienceTask(pool, taskId, 'worker-a', 30))
    // simulate the first attempt's lease expiring; a second worker takes over
    await pool.query('UPDATE research_tasks SET lease_expires_at = now() - interval \'5 seconds\' WHERE id = $1', [taskId])
    await requeueExpiredLeases(pool)
    const second = asClaim(await claimScienceTask(pool, taskId, 'worker-b', 30))
    // duplicate delivery while the lease is live is a no-op
    const dupe = await claimScienceTask(pool, taskId, 'worker-c', 30)
    expect(dupe === null || dupe === 'leased').toBe(true)
    // the fenced-out attempt's commit is refused
    const fencedRun = { runId: 'formula-curve-fenced-1', spec: { kind: 'formula.curve', params: {}, seed: 0 }, status: 'resolved', result: {}, engine: 'x', engineVersion: '1', durationMs: 1, evidence: 'CALCULATED', createdAt: 1, startedAt: 1, errors: [] } as unknown as ExperimentRun
    await expect(commitRun(pool, first, fencedRun, { state: 'completed' }, null, 'formula.plot')).resolves.toBe('fenced')
    expect(await runCount()).toBe(0)
    // the current attempt commits
    const okRun = { runId: 'formula-curve-current-1', spec: { kind: 'formula.curve', params: {}, seed: 0 }, status: 'resolved', result: {}, engine: 'cortex-ce-js', engineVersion: '0.142.0', durationMs: 1, evidence: 'CALCULATED', createdAt: 1, startedAt: 1, errors: [] } as unknown as ExperimentRun
    await expect(commitRun(pool, second, okRun, { state: 'completed' }, null, 'formula.plot')).resolves.toBe('committed')
    expect(await runCount()).toBe(1)
    // committing again after the task settled is fenced out (not 'settled':
    // the task row is terminal, so no attempt owns it) — still exactly one run
    await expect(commitRun(pool, second, okRun, { state: 'completed' }, null, 'formula.plot')).resolves.toBe('fenced')
    expect(await runCount()).toBe(1)
    void operationPk
  })

  test('a worker crash before commit leaves no run; redelivery commits exactly one', { timeout: 120_000 }, async () => {
    // make the crashing worker the ONLY consumer for this test, so the crash
    // window is deterministic
    await worker.stop()
    let crashed = false
    const frag = await startScienceWorker({
      pool, boss, engine: resolveEngineCommand(REPO_ROOT),
      leaseSeconds: 30, reconcileMs: 400, cancelPollMs: 100,
      hooks: {
        beforeCommit: async () => {
          if (!crashed) {
            crashed = true
            throw new Error('simulated worker death before commit')
          }
        },
      },
    })
    try {
      const res = await submit('op-crash', { skill: 'formula.plot', input: FORMULA_INPUT, plan: FORMULA_PLAN })
      expect(res.status).toBe(202)
      // pg-boss retries the delivery; the ledger fence keeps the crashed
      // attempt from ever publishing, and the retry commits once
      const done = await waitTask(Number(res.body.taskId), ['succeeded'], 90_000)
      expect(done.operation_state).toBe('completed')
      expect(await runCount()).toBe(1)
    } finally {
      await frag.stop()
      worker = await startScienceWorker({ pool, boss, engine: resolveEngineCommand(REPO_ROOT), leaseSeconds: 30, reconcileMs: 400, cancelPollMs: 100 })
    }
  })

  test('a worker crash AFTER commit: redelivery is skipped, still exactly one run', { timeout: 120_000 }, async () => {
    await worker.stop()
    let crashed = false
    const frag = await startScienceWorker({
      pool, boss, engine: resolveEngineCommand(REPO_ROOT),
      leaseSeconds: 30, reconcileMs: 400, cancelPollMs: 100,
      hooks: {
        afterCommit: async () => {
          if (!crashed) {
            crashed = true
            throw new Error('simulated worker death after commit')
          }
        },
      },
    })
    try {
      const res = await submit('op-crash-after', { skill: 'formula.plot', input: FORMULA_INPUT, plan: FORMULA_PLAN })
      const taskId = Number(res.body.taskId)
      await waitTask(taskId, ['succeeded'], 60_000)
      // the handler threw after the commit → pg-boss redelivers; the claim
      // finds a settled task and records the skip instead of recomputing
      const deadline = Date.now() + 30_000
      let skipped = 0
      while (Date.now() < deadline) {
        const { rows } = await pool.query("SELECT count(*)::int AS n FROM outbox_events WHERE task_id = $1 AND event_type = 'task.delivery_skipped'", [taskId])
        skipped = rows[0].n
        if (skipped > 0) break
        await new Promise((r) => setTimeout(r, 200))
      }
      expect(skipped).toBeGreaterThan(0)
      expect(await runCount()).toBe(1)
      const op = await findOperation(pool, 'default', 'op-crash-after', '')
      expect(op?.state).toBe('completed')
    } finally {
      await frag.stop()
      worker = await startScienceWorker({ pool, boss, engine: resolveEngineCommand(REPO_ROOT), leaseSeconds: 30, reconcileMs: 400, cancelPollMs: 100 })
    }
  })

  test('a requested cancel survives a requeue: never recomputed, never published', async () => {
    const insertAndClaim = async (operationId: string) => {
      const client = await pool.connect()
      let taskId = 0
      try {
        taskId = (await insertOperation(client, {
          workspace: 'default', operationId, idempotencyKey: '', skill: 'formula.plot',
          inputDigest: `sha256:${operationId}`, request: { input: FORMULA_INPUT, plan: FORMULA_PLAN },
        })).taskId
      } finally {
        client.release()
      }
      const claim = await claimScienceTask(pool, taskId, 'worker-x', 30)
      if (claim === null || claim === 'leased') throw new Error('expected a claim')
      return { taskId, claim }
    }
    const statusOf = async (taskId: number) => (await pool.query('SELECT t.status, o.state FROM research_tasks t JOIN science_operations o ON o.task_id = t.id WHERE t.id = $1', [taskId])).rows[0]
    // path 1: cancel requested, then the attempt is released (worker shutdown)
    const a = await insertAndClaim('op-cancel-release')
    await expect(requestCancel(pool, a.taskId)).resolves.toBe('cancel_requested')
    await expect(releaseClaim(pool, a.claim, 'worker shutdown')).resolves.toBe(true)
    expect(await statusOf(a.taskId)).toEqual({ status: 'cancelled', state: 'cancelled' })
    // path 2: cancel requested, then the lease expires and the task is requeued
    const b = await insertAndClaim('op-cancel-expire')
    await expect(requestCancel(pool, b.taskId)).resolves.toBe('cancel_requested')
    await pool.query('UPDATE research_tasks SET lease_expires_at = now() - interval \'5 seconds\' WHERE id = $1', [b.taskId])
    await requeueExpiredLeases(pool)
    // the next delivery must finalize the cancel, not run the compute
    await expect(claimScienceTask(pool, b.taskId, 'worker-y', 30)).resolves.toBeNull()
    expect(await statusOf(b.taskId)).toEqual({ status: 'cancelled', state: 'cancelled' })
    expect(await runCount()).toBe(0)
  })
})

describe('J1.2a — gates stay in sync with the executor and server/db.py (drift guards)', () => {
  test('the API plan preflight covers exactly the executor FORMAL_SKILLS', () => {
    const source = readFileSync(resolve(REPO_ROOT, 'src', 'skills', 'executor.ts'), 'utf8')
    const match = source.match(/const FORMAL_SKILLS = new Set\(\[([^\]]+)\]\)/)
    expect(match, 'FORMAL_SKILLS declaration in executor.ts').not.toBeNull()
    const formal = new Set([...match![1].matchAll(/'([^']+)'/g)].map((m) => m[1]))
    const preflight = new Set(SKILL_REGISTRY.filter((s) => requiresPlan(s)).map((s) => s.name))
    expect([...preflight].sort()).toEqual([...formal].sort())
  })
  test('migrations 1-14 record the same statements and rollback notes as db.py', () => {
    const source = readFileSync(resolve(REPO_ROOT, 'server', 'db.py'), 'utf8')
    const expected = new Map<number, { ddl: string; rollback: string }>()
    const ddlRegex = /\n\s*ddl = ("(?:[^"\\]|\\.)*")\n/g
    const rollbackRegex = /_record_migration\(cur, (\d+), ddl(?: \+ ("[^"]*"))?, ("(?:[^"\\]|\\.)*")\)/g
    const ddls: string[] = [...source.matchAll(ddlRegex)].map((m) => JSON.parse(m[1]) as string)
    const records = [...source.matchAll(rollbackRegex)]
    // every record call must pair with exactly one preceding ddl assignment —
    // a capture miss fails here instead of silently comparing against ''
    expect(ddls).toHaveLength(14)
    expect(records).toHaveLength(14)
    records.forEach((m, i) => {
      const suffix = m[2] === undefined ? '' : (JSON.parse(m[2]) as string)
      expected.set(Number(m[1]), { ddl: ddls[i] + suffix, rollback: JSON.parse(m[3]) as string })
    })
    // migrate() applies migrations with version > current — db.py records the
    // `ddl` variable (+ its literal suffix, migration 10) for each version
    for (const m of MIGRATIONS) {
      if (m.version > 14) break
      const py = expected.get(m.version)
      expect(py, `db.py migration ${m.version}`).toBeDefined()
      expect(m.recorded).toBe(py!.ddl)
      expect(m.rollback).toBe(py!.rollback)
    }
    expect(MIGRATIONS.filter((m) => m.version <= 14)).toHaveLength(expected.size)
  })
})
