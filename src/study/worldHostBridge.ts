// CLI-150 浏览器侧世界宿主桥 — Agent 的 world_set_params 在这里真实执行。
// 与玩家同一入口（host.commit：域校验/revision 门/真实 Run/独立判定），
// 执行后把唯一事实（新 revision、参数、判定、Run 列表）回传服务端；同时
// 持续发布 world_state 快照供 Agent world_read。动作未被领取 150s 会在
// 服务端过期（页面没开就是明确失败，不假装成功）。
import { useEffect, useRef } from 'react'
import { host } from '../mathworld/host'
import type { NeedleSessionState } from '../mathworld/needle/session'

const BASE = '/api/v1/world'

interface PendingAction {
  actionId: string
  worldId: string
  expectedRevision: number
  patch: Record<string, number>
}

/** publish the current session snapshot (no second math truth — a projection) */
function publishState(sessionId: string, session: NonNullable<ReturnType<typeof host.getSession>>) {
  const s = session
  const body = {
    sessionId,
    worldId: s.world.id,
    revision: s.revision,
    snapshot: {
      title: s.world.title,
      origin: s.world.origin,
      objective: s.world.objective,
      model: s.world.model,
      params: s.params,
      budgetLeft: s.budgetLeft,
      phase: s.phase,
      lastAssessment: s.committed?.assessment ?? null,
      lastRunIds: s.attempts.at(-1)?.runIds ?? [],
    },
  }
  void fetch(`${BASE}/state`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {})
}

export function useWorldHostBridge(sessionId: string | null) {
  const busy = useRef(false)

  useEffect(() => {
    if (!sessionId) return
    const tick = async () => {
      if (busy.current) return
      const s = host.getSession()
      if (!s) return
      // publish state every tick (cheap upsert; the agent's world_read sees it)
      publishState(sessionId, s)
      busy.current = true
      try {
        const res = await fetch(`${BASE}/actions?sessionId=${encodeURIComponent(sessionId)}&status=pending`)
        if (!res.ok) return
        const { actions } = (await res.json()) as { actions: PendingAction[] }
        for (const action of actions) {
          const worldId = host.getSession()?.world.id
          if (worldId !== action.worldId) {
            await fetch(`${BASE}/actions/${encodeURIComponent(action.actionId)}/receipt`, {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ status: 'rejected', reason: `世界不匹配：动作面向 ${action.worldId}，当前是 ${worldId}` }),
            }).catch(() => {})
            continue
          }
          // the SAME entry the player uses — domain/revision gates built in
          const r = await host.commit(action.patch, { expectedRevision: action.expectedRevision, actor: 'agent' })
          const after = host.getSession()
          const ok = r.status === 'committed'
          const failReason =
            r.status === 'rejected' || r.status === 'superseded' ? (r as { reason?: string }).reason ?? r.status
              : r.status === 'failed' ? `计算失败（世界保持最后合法状态）：${(r as { reason?: string }).reason ?? ''}`
                : r.status
          await fetch(`${BASE}/actions/${encodeURIComponent(action.actionId)}/receipt`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify(ok
              ? {
                  status: 'applied',
                  revision: after?.revision,
                  params: after?.params,
                  assessment: after?.committed?.assessment ?? null,
                  runIds: r.runIds,
                }
              : { status: 'rejected', reason: failReason }),
          }).catch(() => {})
        }
      } finally {
        busy.current = false
      }
    }
    void tick()
    const timer = setInterval(() => { void tick() }, 2500)
    return () => clearInterval(timer)
  }, [sessionId])
}

export type { NeedleSessionState }
