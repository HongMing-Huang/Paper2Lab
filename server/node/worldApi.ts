// CLI-150 最小授权世界工具链的服务端面 — Agent 世界动作的"客户端执行回执"。
//
// 设计：Agent（DSH 插件）不能直接改浏览器里的游戏世界。它提交一条
// world_action（pending），浏览器宿主（StudyGamePanel，与玩家同一
// host.commit 入口）轮询领取、在允许域内执行、回传真实回执（revision、
// 参数、独立判定、Run 列表）。服务端只做记录与转发：
//   - 工具在动作到达终态前不返回成功——浏览器未连接/超时 → expired，明确失败；
//   - operationId 幂等：重复投递返回既有回执，不重复执行；
//   - 回执只能由 pending 一次写入；浏览器回传的 revision/判定是唯一事实。
// 不新建队列/worker：pending 行由浏览器轮询消费，过期由读取方惰性判定。
import type { FastifyInstance } from 'fastify'
import type { Pool } from './db.ts'

export interface WorldApiOptions {
  pool: Pool
  workspace?: string
  /** how long a pending action stays claimable before reads report expired */
  pendingTtlSeconds?: number
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/
const OPERATION_ID_PATTERN = /^[\w.-]{4,120}$/
/** 参数补丁是有界 JSON：键为参数名、值为有限数（与 host.commit 的合同一致） */
function parsePatch(v: unknown): Record<string, number> | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'patch 必须是 {参数名: 数值} 对象'
  const out: Record<string, number> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val !== 'number' || !Number.isFinite(val)) return `patch.${k} 必须是有限数`
    out[k] = val
  }
  if (Object.keys(out).length === 0) return 'patch 不能为空'
  return out
}

interface ActionRow {
  operation_id: string
  session_id: string
  world_id: string
  expected_revision: number
  patch: Record<string, number>
  status: string
  receipt: Record<string, unknown> | null
  created_at: string
  settled_at: string | null
}

