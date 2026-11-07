// J1.2a — reading committed Runs out of PostgreSQL. experiment_runs is the
// write authority for the Node science chain; imported_runs (the legacy JSONL
// landing) stays read-only alongside it.
import { createHash } from 'node:crypto'
import type { Pool } from './db.ts'
import { canonicalJson } from '../../src/skills/playPlan.ts'
import { validateImportedRun, type ExperimentRun } from '../../src/experiments/protocol.ts'

export interface CommittedRun {
  record: ExperimentRun
  governingPlan: unknown
  operationPk: number
  committedAt: string
}

function verifyContent(record: ExperimentRun, contentSha256: string): void {
  const actual = createHash('sha256').update(canonicalJson(record)).digest('hex')
  if (actual !== contentSha256) throw new Error(`run ${record.runId} content hash mismatch (expected sha256:${contentSha256.slice(0, 12)}…)`)
}

/** one committed run (full record verified against its stored content hash) */
export async function loadRun(pool: Pool, workspace: string, runId: string): Promise<CommittedRun | null> {
  const { rows } = await pool.query<{ record_json: ExperimentRun; governing_plan: unknown; operation_pk: string; committed_at: Date; content_sha256: string }>(
    'SELECT record_json, governing_plan, operation_pk, committed_at, content_sha256 FROM experiment_runs WHERE run_id = $1 AND workspace_id = $2',
    [runId, workspace],
  )
  const row = rows[0]
  if (!row) return null
  const record = row.record_json
  try {
    validateImportedRun(record)
    verifyContent(record, row.content_sha256)
  } catch (err) {
    throw new Error(`committed run ${runId} failed verification: ${err instanceof Error ? err.message : String(err)}`)
  }
  return { record, governingPlan: row.governing_plan, operationPk: Number(row.operation_pk), committedAt: new Date(row.committed_at).toISOString() }
}

/** recent committed runs (records verified), newest first */
export async function listRuns(pool: Pool, workspace: string, limit: number, kind?: string): Promise<CommittedRun[]> {
  const { rows } = await pool.query<{ record_json: ExperimentRun; governing_plan: unknown; operation_pk: string; committed_at: Date; content_sha256: string }>(
    'SELECT record_json, governing_plan, operation_pk, committed_at, content_sha256 FROM experiment_runs WHERE workspace_id = $1 AND ($2::text IS NULL OR kind = $2) ORDER BY committed_at DESC LIMIT $3',
    [workspace, kind ?? null, limit],
  )
  return rows.map((row) => {
    const record = row.record_json
    validateImportedRun(record)
    verifyContent(record, row.content_sha256)
    return { record, governingPlan: row.governing_plan, operationPk: Number(row.operation_pk), committedAt: new Date(row.committed_at).toISOString() }
  })
}
