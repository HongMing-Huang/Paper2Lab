// J1.2b — the research-turn ledger: one research_tasks row (kind='research')
// per agent activation, with its research_turns record. Same conditional-UPDATE
// discipline as the science ledger: a duplicate delivery never re-runs a model
// turn, a settled turn is never overwritten, and a queued turn cancelled before
// its activation never runs at all.
import type { Client, Pool } from './db.ts'

export const RESEARCH_QUEUE = 'paper2lab.research'
export const RESEARCH_KIND = 'research'

export interface ResearchTurnRow {
  turnId: number
  taskId: number
  workspace: string
  sessionId: string
  prompt: string
  status: string
  finishReason: string | null
  finalResponse: string | null
  steps: Array<Record<string, unknown>>
  assistantTexts: Array<Record<string, unknown>>
  usage: Array<Record<string, unknown>>
  runIds: string[]
  provider: string
  model: string
  error: string | null
}

/** create the turn (queued) + its delivery job on the caller's transaction */
export async function insertResearchTurn(client: Client, args: { workspace: string; prompt: string; sessionId: string }): Promise<{ taskId: number; turnId: number }> {
  const { rows: taskRows } = await client.query<{ id: string }>('INSERT INTO research_tasks (kind, payload) VALUES ($1, $2::jsonb) RETURNING id', [RESEARCH_KIND, JSON.stringify({ prompt: args.prompt, sessionId: args.sessionId })])
  const taskId = Number(taskRows[0].id)
  await client.query('INSERT INTO job_attempts (task_id, status, fence, detail) VALUES ($1, $2, $3, $4)', [taskId, 'queued', 0, 'submit'])
  await client.query('INSERT INTO outbox_events (task_id, event_type, body) VALUES ($1, $2, $3::jsonb)', [taskId, 'task.queued', JSON.stringify({ kind: RESEARCH_KIND })])
  const { rows: turnRows } = await client.query<{ id: string }>('INSERT INTO research_turns (workspace_id, task_id, session_id, prompt) VALUES ($1, $2, $3, $4) RETURNING id', [args.workspace, taskId, args.sessionId, args.prompt])
  return { taskId, turnId: Number(turnRows[0].id) }
}

/** atomic queued→running claim for a research delivery; null = already
 *  claimed/settled/cancelled (or cancelled while queued: the turn is finalized
 *  cancelled and never runs) */
export async function claimResearchTurn(pool: Pool, taskId: number, owner: string): Promise<{ turnId: number; workspace: string; prompt: string; sessionId: string } | null> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{ payload: Record<string, unknown> }>(
      "UPDATE research_tasks SET status = 'running', started_at = now(), lease_owner = $1, lease_expires_at = now() + make_interval(secs => $2) WHERE id = $3 AND kind = $4 AND status = 'queued' AND cancel_requested_at IS NULL RETURNING payload",
      [owner, 900, taskId, RESEARCH_KIND],
    )
    if (rows.length === 0) {
      const { rows: cur } = await client.query<{ status: string; cancel: boolean }>('SELECT status, (cancel_requested_at IS NOT NULL) AS cancel FROM research_tasks WHERE id = $1 FOR UPDATE', [taskId])
      if (cur[0]?.status === 'queued' && cur[0].cancel) {
        await client.query("UPDATE research_tasks SET status = 'cancelled', finished_at = now() WHERE id = $1", [taskId])
        await client.query("UPDATE research_turns SET status = 'cancelled', finished_at = now() WHERE task_id = $1", [taskId])
        await client.query('INSERT INTO outbox_events (task_id, event_type, body) VALUES ($1, $2, $3::jsonb)', [taskId, 'task.cancelled', JSON.stringify({ while: 'queued' })])
      }
      await client.query('COMMIT')
      return null
    }
    await client.query("UPDATE research_turns SET status = 'running', started_at = now() WHERE task_id = $1 AND status = 'queued'", [taskId])
    await client.query('INSERT INTO outbox_events (task_id, event_type, body) VALUES ($1, $2, $3::jsonb)', [taskId, 'task.running', JSON.stringify({ worker: owner })])
    const payload = rows[0].payload
    const { rows: turnRows } = await client.query<{ id: string; workspace_id: string }>('SELECT id, workspace_id FROM research_turns WHERE task_id = $1', [taskId])
    await client.query('COMMIT')
    return { turnId: Number(turnRows[0].id), workspace: turnRows[0].workspace_id, prompt: String(payload.prompt ?? ''), sessionId: String(payload.sessionId ?? '') }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** settle a finished activation (success, provider failure, or cancel) */
