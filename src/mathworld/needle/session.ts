// Needle game session (CLI-129) — the game Host. It owns the canonical
// needle state and the ONLY write path: every accepted action goes through
// applyAction, is recorded as a real needle.move ExperimentRun (chained by
// parentRunId), and consumes one unit of the frozen action budget. Blocked
// and unknown actions change nothing and are logged with the contact point /
// reason. Undo restores the previous certified state and refunds the budget
// (it is the inverse bookkeeping of the same action, not a new computation);
// restore replays the saved action list through the SAME transition — the
// file's solved flag never grants a win. Keyboard input and window.__mathworld
// call the same act() entry.
import { planInputDigest, registerPlan } from '../../skills/playPlan'
import { validateNeedleWorld } from './validate'
import { checkGoal, stateKey, type NeedleAction, type NeedleModel, type NeedleState, type Point } from './model'
import { applyAction } from './transition'
import { replayPath, solveNeedle, type SolveResult } from './solve'
import { recordMoveRun, recordSolveRun, type NeedleSource } from './runs'

export type NeedlePhase = 'playing' | 'won'
export type NeedleActor = 'user' | 'agent' | 'restore' | 'init'

export interface NeedleHistoryEntry {
  actionId: string
  from: NeedleState
  to: NeedleState
  runId: string
  at: number
}

export interface NeedleBlockedEntry {
  actionId: string
  status: 'blocked' | 'unknown' | 'rejected'
  reason: string
  contact: Point | null
  /** the pose the blocked action tried to reach (ghost display only) */
  attempted?: NeedleState
  at: number
}

export interface NeedleNotice { kind: 'info' | 'warn' | 'error' | 'success'; text: string; at: number }

export interface NeedleSessionState {
  world: import('./model').NeedleWorldDef
  model: NeedleModel
  worldDigest: string
  sessionId: string
  /** increments on every accepted action AND undo/reset — stale receipts die */
  revision: number
  state: NeedleState
  history: NeedleHistoryEntry[]
  blocked: NeedleBlockedEntry[]
  budgetLeft: number
  phase: NeedlePhase
  wonAtStep: number | null
  notice: NeedleNotice | null
  /** last blocked contact for the scene flash */
  contact: { point: Point; at: number } | null
  solve: { result: SolveResult; runId: string; at: number } | null
  restored: 'file' | 'local' | null
}

