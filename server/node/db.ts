// J1.2a — PostgreSQL access for the Node backend. One pool per process; a
// domain transaction ALWAYS runs on one checked-out client (BEGIN … COMMIT on
// the same connection — node-postgres forbids mixing pool.query into it), and
// pg-boss joins that transaction through the `db` adapter so a queued job and
// the domain rows it belongs to commit or roll back together.
import pg from 'pg'

export type Pool = pg.Pool
export type Client = pg.PoolClient

/** the configured repository URL — the SAME authority the Python D1 layer uses */
export function databaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.PAPER2LAB_DATABASE_URL
  if (!url) throw new Error('PAPER2LAB_DATABASE_URL is not configured — the Node science service needs the PostgreSQL authority')
  return url
}

export function createPool(connectionString: string, max = 8): Pool {
  const pool = new pg.Pool({ connectionString, max })
  // an idle client erroring (server restart) must not crash the process
  pool.on('error', (err) => console.error('[paper2lab-node] idle pg client error:', err.message))
  return pool
}

/** run fn inside BEGIN/COMMIT on one client; any throw rolls back */
export async function withTransaction<T>(pool: Pool, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const value = await fn(client)
    await client.query('COMMIT')
    return value
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** pg-boss Db adapter bound to a transaction client (pgboss.io/api/adapters) */
export function bossDb(client: Client): { executeSql: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> } {
  return { executeSql: (text, values) => client.query(text, values as unknown[]) }
}