export function buildWorldApi(opts: WorldApiOptions & { app: FastifyInstance }): void {
  const { pool } = opts
  const workspace = opts.workspace ?? 'default'
  const ttl = opts.pendingTtlSeconds ?? 150

  /** lazy expiry: a pending action nobody claimed within the TTL reads expired */
  const withExpiry = async (rows: ActionRow[]): Promise<ActionRow[]> => {
    const stale = rows.filter((r) => r.status === 'pending' && Date.now() - Date.parse(r.created_at) > ttl * 1000)
    for (const r of stale) {
      await pool.query("UPDATE world_actions SET status = 'expired', settled_at = now(), receipt = $1 WHERE operation_id = $2 AND status = 'pending'", [
        JSON.stringify({ status: 'expired', reason: `浏览器宿主 ${ttl}s 内未领取（页面未打开或未连接）` }),
        r.operation_id,
      ])
      r.status = 'expired'
    }
    return rows
  }

  // ---- world state (browser-published; the Agent reads it via world_read) ----
  opts.app.post('/api/v1/world/state', async (req, reply) => {
    const b = req.body as { sessionId?: unknown; worldId?: unknown; revision?: unknown; snapshot?: unknown }
    const sessionId = String(b?.sessionId ?? '')
    const worldId = String(b?.worldId ?? '')
    const revision = Number(b?.revision)
    if (!SESSION_ID_PATTERN.test(sessionId)) return reply.code(422).send({ message: 'sessionId 非法' })
    if (!worldId || !Number.isInteger(revision) || revision < 0) return reply.code(422).send({ message: '需要 worldId 与非负整数 revision' })
    const snapshot = b?.snapshot && typeof b.snapshot === 'object' && !Array.isArray(b.snapshot) ? b.snapshot : {}
    await pool.query(
      `INSERT INTO world_state (workspace_id, session_id, world_id, revision, snapshot, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (workspace_id, session_id) DO UPDATE SET world_id = $3, revision = $4, snapshot = $5, updated_at = now()`,
      [workspace, sessionId, worldId, revision, JSON.stringify(snapshot)],
    )
    return reply.code(204).send()
  })

  opts.app.get('/api/v1/world/state', async (req, reply) => {
    const sessionId = String((req.query as { sessionId?: unknown }).sessionId ?? '')
    if (!SESSION_ID_PATTERN.test(sessionId)) return reply.code(422).send({ message: 'sessionId 非法' })
    const { rows } = await pool.query<{ world_id: string; revision: number; snapshot: Record<string, unknown>; updated_at: string }>(
      'SELECT world_id, revision, snapshot, updated_at FROM world_state WHERE workspace_id = $1 AND session_id = $2',
      [workspace, sessionId],
    )
    if (rows.length === 0) return reply.code(404).send({ message: '该会话还没有浏览器宿主发布的世界状态（页面未打开或尚未进入游戏台）' })
    return { sessionId, worldId: rows[0].world_id, revision: rows[0].revision, snapshot: rows[0].snapshot, updatedAt: rows[0].updated_at }
  })

  // ---- world actions (submit → browser executes → receipt settles) ----
  opts.app.post('/api/v1/world/actions', async (req, reply) => {
    const b = req.body as { sessionId?: unknown; operationId?: unknown; worldId?: unknown; expectedRevision?: unknown; patch?: unknown }
    const sessionId = String(b?.sessionId ?? '')
    const operationId = String(b?.operationId ?? '')
    const worldId = String(b?.worldId ?? '')
    const expectedRevision = Number(b?.expectedRevision)
    if (!SESSION_ID_PATTERN.test(sessionId)) return reply.code(422).send({ message: 'sessionId 非法' })
    if (!OPERATION_ID_PATTERN.test(operationId)) return reply.code(422).send({ message: 'operationId 非法（4–120 位 word 字符）' })
    if (!worldId) return reply.code(422).send({ message: '需要 worldId（当前世界身份，来自 world_read）' })
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) return reply.code(422).send({ message: 'expectedRevision 必须是非负整数（来自 world_read 的 revision）' })
    const patch = parsePatch(b?.patch)
    if (typeof patch === 'string') return reply.code(422).send({ message: patch })
    // idempotent submit: same operationId returns the recorded row as-is
    const existing = await pool.query<ActionRow>('SELECT * FROM world_actions WHERE operation_id = $1', [operationId])
    if (existing.rows.length > 0) {
      const row = existing.rows[0]
      if (row.session_id !== sessionId) return reply.code(409).send({ message: '该 operationId 已属于另一个会话' })
      return reply.code(200).send({ actionId: row.operation_id, status: row.status, receipt: row.receipt })
    }
    await pool.query(
      `INSERT INTO world_actions (workspace_id, operation_id, session_id, world_id, expected_revision, patch, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       ON CONFLICT (operation_id) DO NOTHING`,
      [workspace, operationId, sessionId, worldId, expectedRevision, JSON.stringify(patch)],
    )
    return reply.code(202).send({ actionId: operationId, status: 'pending' })
  })

  opts.app.get('/api/v1/world/actions', async (req, reply) => {
    const q = req.query as { sessionId?: unknown; status?: unknown }
    const sessionId = String(q.sessionId ?? '')
    if (!SESSION_ID_PATTERN.test(sessionId)) return reply.code(422).send({ message: 'sessionId 非法' })
    const status = q.status === 'pending' ? 'pending' : null
    const { rows } = await pool.query<ActionRow>(
      `SELECT * FROM world_actions WHERE workspace_id = $1 AND session_id = $2 ${status ? "AND status = 'pending'" : ''} ORDER BY id DESC LIMIT 20`,
      [workspace, sessionId],
    )
    return { actions: await withExpiry(rows) }
  })

  opts.app.get('/api/v1/world/actions/:operationId', async (req, reply) => {
    const operationId = String((req.params as { operationId?: unknown }).operationId ?? '')
    const { rows } = await pool.query<ActionRow>('SELECT * FROM world_actions WHERE operation_id = $1', [operationId])
    if (rows.length === 0) return reply.code(404).send({ message: `未知世界动作 ${operationId}` })
    await withExpiry(rows)
    return { actionId: rows[0].operation_id, status: rows[0].status, receipt: rows[0].receipt, expectedRevision: rows[0].expected_revision, patch: rows[0].patch }
  })

  /** the browser host's receipt — the ONLY writer of a terminal state */
  opts.app.post('/api/v1/world/actions/:operationId/receipt', async (req, reply) => {
    const operationId = String((req.params as { operationId?: unknown }).operationId ?? '')
    const b = req.body as { status?: unknown; revision?: unknown; params?: unknown; assessment?: unknown; runIds?: unknown; reason?: unknown }
    const status = String(b?.status ?? '')
    if (status !== 'applied' && status !== 'rejected') return reply.code(422).send({ message: 'receipt.status 只能是 applied | rejected' })
    const receipt: Record<string, unknown> = { status }
    if (status === 'applied') {
      if (!Number.isInteger(Number(b?.revision))) return reply.code(422).send({ message: 'applied 回执必须带执行后的 revision' })
      receipt.revision = Number(b.revision)
      if (b?.params && typeof b.params === 'object') receipt.params = b.params
      if (b?.assessment !== undefined) receipt.assessment = b.assessment
      if (Array.isArray(b?.runIds)) receipt.runIds = b.runIds.map(String)
    }
    if (typeof b?.reason === 'string' && b.reason) receipt.reason = b.reason
    const { rowCount } = await pool.query(
      "UPDATE world_actions SET status = $1, receipt = $2, settled_at = now() WHERE operation_id = $3 AND status = 'pending'",
      [status, JSON.stringify(receipt), operationId],
    )
    if (rowCount === 0) {
      const { rows } = await pool.query<ActionRow>('SELECT status, receipt FROM world_actions WHERE operation_id = $1', [operationId])
      if (rows.length === 0) return reply.code(404).send({ message: `未知世界动作 ${operationId}` })
      // already settled (duplicate delivery / race): return the recorded receipt
      return reply.code(200).send({ actionId: operationId, status: rows[0].status, receipt: rows[0].receipt, duplicate: true })
    }
    return reply.code(200).send({ actionId: operationId, ...receipt })
  })
}