const SAVE_FORMAT = 'paper2lab.mathworld.needle.save/v1'
const LOCAL_KEY = (worldId: string) => `paper2lab.mathworld.needle.v1.${worldId}`

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export class NeedleHost {
  private st: NeedleSessionState | null = null
  private listeners = new Set<() => void>()

  subscribe = (cb: () => void) => { this.listeners.add(cb); return () => { this.listeners.delete(cb) } }
  getSession = () => this.st
  private emit() { for (const cb of this.listeners) cb() }
  /** single assignment point: every state transition builds a NEW frozen
   *  object — an external holder of a previous snapshot (window API, React)
   *  can never mutate the live session through it */
  private commit(next: NeedleSessionState) {
    this.st = Object.freeze(next)
    this.emit()
  }
  private patch(next: Partial<NeedleSessionState>) {
    if (!this.st) return
    this.commit({ ...this.st, ...next })
  }
  private note(kind: NeedleNotice['kind'], text: string) {
    this.patch({ notice: { kind, text, at: Date.now() } })
  }

  /** activate a needle world: validate (incl. static start gate) → plan → fresh session */
  activate(raw: unknown, origin: 'catalog' | 'edited' | 'file'): { ok: true } | { ok: false; errors: string[] } {
    const v = validateNeedleWorld(raw)
    if (!v.ok) return { ok: false, errors: v.errors }
    const world = structuredClone(v.world)
    const model = world.model
    const worldDigest = planInputDigest(world as unknown as Record<string, unknown>)
    const start: NeedleState = { cx: model.start.x, cy: model.start.y, k: model.start.k }
    registerPlan({
      planId: `mw-needle-${world.id}-${worldDigest.slice(7, 19)}`,
      goal: world.objective,
      source: { docId: `mathworld:${world.id}`, title: world.title },
      variables: [],
      assumptions: [
        world.origin.kind === 'dev-sample' ? '开发样例：手写走廊布局，不是 PDF 解析、不是 Qwen 生成' : '用户编辑的世界定义，未经来源确认',
        '墙体/杆厚/出口/预算是教学游戏规则，不是 Wang–Zahl 论文模型；通关不证明定理',
      ],
      skill: 'needle.move',
      skillVersion: 'needle-geom@0.1',
      renderer: 'r3f',
      metrics: ['accepted-actions', 'certified-clearance', 'exit-contained', 'orientation'],
      inputs: { model: { bounds: model.bounds, walls: model.walls, exit: model.exit, halfLen: model.halfLen, radius: model.radius, cell: model.cell } },
      evidenceBasis: '浏览器内 needle-geom 整段运动界认证（CALCULATED）；Goal 独立于 transition',
      successCriteria: '每个接受动作产生绑定世界 digest 与状态的 needle.move Run；整杆入出口且竖直才判通关',
      nonClaims: ['不得声称证明 Kakeya 集合论定理（定长杆搬运教学变体）', '求解器结论仅限本有限动作图'],
      createdAt: Date.now(),
    })
    this.st = {
      world, model, worldDigest,
      sessionId: uid('nws'),
      revision: 0,
      state: start,
      history: [],
      blocked: [],
      budgetLeft: model.actionBudget,
      phase: 'playing',
      wonAtStep: null,
      notice: null,
      contact: null,
      solve: null,
      restored: null,
    }
    void origin
    this.emit()
    this.note('info', '关卡已冻结：移动 ←→↑↓ / WASD，旋转 Q/E，撤销 Z，重开 R。整根杆进入出口且竖直才算通关。')
    return { ok: true }
  }

  private source(action: string, actor: NeedleActor): NeedleSource {
    const s = this.st!
    return {
      kind: 'mathworld-needle',
      worldId: s.world.id,
      worldDigest: s.worldDigest,
      sessionId: s.sessionId,
      action,
      revision: s.revision,
      actor,
      note: 'needle-geom 整段认证；游戏规则非论文模型',
    }
  }

  /** THE action entry — keyboard, buttons, agent and restore all land here.
   *  Async only because recording the Run goes through executeSpec; the
   *  geometric decision itself is synchronous and local. */
  async act(
    actionIdOrAction: string | NeedleAction,
    opts: { expectedRevision?: number; actor?: NeedleActor } = {},
  ): Promise<{ status: 'accepted' | 'blocked' | 'unknown' | 'rejected' | 'won'; reason?: string }> {
    const s = this.st
    if (!s) return { status: 'rejected', reason: '没有加载关卡' }
    const actor = opts.actor ?? 'user'
    if (opts.expectedRevision !== undefined && opts.expectedRevision !== s.revision) {
      return { status: 'rejected', reason: `版本已过期：动作基于 revision ${opts.expectedRevision}，关卡已是 ${s.revision}` }
    }
    let actionId: string
    let action: NeedleAction
    if (typeof actionIdOrAction === 'string') {
      const found = { left: { type: 'move', dx: -1, dy: 0 }, right: { type: 'move', dx: 1, dy: 0 }, up: { type: 'move', dx: 0, dy: 1 }, down: { type: 'move', dx: 0, dy: -1 }, ccw: { type: 'rotate', dir: 1 }, cw: { type: 'rotate', dir: -1 } } as Record<string, NeedleAction>
      const a = found[actionIdOrAction]
      if (!a) return { status: 'rejected', reason: `未知动作 ${actionIdOrAction}` }
      actionId = actionIdOrAction
      action = a
    } else {
      action = actionIdOrAction
      actionId = action.type === 'rotate' ? (action.dir === 1 ? 'ccw' : 'cw') : action.dx === 1 ? 'right' : action.dx === -1 ? 'left' : action.dy === 1 ? 'up' : 'down'
    }
    const free = actor === 'restore' || actor === 'init'
    if (s.phase === 'won' && !free && actor !== 'agent') {
      return { status: 'rejected', reason: '已通关：按 R 重开新的一局' }
    }
    if (!free && s.budgetLeft <= 0) {
      return { status: 'rejected', reason: '动作预算用完：Z 撤销或 R 重开' }
    }

    const r = applyAction(s.model, s.state, action)
    const recordAndLog = async (outcome: Parameters<typeof recordMoveRun>[0]['outcome']) => {
      const run = await recordMoveRun({
        world: s.model,
        source: this.source(actionId, actor),
        actionId, action,
        from: r.status === 'rejected' ? s.state : r.from,
        outcome,
        certificate: r.status === 'rejected'
          ? { status: 'unknown', minClearance: NaN, intervals: 0, blockedAt: null, computeMs: 0 }
          : r.certificate,
        parentRunId: s.history.at(-1)?.runId,
      })
      return run
    }
    if (r.status === 'rejected') {
      this.patch({ blocked: [...s.blocked.slice(-7), { actionId, status: 'rejected', reason: r.reason, contact: null, at: Date.now() }] })
      this.note('warn', r.reason)
      return { status: 'rejected', reason: r.reason }
    }
    if (r.status === 'blocked' || r.status === 'unknown') {
      void recordAndLog(r.status === 'blocked' ? { status: 'blocked', attempted: r.attempted } : { status: 'unknown', attempted: r.attempted })
      const reason = r.status === 'blocked'
        ? `动作被阻止：整段检查在 ${r.certificate.blockedAt?.source ?? '途中'} 发生接触（净距 ${r.certificate.minClearance.toFixed(4)}），停在原处`
        : `无法认证这一段的整段安全（预算 ${r.certificate.intervals} 次二分后仍不确定）：保守拒绝，停在原处`
      this.patch({
        blocked: [...s.blocked.slice(-7), { actionId, status: r.status, reason, contact: r.certificate.blockedAt?.contact ?? null, attempted: r.attempted, at: Date.now() }],
        contact: r.certificate.blockedAt ? { point: r.certificate.blockedAt.contact, at: Date.now() } : s.contact,
      })
      this.note(r.status === 'blocked' ? 'warn' : 'error', reason)
      return { status: r.status, reason }
    }
    // accepted — the Run records while we await; if anything else moved the
    // world in between (a concurrent programmatic act/reset/world switch),
    // this receipt must NOT overwrite it (the Run stays recorded as evidence)
    const run = await recordAndLog({ status: 'accepted', to: r.to, goal: r.goal })
    const live = this.st
    if (live === null || live !== s || live.revision !== s.revision) {
      return { status: 'rejected', reason: `并发冲突：动作 ${actionId} 计算完成时世界已被更新，本次结果不应用；其 Run 已保留` }
    }
    const consumed = !free
    const budgetLeft = consumed ? s.budgetLeft - 1 : s.budgetLeft
    const step = s.history.length + 1
    const won = r.goal.contained && r.goal.oriented
    const next: NeedleSessionState = {
      ...s,
      revision: s.revision + 1,
      state: r.to,
      history: [...s.history, { actionId, from: r.from, to: r.to, runId: run.runId, at: Date.now() }],
      blocked: s.blocked,
      budgetLeft,
      // phase is recomputed from the CURRENT pose every accepted action: an
      // agent moving the needle back out of the exit returns to 'playing'
      phase: won ? 'won' : 'playing',
      wonAtStep: won && !free ? step : s.wonAtStep,
      notice: won
        ? { kind: 'success', text: `通关！第 ${step} 个接受动作让整根杆竖直进入出口（见证 Run ${run.runId.slice(-6)}）`, at: Date.now() }
        : s.notice,
      contact: s.contact,
      solve: s.solve,
      restored: s.restored,
    }
    this.st = next
    this.emit()
    if (consumed) this.autosave()
    return won ? { status: 'won' } : { status: 'accepted' }
  }

  /** undo the last accepted action: restore its from-state, refund budget */
  undo(): boolean {
    const s = this.st
    if (!s || s.history.length === 0) {
      if (s) this.note('info', '没有可撤销的动作')
      return false
    }
    const entry = s.history.at(-1)!
    // undo restores a previously CERTIFIED pose; its phase is recomputed from
    // the goal (undoing the winning move lands back on a winning pose)
    const goal = checkGoal(s.model, entry.from)
    const won = goal.contained && goal.oriented
    this.patch({
      state: entry.from,
      history: s.history.slice(0, -1),
      budgetLeft: Math.min(s.model.actionBudget, s.budgetLeft + 1),
      revision: s.revision + 1,
      phase: won ? 'won' : 'playing',
      wonAtStep: null,
      notice: { kind: 'info', text: `已撤销 ${entry.actionId}（回到第 ${s.history.length - 1} 步，预算返还${won ? '；该位形仍满足目标' : ''}）`, at: Date.now() },
    })
    return true
  }

  reset(): void {
    const s = this.st
    if (!s) return
    this.patch({
      sessionId: uid('nws'),
      state: { cx: s.model.start.x, cy: s.model.start.y, k: s.model.start.k },
      history: [],
      blocked: [],
      budgetLeft: s.model.actionBudget,
      revision: s.revision + 1,
      phase: 'playing',
      wonAtStep: null,
      contact: null,
      solve: null,
      restored: null,
      notice: { kind: 'info', text: '已重开：杆回到起点，动作预算恢复（世界规则不变；上一局的求解验证记录已清，Run 仍在历史中）', at: Date.now() },
    })
  }

  /** solver verification through the SAME transition; records a run */
  async solve(opts: { maxNodes?: number; timeMs?: number } = {}): Promise<SolveResult | null> {
    const s = this.st
    if (!s) return null
    const result = solveNeedle(s.model, { cx: s.model.start.x, cy: s.model.start.y, k: s.model.start.k }, opts)
    const run = await recordSolveRun({
      world: s.model,
      source: this.source('solve', 'user'),
      start: { cx: s.model.start.x, cy: s.model.start.y, k: s.model.start.k },
      result,
    })
    const text =
      result.status === 'solved'
        ? `求解器找到 ${result.path.length} 步见证并重放复核通过（认证净距 ${result.minCertifiedClearance.toFixed(4)}，访问 ${result.visited} 态）——你自己走一遍才算通关`
        : result.status === 'unsat-in-finite-graph'
          ? `在本有限动作图内无解（访问 ${result.visited} 态，无 unknown 边）——不能推广到连续平面`
          : `求解器返回 unknown（${result.reason === 'budget' ? '预算/超时' : `${result.unknownEdges} 条不确定边`}，访问 ${result.visited} 态）`
    this.patch({ solve: { result, runId: run.runId, at: Date.now() }, notice: { kind: result.status === 'solved' ? 'info' : 'warn', text, at: Date.now() } })
    return result
  }

  // ---- save / restore (replay-based; the file never grants a win) ----

  exportSave(): string {
    const s = this.st
    if (!s) throw new Error('没有加载关卡')
    return JSON.stringify({
      format: SAVE_FORMAT,
      savedAt: new Date().toISOString(),
      note: '本机保存文件：恢复时按动作清单经同一 transition 重放，文件中的通关标记仅供参考，不授予通关',
      world: s.world,
      worldDigest: s.worldDigest,
      actions: s.history.map((h) => h.actionId),
      budgetUsed: s.history.length,
      solved: s.phase === 'won',
    }, null, 2)
  }

  private autosave() {
    try {
      const s = this.st
      if (s) localStorage.setItem(LOCAL_KEY(s.world.id), this.exportSave())
    } catch { /* full/disabled storage — file save still works */ }
  }

  hasLocalSave(worldId: string): boolean {
    try { return !!localStorage.getItem(LOCAL_KEY(worldId)) } catch { return false }
  }

  async resumeLocal(worldId: string): Promise<{ ok: boolean; reason?: string }> {
    let text: string | null = null
    try { text = localStorage.getItem(LOCAL_KEY(worldId)) } catch { text = null }
    if (!text) return { ok: false, reason: '本机没有这个关卡的保存' }
    return this.importSave(text, 'local')
  }

  /** restore = replay the frozen action list through the SAME transition;
   *  phase/won are RECOMPUTED from the final state, never read from the file */
  async importSave(text: string, via: 'file' | 'local' = 'file'): Promise<{ ok: boolean; reason?: string }> {
    let file: { format?: string; world?: unknown; worldDigest?: string; actions?: unknown; solved?: boolean }
    try { file = JSON.parse(text) } catch { return { ok: false, reason: '不是合法 JSON' } }
    if (file.format !== SAVE_FORMAT) return { ok: false, reason: `保存格式不是 ${SAVE_FORMAT}` }
    const v = validateNeedleWorld(file.world)
    if (!v.ok) return { ok: false, reason: `保存里的世界定义无效：${v.errors.join('；')}` }
    if (planInputDigest(v.world as unknown as Record<string, unknown>) !== file.worldDigest) {
      return { ok: false, reason: '关卡定义与保存的修订摘要不符（文件被改动过），拒绝恢复' }
    }
    // validate the action list BEFORE activating: a malformed file must not
    // reset an in-progress attempt (import failure leaves the live game alone)
    if (!Array.isArray(file.actions) || file.actions.some((a) => typeof a !== 'string')) {
      return { ok: false, reason: '动作清单必须是动作 id 数组' }
    }
    const act = this.activate(v.world, via === 'file' ? 'file' : 'catalog')
    if (!act.ok) return { ok: false, reason: act.errors.join('；') }
    this.patch({ restored: via })
    let applied = 0
    for (const id of file.actions as string[]) {
      const r = await this.act(id, { actor: 'restore' })
      if (r.status === 'won' || r.status === 'accepted') { applied++; continue }
      // stop at the last legal state — the file's tail is not executable
      this.note('warn', `恢复在第 ${applied + 1} 个动作停止（${r.reason ?? r.status}），停在其最后合法状态`)
      break
    }
    const s = this.st!
    const goal = checkGoal(s.model, s.state)
    this.patch({
      // recompute, never trust: goal decides phase after replay; budget must
      // match the replayed history (restore actions themselves are free)
      budgetLeft: Math.max(0, s.model.actionBudget - s.history.length),
      phase: goal.contained && goal.oriented ? 'won' : 'playing',
      notice: {
        kind: goal.contained && goal.oriented ? 'success' : 'info',
        text: `已从${via === 'file' ? '本机文件' : '浏览器本机存储'}恢复 ${applied} 个动作（经同一 transition 重放并产生新 Run）；文件中的通关标记不参与判定${goal.contained && goal.oriented ? '；重放终态确实满足目标' : ''}`,
        at: Date.now(),
      },
    })
    return { ok: true }
  }

  /** solve an arbitrary validated model (level editor's 验证有解) without
   *  touching the live session — same transition, same structured result */
  solveFor(model: NeedleModel, opts: { maxNodes?: number; timeMs?: number } = {}): SolveResult {
    return solveNeedle(model, { cx: model.start.x, cy: model.start.y, k: model.start.k }, opts)
  }

  /** surface a UI-only message (e.g. replay-verification result) — no state change */
  noteText(text: string): void {
    this.note('info', text)
  }

  /** replay the current history from the start (verify-your-own-path button) */
  verifyOwnPath(): { verified: boolean; text: string } {
    const s = this.st
    if (!s) return { verified: false, text: '没有加载关卡' }
    const path = s.history.map((h) => h.actionId)
    if (path.length === 0) return { verified: false, text: '还没有已接受的动作' }
    const r = replayPath(s.model, { cx: s.model.start.x, cy: s.model.start.y, k: s.model.start.k }, path)
    if (r.status === 'invalid') return { verified: false, text: `第 ${r.step + 1} 步（${r.actionId}）在重放中非法：${r.reason}` }
    const goal = checkGoal(s.model, r.finalState)
    return {
      verified: true,
      text: `${path.length} 步路径重放复核通过，终态 ${stateKey(r.finalState)}，整段最小认证净距 ${r.minClearance.toFixed(4)}；当前${goal.contained && goal.oriented ? '满足' : '不满足'}目标`,
    }
  }
}
