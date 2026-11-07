// J1.2a/J1.2b — the Node backend entry point (science + research).
//
//   PAPER2LAB_DATABASE_URL=postgresql:///paper2lab_node_dev?host=/tmp \
//   PAPER2LAB_NODE_PORT=8790 node --import tsx server/node/main.ts
//
// One process, three roles for now (science API, science worker, research
// worker + research API on the same port) — split deployments only when a real
// resource need appears. Migrations 1–18 apply first (same authority as
// server/db.py); pg-boss gets its own schema so queue internals never mix with
// domain tables. Shutdown order: stop taking work → kill owned engines
// (confirmed exit) → release tasks for redelivery → close queue and pool.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPool, databaseUrl } from './db.ts'
import { migrate } from './migrations.ts'
import { resolveEngineCommand } from './engine.ts'
import { buildScienceApi } from './api.ts'
import { startScienceWorker } from './worker.ts'
import { buildResearchApi } from './researchApi.ts'
import { startResearchWorker } from './researchWorker.ts'
import { readQwenConfig } from './dsh/activate.ts'
import { PgBoss } from 'pg-boss'

async function main(): Promise<void> {
  const url = databaseUrl()
  const port = Number(process.env.PAPER2LAB_NODE_PORT ?? '8790')
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PAPER2LAB_NODE_PORT must be an integer in [1024, 65535]')
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

  const pool = createPool(url)
  const applied = await migrate(pool)
  console.log(`[paper2lab-node] schema at version ${applied.to} (was ${applied.from})`)
  await pool.query("INSERT INTO workspaces (id) VALUES ('default') ON CONFLICT DO NOTHING")

  const boss = new PgBoss({ connectionString: url, schema: process.env.PAPER2LAB_NODE_BOSS_SCHEMA ?? 'paper2lab_boss' })
  boss.on('error', (err: Error) => console.error('[paper2lab-node] pg-boss error:', err.message))
  await boss.start()

  const engine = resolveEngineCommand(repoRoot)
  console.log(`[paper2lab-node] engine artifact: ${engine.artifact.mode} ${engine.artifact.path}${engine.artifact.sha256 ? ` sha256:${engine.artifact.sha256.slice(0, 12)}…` : ''}`)

  const positive = (name: string, fallback: number): number => {
    const value = Number(process.env[name] ?? fallback)
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`)
    return value
  }
  const worker = await startScienceWorker({
    pool,
    boss,
    engine,
    concurrency: positive('PAPER2LAB_NODE_CONCURRENCY', 2),
    leaseSeconds: positive('PAPER2LAB_NODE_LEASE_SECONDS', 120),
    reconcileMs: positive('PAPER2LAB_NODE_RECONCILE_MS', 5_000),
  })

  // research: honest readiness — an unconfigured provider keeps the research
  // API up (health reports blocked-credential) but never fakes an AI answer
  const researchWorker = await startResearchWorker({
    pool,
    boss,
    concurrency: 1,
    reconcileMs: positive('PAPER2LAB_NODE_RECONCILE_MS', 5_000),
  }).catch((err) => {
    console.error('[paper2lab-node] research worker not started (science path unaffected):', err instanceof Error ? err.message : err)
    return null
  })

  const api = buildScienceApi({ pool, boss })
  // one listener, one route surface: the research routes register on the
  // science app itself
  buildResearchApi({ pool, boss, app: api })
  await api.listen({ port, host: '127.0.0.1' })
  const qwen = readQwenConfig()
  console.log(`[paper2lab-node] API on http://127.0.0.1:${port} — science (worker ${worker.owner}) + research${researchWorker ? ` (worker ${researchWorker.owner})` : ' (NOT started)'}; Qwen ${'error' in qwen ? 'UNCONFIGURED — real turns will settle blocked-credential' : (qwen.model)}`)

  let closing = false
  const shutdown = async (signal: string) => {
    if (closing) return
    closing = true
    console.log(`[paper2lab-node] ${signal} — shutting down`)
    try {
      await api.close()
      await worker.stop()
      await researchWorker?.stop()
      await boss.stop({ graceful: false, timeout: 2000 })
      await pool.end()
      process.exit(0)
    } catch (err) {
      console.error('[paper2lab-node] shutdown error:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((err) => {
  console.error('[paper2lab-node] fatal:', err instanceof Error ? err.stack ?? err.message : err)
  process.exit(1)
})