export async function settleResearchTurn(
  pool: Pool,
  taskId: number,
  outcome:
    | { kind: 'succeeded'; sessionId: string; finishReason: string | null; finalResponse: string; steps: Array<Record<string, unknown>>; assistantTexts: Array<Record<string, unknown>>; usage: Array<Record<string, unknown>>; runIds: string[]; provider: string; model: string }
    | { kind: 'failed'; error: string; provider: string; model: string; sessionId?: string }
    | { kind: 'cancelled'; reason: string; sessionId?: string },
): Promise<boolean> {
  const status = outcome.kind === 'succeeded' ? 'succeeded' : outcome.kind
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{ id: string }>("UPDATE research_tasks SET status = $1, result = $2::jsonb, finished_at = now(), lease_owner = NULL, lease_expires_at = NULL WHERE id = $3 AND status = 'running' RETURNING id", [status, JSON.stringify({ kind: outcome.kind }), taskId])
    if (rows.length === 0) {
      await client.query('ROLLBACK')
      return false
    }
    if (outcome.kind === 'succeeded') {
      await client.query(
        'UPDATE research_turns SET status = $1, session_id = $2, finish_reason = $3, final_response = $4, steps_json = $5::jsonb, assistant_texts_json = $6::jsonb, usage_json = $7::jsonb, run_ids = $8::jsonb, provider = $9, model = $10, finished_at = now() WHERE task_id = $11',
        [status, outcome.sessionId, outcome.finishReason, outcome.finalResponse, JSON.stringify(outcome.steps), JSON.stringify(outcome.assistantTexts), JSON.stringify(outcome.usage), JSON.stringify(outcome.runIds), outcome.provider, outcome.model, taskId],
      )
    } else {
      // a failed/cancelled turn KEEPS its DSH session binding when the runtime
      // got far enough to create one — the next turn then resumes the same
      // conversation instead of silently starting a fresh session
      await client.query(
        'UPDATE research_turns SET status = $1, error = $2, session_id = COALESCE($3, session_id), finished_at = now() WHERE task_id = $4',
        [status, outcome.kind === 'failed' ? outcome.error : outcome.reason, outcome.sessionId ?? null, taskId],
      )
    }
    await client.query('INSERT INTO outbox_events (task_id, event_type, body) VALUES ($1, $2, $3::jsonb)', [taskId, `task.${status === 'succeeded' ? 'succeeded' : status}` , JSON.stringify({ kind: RESEARCH_KIND })])
    await client.query('COMMIT')
    return true
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** read one turn (joined with its task state) */
export async function getResearchTurn(db: Pool | Client, workspace: string, turnId: number): Promise<ResearchTurnRow | null> {
  const { rows } = await db.query(
    'SELECT t.id AS "turnId", t.task_id AS "taskId", t.workspace_id AS workspace, t.session_id AS "sessionId", t.prompt, t.status, t.finish_reason AS "finishReason", t.final_response AS "finalResponse", t.steps_json AS steps, t.assistant_texts_json AS "assistantTexts", t.usage_json AS usage, t.run_ids AS "runIds", t.provider, t.model, t.error FROM research_turns t WHERE t.id = $1 AND t.workspace_id = $2',
    [turnId, workspace],
  )
  return rows[0] ? normalize(rows[0]) : null
}

/** the session's turns, oldest first (chat history projection) */
export async function listSessionTurns(db: Pool | Client, workspace: string, sessionId: string): Promise<ResearchTurnRow[]> {
  const { rows } = await db.query(
    'SELECT t.id AS "turnId", t.task_id AS "taskId", t.workspace_id AS workspace, t.session_id AS "sessionId", t.prompt, t.status, t.finish_reason AS "finishReason", t.final_response AS "finalResponse", t.steps_json AS steps, t.assistant_texts_json AS "assistantTexts", t.usage_json AS usage, t.run_ids AS "runIds", t.provider, t.model, t.error FROM research_turns t WHERE t.workspace_id = $1 AND t.session_id = $2 AND t.status <> $3 ORDER BY t.id',
    [workspace, sessionId, 'cancelled'],
  )
  return rows.map(normalize)
}

/** recent turns across sessions (console sidebar) */
export async function listRecentTurns(db: Pool | Client, workspace: string, limit: number): Promise<ResearchTurnRow[]> {
  const { rows } = await db.query(
    'SELECT t.id AS "turnId", t.task_id AS "taskId", t.workspace_id AS workspace, t.session_id AS "sessionId", t.prompt, t.status, t.finish_reason AS "finishReason", t.final_response AS "finalResponse", t.steps_json AS steps, t.assistant_texts_json AS "assistantTexts", t.usage_json AS usage, t.run_ids AS "runIds", t.provider, t.model, t.error FROM research_turns t WHERE t.workspace_id = $1 ORDER BY t.id DESC LIMIT $2',
    [workspace, limit],
  )
  return rows.map(normalize)
}

interface RawTurn extends Omit<ResearchTurnRow, 'steps' | 'assistantTexts' | 'usage' | 'runIds'> {
  steps: Array<Record<string, unknown>> | string
  assistantTexts: Array<Record<string, unknown>> | string
  usage: Array<Record<string, unknown>> | string
  runIds: string[] | string
}

function normalize(row: RawTurn): ResearchTurnRow {
  return {
    ...row,
    steps: Array.isArray(row.steps) ? row.steps : JSON.parse(row.steps || '[]'),
    assistantTexts: Array.isArray(row.assistantTexts) ? row.assistantTexts : JSON.parse(row.assistantTexts || '[]'),
    usage: Array.isArray(row.usage) ? row.usage : JSON.parse(row.usage || '[]'),
    runIds: Array.isArray(row.runIds) ? row.runIds : JSON.parse(row.runIds || '[]'),
  }
}
