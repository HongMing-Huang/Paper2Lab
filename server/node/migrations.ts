// J1.2a — the ONE schema history, applied from Node. Versions 1–14 are the
// D1/P1/J1.1 migrations of server/db.py, copied VERBATIM (the drift guard in
// science.test.ts compares every statement and rollback note against db.py),
// so the new default chain bootstraps a fresh database without Python while an
// existing database simply skips what is already applied. 15+ are new and
// owned here. Every execute site carries its statement as a string LITERAL
// (same rule as db.py) — no SQL is ever assembled from values.
import { withTransaction, type Client, type Pool } from './db.ts'

interface Migration {
  version: number
  /** the statement text recorded in schema_migrations (db.py records the same) */
  recorded: string
  rollback: string
  apply: (client: Client) => Promise<unknown>
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    recorded: 'CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    rollback: 'DROP TABLE workspaces',
    apply: (c) => c.query('CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now())'),
  },
  {
    version: 2,
    recorded: 'CREATE TABLE IF NOT EXISTS artifacts (sha256 TEXT PRIMARY KEY, byte_length BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    rollback: 'DROP TABLE artifacts',
    apply: (c) => c.query('CREATE TABLE IF NOT EXISTS artifacts (sha256 TEXT PRIMARY KEY, byte_length BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())'),
  },
  {
    version: 3,
    recorded: "CREATE TABLE IF NOT EXISTS papers (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces (id), sha256 TEXT NOT NULL, title_hint TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (workspace_id, sha256))",
    rollback: 'DROP TABLE papers',
    apply: (c) => c.query("CREATE TABLE IF NOT EXISTS papers (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces (id), sha256 TEXT NOT NULL, title_hint TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (workspace_id, sha256))"),
  },
  {
    version: 4,
    recorded: 'CREATE TABLE IF NOT EXISTS paper_versions (id TEXT PRIMARY KEY, paper_id TEXT NOT NULL REFERENCES papers (id), artifact_sha TEXT NOT NULL REFERENCES artifacts (sha256), size_bytes BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (paper_id, artifact_sha))',
    rollback: 'DROP TABLE paper_versions',
    apply: (c) => c.query('CREATE TABLE IF NOT EXISTS paper_versions (id TEXT PRIMARY KEY, paper_id TEXT NOT NULL REFERENCES papers (id), artifact_sha TEXT NOT NULL REFERENCES artifacts (sha256), size_bytes BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (paper_id, artifact_sha))'),
  },
  {
    version: 5,
    recorded: 'CREATE TABLE IF NOT EXISTS upload_events (id BIGSERIAL PRIMARY KEY, version_id TEXT NOT NULL REFERENCES paper_versions (id), filename TEXT NOT NULL, uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    rollback: 'DROP TABLE upload_events',
    apply: (c) => c.query('CREATE TABLE IF NOT EXISTS upload_events (id BIGSERIAL PRIMARY KEY, version_id TEXT NOT NULL REFERENCES paper_versions (id), filename TEXT NOT NULL, uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now())'),
  },
  {
    version: 6,
    recorded: 'CREATE TABLE IF NOT EXISTS imported_docs (doc_id TEXT PRIMARY KEY, provenance TEXT NOT NULL, content_sha256 TEXT NOT NULL, doc_json JSONB NOT NULL, imported_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    rollback: 'DROP TABLE imported_docs',
    apply: (c) => c.query('CREATE TABLE IF NOT EXISTS imported_docs (doc_id TEXT PRIMARY KEY, provenance TEXT NOT NULL, content_sha256 TEXT NOT NULL, doc_json JSONB NOT NULL, imported_at TIMESTAMPTZ NOT NULL DEFAULT now())'),
  },
  {
    version: 7,
    recorded: 'CREATE TABLE IF NOT EXISTS imported_runs (run_id TEXT PRIMARY KEY, status TEXT NOT NULL, result_json JSONB, record_json JSONB NOT NULL, content_sha256 TEXT NOT NULL, imported_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    rollback: 'DROP TABLE imported_runs',
    apply: (c) => c.query('CREATE TABLE IF NOT EXISTS imported_runs (run_id TEXT PRIMARY KEY, status TEXT NOT NULL, result_json JSONB, record_json JSONB NOT NULL, content_sha256 TEXT NOT NULL, imported_at TIMESTAMPTZ NOT NULL DEFAULT now())'),
  },
  {
    version: 8,
    recorded: "CREATE TABLE IF NOT EXISTS documents (doc_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL DEFAULT 'default', provenance TEXT NOT NULL, content_sha256 TEXT NOT NULL, doc_json JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    rollback: 'DROP TABLE documents',
    apply: (c) => c.query("CREATE TABLE IF NOT EXISTS documents (doc_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL DEFAULT 'default', provenance TEXT NOT NULL, content_sha256 TEXT NOT NULL, doc_json JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())"),
  },
  {
    version: 9,
    recorded: 'CREATE TABLE IF NOT EXISTS parse_artifacts (id BIGSERIAL PRIMARY KEY, paper_id TEXT NOT NULL REFERENCES papers (id), version_id TEXT NOT NULL REFERENCES paper_versions (id), doc_id TEXT NOT NULL, parser TEXT NOT NULL, parser_version TEXT NOT NULL, anchor_precision TEXT NOT NULL, parse_json JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    rollback: 'DROP TABLE parse_artifacts',
    apply: (c) => c.query('CREATE TABLE IF NOT EXISTS parse_artifacts (id BIGSERIAL PRIMARY KEY, paper_id TEXT NOT NULL REFERENCES papers (id), version_id TEXT NOT NULL REFERENCES paper_versions (id), doc_id TEXT NOT NULL, parser TEXT NOT NULL, parser_version TEXT NOT NULL, anchor_precision TEXT NOT NULL, parse_json JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())'),
  },
  {
    version: 10,
    recorded: 'ALTER TABLE papers ADD COLUMN IF NOT EXISTS identifier TEXT; CREATE UNIQUE INDEX papers_ws_identifier_uq',
    rollback: 'DROP INDEX papers_ws_identifier_uq; ALTER TABLE papers DROP COLUMN identifier',
    apply: async (c) => {
      await c.query('ALTER TABLE papers ADD COLUMN IF NOT EXISTS identifier TEXT')
      await c.query('CREATE UNIQUE INDEX IF NOT EXISTS papers_ws_identifier_uq ON papers (workspace_id, identifier) WHERE identifier IS NOT NULL')
    },
  },
  {
    version: 11,
    recorded: "CREATE TABLE IF NOT EXISTS research_tasks (id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL, payload JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'queued', rq_job_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ)",
    rollback: 'DROP TABLE research_tasks',
    apply: (c) => c.query("CREATE TABLE IF NOT EXISTS research_tasks (id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL, payload JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'queued', rq_job_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ)"),
  },
  {
    version: 12,
    recorded: 'CREATE TABLE IF NOT EXISTS job_attempts (id BIGSERIAL PRIMARY KEY, task_id BIGINT NOT NULL REFERENCES research_tasks (id), status TEXT NOT NULL, detail TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    rollback: 'DROP TABLE job_attempts',
    apply: (c) => c.query('CREATE TABLE IF NOT EXISTS job_attempts (id BIGSERIAL PRIMARY KEY, task_id BIGINT NOT NULL REFERENCES research_tasks (id), status TEXT NOT NULL, detail TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())'),
  },
  {
    version: 13,
    recorded: "CREATE TABLE IF NOT EXISTS outbox_events (id BIGSERIAL PRIMARY KEY, task_id BIGINT NOT NULL REFERENCES research_tasks (id), event_type TEXT NOT NULL, body JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    rollback: 'DROP TABLE outbox_events',
    apply: (c) => c.query("CREATE TABLE IF NOT EXISTS outbox_events (id BIGSERIAL PRIMARY KEY, task_id BIGINT NOT NULL REFERENCES research_tasks (id), event_type TEXT NOT NULL, body JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now())"),
  },
  {
    version: 14,
    recorded: 'ALTER TABLE research_tasks ADD COLUMN IF NOT EXISTS stage TEXT, ADD COLUMN IF NOT EXISTS result JSONB, ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ',
    rollback: 'ALTER TABLE research_tasks DROP COLUMN stage, DROP COLUMN result, DROP COLUMN started_at',
    apply: (c) => c.query('ALTER TABLE research_tasks ADD COLUMN IF NOT EXISTS stage TEXT, ADD COLUMN IF NOT EXISTS result JSONB, ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ'),
  },
  // ---- J1.2a (Node-owned from here) -----------------------------------------
  {
    // lease + fencing: a claim bumps the fence column; every later write of
    // that attempt is conditional on it, so a stale worker can never commit
    version: 15,
    recorded: 'ALTER TABLE research_tasks ADD COLUMN fence, lease_owner, lease_expires_at, cancel_requested_at, queue_job_id; ALTER TABLE job_attempts ADD COLUMN fence',
    rollback: 'ALTER TABLE job_attempts DROP COLUMN fence; ALTER TABLE research_tasks DROP COLUMN queue_job_id, DROP COLUMN cancel_requested_at, DROP COLUMN lease_expires_at, DROP COLUMN lease_owner, DROP COLUMN fence',
    apply: async (c) => {
      await c.query('ALTER TABLE research_tasks ADD COLUMN IF NOT EXISTS fence BIGINT NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS lease_owner TEXT, ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ')
      await c.query('ALTER TABLE research_tasks ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS queue_job_id TEXT')
      await c.query('ALTER TABLE job_attempts ADD COLUMN IF NOT EXISTS fence BIGINT')
    },
  },
  {
    // the PERSISTENT operation receipt (the toolPort in-process ledger, J1
    // version): one row per workspace + operation + idempotency key
    version: 16,
    recorded: 'CREATE TABLE science_operations (id, workspace_id, operation_id, idempotency_key, skill, input_digest, request, task_id, state, run_id, receipt, created_at, settled_at; UNIQUE workspace_id+operation_id+idempotency_key); CREATE INDEX science_operations_task_idx',
    rollback: 'DROP INDEX science_operations_task_idx; DROP TABLE science_operations',
    apply: async (c) => {
      await c.query("CREATE TABLE IF NOT EXISTS science_operations (id BIGSERIAL PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces (id), operation_id TEXT NOT NULL, idempotency_key TEXT NOT NULL DEFAULT '', UNIQUE (workspace_id, operation_id, idempotency_key))")
      await c.query('ALTER TABLE science_operations ADD COLUMN IF NOT EXISTS skill TEXT NOT NULL, ADD COLUMN IF NOT EXISTS input_digest TEXT NOT NULL, ADD COLUMN IF NOT EXISTS request JSONB NOT NULL')
      await c.query('ALTER TABLE science_operations ADD COLUMN IF NOT EXISTS task_id BIGINT NOT NULL REFERENCES research_tasks (id)')
      await c.query("ALTER TABLE science_operations ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'accepted', ADD COLUMN IF NOT EXISTS run_id TEXT, ADD COLUMN IF NOT EXISTS receipt JSONB")
      await c.query('ALTER TABLE science_operations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(), ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ')
      await c.query('CREATE INDEX IF NOT EXISTS science_operations_task_idx ON science_operations (task_id)')
    },
  },
  {
    // the WRITE AUTHORITY for executed Runs (imported_runs stays the read-only
    // legacy landing). At most one committed Run per operation row.
    version: 17,
    recorded: 'CREATE TABLE experiment_runs (run_id, workspace_id, operation_pk UNIQUE, task_id, attempt_id, fence, skill, kind, status, parent_run_id, engine, engine_version, record_json, governing_plan, content_sha256, committed_at); CREATE INDEX experiment_runs_ws_committed_idx',
    rollback: 'DROP INDEX experiment_runs_ws_committed_idx; DROP TABLE experiment_runs',
    apply: async (c) => {
      await c.query('CREATE TABLE IF NOT EXISTS experiment_runs (run_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces (id), operation_pk BIGINT NOT NULL UNIQUE REFERENCES science_operations (id))')
      await c.query('ALTER TABLE experiment_runs ADD COLUMN IF NOT EXISTS task_id BIGINT NOT NULL REFERENCES research_tasks (id), ADD COLUMN IF NOT EXISTS attempt_id BIGINT NOT NULL REFERENCES job_attempts (id)')
      await c.query('ALTER TABLE experiment_runs ADD COLUMN IF NOT EXISTS fence BIGINT NOT NULL, ADD COLUMN IF NOT EXISTS skill TEXT NOT NULL, ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL, ADD COLUMN IF NOT EXISTS status TEXT NOT NULL')
      await c.query('ALTER TABLE experiment_runs ADD COLUMN IF NOT EXISTS parent_run_id TEXT, ADD COLUMN IF NOT EXISTS engine TEXT NOT NULL, ADD COLUMN IF NOT EXISTS engine_version TEXT NOT NULL')
      await c.query('ALTER TABLE experiment_runs ADD COLUMN IF NOT EXISTS record_json JSONB NOT NULL, ADD COLUMN IF NOT EXISTS governing_plan JSONB, ADD COLUMN IF NOT EXISTS content_sha256 TEXT NOT NULL')
      await c.query('ALTER TABLE experiment_runs ADD COLUMN IF NOT EXISTS committed_at TIMESTAMPTZ NOT NULL DEFAULT now()')
      await c.query('CREATE INDEX IF NOT EXISTS experiment_runs_ws_committed_idx ON experiment_runs (workspace_id, committed_at DESC)')
    },
  },
  {
    // J1.2b: agent research turns — one row per activation, append-only steps
    // (tool calls/results) and the model's answers, with provider identity and
    // usage accounting. A turn's runs are referenced, never duplicated.
    version: 18,
    recorded: 'CREATE TABLE research_turns (id, workspace_id, task_id UNIQUE, session_id, prompt, status, finish_reason, final_response, steps_json, assistant_texts_json, usage_json, run_ids, provider, model, started_at, finished_at, error); CREATE INDEX research_turns_session_idx',
    rollback: 'DROP INDEX research_turns_session_idx; DROP TABLE research_turns',
    apply: async (c) => {
      await c.query('CREATE TABLE IF NOT EXISTS research_turns (id BIGSERIAL PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces (id), task_id BIGINT NOT NULL UNIQUE REFERENCES research_tasks (id))')
      await c.query("ALTER TABLE research_turns ADD COLUMN IF NOT EXISTS session_id TEXT NOT NULL DEFAULT ''")
      await c.query('ALTER TABLE research_turns ADD COLUMN IF NOT EXISTS prompt TEXT NOT NULL')
      await c.query("ALTER TABLE research_turns ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'queued'")
      await c.query('ALTER TABLE research_turns ADD COLUMN IF NOT EXISTS finish_reason TEXT, ADD COLUMN IF NOT EXISTS final_response TEXT')
      await c.query("ALTER TABLE research_turns ADD COLUMN IF NOT EXISTS steps_json JSONB NOT NULL DEFAULT '[]', ADD COLUMN IF NOT EXISTS assistant_texts_json JSONB NOT NULL DEFAULT '[]', ADD COLUMN IF NOT EXISTS usage_json JSONB NOT NULL DEFAULT '[]', ADD COLUMN IF NOT EXISTS run_ids JSONB NOT NULL DEFAULT '[]'")
      await c.query("ALTER TABLE research_turns ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS model TEXT NOT NULL DEFAULT ''")
      await c.query('ALTER TABLE research_turns ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS error TEXT')
      await c.query('CREATE INDEX IF NOT EXISTS research_turns_session_idx ON research_turns (workspace_id, session_id, id)')
    },
  },
  {
    // CLI-150 最小授权世界工具链：Agent 世界动作的客户端执行回执。
    // world_actions 只记录与转发——浏览器宿主（与玩家同一 host.commit 入口）
    // 轮询领取、执行、回传唯一事实（revision/判定/Run 列表）；pending 行由
    // 读取方按 TTL 惰性过期（不建第二个队列/worker）。world_state 是浏览器
    // 宿主发布的当前世界快照（Agent world_read 读它，不做第二份数学真值）。
    version: 19,
    recorded: 'CREATE TABLE world_actions (id, workspace_id, operation_id UNIQUE, session_id, world_id, expected_revision, patch, status, receipt, created_at, settled_at); CREATE INDEX world_actions_session_idx; CREATE TABLE world_state (workspace_id, session_id UNIQUE, world_id, revision, snapshot, updated_at)',
    rollback: 'DROP TABLE world_state; DROP INDEX world_actions_session_idx; DROP TABLE world_actions',
    apply: async (c) => {
      await c.query('CREATE TABLE IF NOT EXISTS world_actions (id BIGSERIAL PRIMARY KEY, workspace_id TEXT NOT NULL, operation_id TEXT NOT NULL UNIQUE)')
      await c.query("ALTER TABLE world_actions ADD COLUMN IF NOT EXISTS session_id TEXT NOT NULL DEFAULT ''")
      await c.query("ALTER TABLE world_actions ADD COLUMN IF NOT EXISTS world_id TEXT NOT NULL DEFAULT ''")
      await c.query('ALTER TABLE world_actions ADD COLUMN IF NOT EXISTS expected_revision INT NOT NULL DEFAULT 0')
      await c.query("ALTER TABLE world_actions ADD COLUMN IF NOT EXISTS patch JSONB NOT NULL DEFAULT '{}'")
      await c.query("ALTER TABLE world_actions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'")
      await c.query('ALTER TABLE world_actions ADD COLUMN IF NOT EXISTS receipt JSONB')
      await c.query('ALTER TABLE world_actions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()')
      await c.query('ALTER TABLE world_actions ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ')
      await c.query('CREATE INDEX IF NOT EXISTS world_actions_session_idx ON world_actions (workspace_id, session_id, id)')
      await c.query("CREATE TABLE IF NOT EXISTS world_state (workspace_id TEXT NOT NULL, session_id TEXT NOT NULL, UNIQUE (workspace_id, session_id))")
      await c.query("ALTER TABLE world_state ADD COLUMN IF NOT EXISTS world_id TEXT NOT NULL DEFAULT ''")
      await c.query('ALTER TABLE world_state ADD COLUMN IF NOT EXISTS revision INT NOT NULL DEFAULT 0')
      await c.query("ALTER TABLE world_state ADD COLUMN IF NOT EXISTS snapshot JSONB NOT NULL DEFAULT '{}'")
      await c.query('ALTER TABLE world_state ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()')
    },
  },
]

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

/** apply every pending migration in ONE transaction, serialized across Node
 *  processes by an advisory lock (the PK on schema_migrations still rejects a
 *  concurrent Python migrate on the same version) */
export async function migrate(pool: Pool): Promise<{ from: number; to: number }> {
  return withTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['paper2lab:schema_migrations'])
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now(), statement TEXT NOT NULL, rollback_note TEXT NOT NULL)')
    const { rows } = await client.query<{ max: number | null }>('SELECT max(version) AS max FROM schema_migrations')
    const from = rows[0]?.max ?? 0
    for (const m of MIGRATIONS) {
      if (m.version <= from) continue
      await m.apply(client)
      await client.query('INSERT INTO schema_migrations (version, statement, rollback_note) VALUES ($1, $2, $3)', [m.version, m.recorded, m.rollback])
    }
    return { from, to: Math.max(from, LATEST_VERSION) }
  })
}
