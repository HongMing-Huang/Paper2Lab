// MathWorld Host (CLI-129) — the ONE action entry the page and any future
// agent share. It owns gameplay state only (revision, attempts, budget,
// phase); scientific numbers live in ExperimentRuns produced by the unified
// executor and are referenced by runId, never copied into a second store.
//
// Action pipeline (PLAN §2 玩家链, browser-local profile):
//   intent → validate (operable symbol, finite, inside domain, revision)
//   → executeSkill under a registered PlayPlan (real Cortex / RK4 kernels)
//   → generation check (an older receipt can never overwrite a newer world)
//   → independent Goal evaluation over the frozen runs
//   → one atomic session update (state + attempt + assessment)
// Preview (drag) uses the same compiled expression on a coarse grid and is
// never scored. This is a local exploration host, not server authority.
import { executeSkill, type SkillOutcome } from '../skills/executor'
import { planInputDigest, registerPlan } from '../skills/playPlan'
import { getSkill } from '../skills/registry'
import { exportExperimentRuns, getExperimentRun, type ExperimentRun } from '../experiments/protocol'
import type { Assessment, FormulaModel, KakeyaModel, OdeModel, WorldDefinition } from './definition'
import { evaluateGoal, fmt, type Evidence } from './goal'
import {
  compileFormulaExpression,
  compileOdeSystem,
  integratePreview,
  inverseSolve,
  kakeyaOffsetArray,
  kakeyaClusterBox,
  kakeyaPreview,
  sampleCurve,
  type CompiledExpression,
  type CompiledSystem,
} from './kernels'
import { validateWorld } from './validate'

export type Phase = 'playing' | 'won' | 'lost'
/** init = opening observation, restore = recompute after loading a save:
 *  both are real runs that neither consume attempts nor decide the game */
export type Actor = 'user' | 'agent' | 'restore' | 'init'

export interface AttemptRecord {
  /** consumed-attempt number (null when the attempt did not consume budget) */
  seq: number | null
  generation: number
  actor: Actor
  params: Record<string, number>
  status: 'committed' | 'superseded' | 'failed'
  runIds: string[]
  assessment: Assessment | null
  /** the frozen evidence backing the assessment (undo restores from this) */
  evidence?: Evidence
  /** review m2: undo-appended restore records are excluded from undo history
   *  so repeated undo walks BACK through real attempts instead of ping-ponging
   *  between the last two states */
  fromUndo?: boolean
  error?: string
  consumed: boolean
  exploration: boolean
  at: number
  /** true when the record came from a saved file (history only, not recomputed) */
  fromFile?: boolean
}

export interface Notice { kind: 'info' | 'warn' | 'error' | 'success'; text: string; at: number }

export interface Session {
  world: WorldDefinition
  worldDigest: string
  origin: 'catalog' | 'edited' | 'file'
  planIds: string[]
  compileRunId: string | null
  sessionId: string
  revision: number
  /** last LEGAL committed values of every tunable symbol */
  params: Record<string, number>
  committed: { generation: number; params: Record<string, number>; evidence: Evidence; assessment: Assessment } | null
  attempts: AttemptRecord[]
  budgetLeft: number
  phase: Phase
  wonAtSeq: number | null
  pending: { generation: number; params: Record<string, number> } | null
  notice: Notice | null
  restored: 'file' | 'local' | null
}

export interface PreviewState {
  token: number
  params: Record<string, number>
  curve?: Array<[number, number]>
  traj?: { t: number[]; series: number[][] }
  /** kakeya: coarse same-kernel estimate for the dragged layout (not scored) */
  kakeya?: { occupiedVolume: number; maxMultiplicity: number }
  /** drag diagnostic shown next to the handle (no-solution / ill-conditioned / branch) */
  diagnostic?: string
  /** the previewed parameters produce a non-finite curve/trajectory */
  invalid?: string
}

export interface CatalogEntry { file: string; world?: WorldDefinition; errors?: string[] }

export type CommitResult =
  | { status: 'committed'; generation: number; assessment: Assessment; runIds: string[] }
  | { status: 'rejected'; reason: string }
  | { status: 'superseded'; generation: number }
  | { status: 'failed'; reason: string; runIds: string[] }

const PREVIEW_SAMPLES = 161
const SAVE_FORMAT = 'paper2lab.mathworld.save/v1'
const LOCAL_KEY = (worldId: string) => `paper2lab.mathworld.v1.${worldId}`

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** every tunable symbol of a model: params + operable initial states + kakeya cluster offsets */
export interface Tunable { name: string; label: string; min: number; max: number; step: number; operable: boolean; role: 'param' | 'initial' | 'cluster' }

export function tunables(world: WorldDefinition): Tunable[] {
  const m = world.model
  if (m.kind === 'kakeya') {
    const out: Tunable[] = []
    for (const c of m.clusters) {
      if (c.operable === false) continue
      const box = kakeyaClusterBox(m, c.id)
      if (!box) continue // validator already refused such worlds
      for (const axis of ['x', 'y', 'z'] as const) {
        out.push({
          name: `${c.id}.${axis}`, label: `${c.label ?? c.id}·${axis}`,
          min: box.min[axis], max: box.max[axis],
          step: (box.max[axis] - box.min[axis]) / 40, operable: true, role: 'cluster',
        })
      }
    }
    return out
  }
  const out: Tunable[] = m.params.map((p) => ({
    name: p.name, label: p.label ?? p.name, min: p.min, max: p.max,
    step: p.step ?? (p.max - p.min) / 200, operable: p.operable, role: 'param' as const,
  }))
  if (m.kind === 'ode') {
    for (const s of m.states) {
      if (s.operable) out.push({ name: s.name, label: `${s.label ?? s.name}(t₀)`, min: s.min!, max: s.max!, step: (s.max! - s.min!) / 200, operable: true, role: 'initial' as const })
    }
  }
  return out
}

export function initialValues(world: WorldDefinition): Record<string, number> {
  const m = world.model
  if (m.kind === 'kakeya') {
    const v: Record<string, number> = {}
    for (const c of m.clusters) {
      const o = c.offset ?? { x: 0, y: 0, z: 0 }
      v[`${c.id}.x`] = o.x
      v[`${c.id}.y`] = o.y
      v[`${c.id}.z`] = o.z
    }
    return v
  }
  const v: Record<string, number> = Object.fromEntries(m.params.map((p) => [p.name, p.initial]))
  if (m.kind === 'ode') for (const s of m.states) if (s.operable) v[s.name] = s.initial
  return v
}

/** split a tunable map into the ODE's (params, initialState) inputs */
export function odeInputs(model: OdeModel, values: Record<string, number>) {
  const params = Object.fromEntries(model.params.map((p) => [p.name, values[p.name] ?? p.initial]))
  const initialState = Object.fromEntries(model.states.map((s) => [s.name, s.operable ? values[s.name] ?? s.initial : s.initial]))
  return { params, initialState }
}

class MathWorldHost {
  private session: Session | null = null
  private pv: PreviewState | null = null
  private listeners = new Set<() => void>()
  private previewListeners = new Set<() => void>()
  private generation = 0
  private previewToken = 0
  /** activation epoch (CLI-129 race fix): every await in activate() re-checks
   *  it before touching session/compiled state — a slow OLD activation can
   *  never overwrite a newer world the user already switched to */
  private activationEpoch = 0
  private compiledFormula: CompiledExpression | null = null
  private compiledSystem: CompiledSystem | null = null
  catalog: CatalogEntry[] = []

  // ---- subscriptions (useSyncExternalStore) ----
  subscribe = (cb: () => void) => { this.listeners.add(cb); return () => { this.listeners.delete(cb) } }
  subscribePreview = (cb: () => void) => { this.previewListeners.add(cb); return () => { this.previewListeners.delete(cb) } }
  getSession = () => this.session
  getPreview = () => this.pv
  private emit() { for (const cb of this.listeners) cb() }
  private emitPreview() { for (const cb of this.previewListeners) cb() }
  private patch(next: Partial<Session>) {
    if (!this.session) return
    this.session = { ...this.session, ...next }
    this.emit()
  }
  private note(kind: Notice['kind'], text: string) {
    this.patch({ notice: { kind, text, at: Date.now() } })
  }

  // ---- catalog ----
  async loadCatalog(base = '/assets/mathworld/worlds/'): Promise<CatalogEntry[]> {
    const index = await fetch(`${base}index.json`).then((r) => {
      if (!r.ok) throw new Error(`世界清单读取失败 HTTP ${r.status}`)
      return r.json() as Promise<{ worlds: string[] }>
    })
    const entries: CatalogEntry[] = []
    for (const file of index.worlds) {
      try {
        const raw = await fetch(`${base}${file}`).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json()
        })
        const v = validateWorld(raw)
        entries.push(v.ok ? { file, world: v.world } : { file, errors: [...v.errors, ...v.unsupported] })
      } catch (err) {
        entries.push({ file, errors: [`读取失败：${err instanceof Error ? err.message : String(err)}`] })
      }
    }
    this.catalog = entries
    return entries
  }

  // ---- world activation ----
  /** validate → register PlayPlans → (ode) real model.build compile run → fresh session */
  async activate(raw: unknown, origin: Session['origin']): Promise<{ ok: true } | { ok: false; errors: string[] }> {
    const v = validateWorld(raw)
    if (!v.ok) return { ok: false, errors: [...v.errors, ...v.unsupported.map((u) => `不支持：${u}`)] }
    const world = structuredClone(v.world)
    const worldDigest = planInputDigest(world as unknown as Record<string, unknown>)
    const short = worldDigest.slice(7, 19)
    const planIds: string[] = []
    let compileRunId: string | null = null
    const activation = ++this.activationEpoch
    const stale = () => activation !== this.activationEpoch
    this.generation++ // any in-flight commit of the previous world is now stale
    this.setPreview(null)
    try {
      if (world.model.kind === 'formula') {
        const m = world.model
        const compiledFormula = compileFormulaExpression(m.expression)
        if (stale()) return { ok: false, errors: ['已切换到别的世界，放弃本次激活'] }
        this.compiledFormula = compiledFormula
        this.compiledSystem = null
        planIds.push(this.plan(world, short, 'formula.plot', { expression: m.expression, parameters: m.params.map((p) => p.name), independent: m.independent, range: m.range, samples: m.samples }))
        planIds.push(this.plan(world, short, 'formula.evaluate', { expression: m.expression }))
      } else if (world.model.kind === 'kakeya') {
        const m = world.model
        if (stale()) return { ok: false, errors: ['已切换到别的世界，放弃本次激活'] }
        this.compiledFormula = null
        this.compiledSystem = null
        // one plan governs the whole family; res/offsets are per-action inputs
        planIds.push(this.plan(world, short, 'kakeya.measure', { deltaExp: m.deltaExp, nTubes: m.nTubes, packing: m.packing }))
      } else {
        const m = world.model
        const compiledSystem = compileOdeSystem(m.states.map((s) => s.name), m.rhs, m.params.map((p) => p.name))
        if (stale()) return { ok: false, errors: ['已切换到别的世界，放弃本次激活'] }
        this.compiledSystem = compiledSystem
        this.compiledFormula = null
        const states = m.states.map((s) => s.name)
        planIds.push(this.plan(world, short, 'model.solve', { states, rhs: m.rhs, tSpan: m.tSpan }))
        const buildPlan = this.plan(world, short, 'model.build', { states, rhs: m.rhs })
        planIds.push(buildPlan)
        const { params, initialState } = odeInputs(m, initialValues(world))
        // the formal compile check: the registered model.build kernel compiles
        // every right-hand side and verifies it is finite at the initial state
        const built = await executeSkill('model.build', { states, rhs: m.rhs, params, initialState }, {
          planId: buildPlan,
          source: this.source(world, worldDigest, 'activate', 0, 'user'),
        })
        if (stale()) return { ok: false, errors: ['已切换到别的世界，放弃本次激活'] }
        if (built.status !== 'ok' || !built.run) return { ok: false, errors: [`model.build 编译检查失败：${outcomeMessage(built)}`] }
        const free = (built.run.result as { freeParams?: string[] }).freeParams ?? []
        if (free.length) return { ok: false, errors: [`不支持：model.build 报告未绑定符号 ${free.join(', ')}（只支持自主系统、全部常数需声明）`] }
        compileRunId = built.run.runId
      }
    } catch (err) {
      return { ok: false, errors: [err instanceof Error ? err.message : String(err)] }
    }
    this.session = {
      world, worldDigest, origin, planIds, compileRunId,
      sessionId: uid('mws'),
      revision: 0,
      params: initialValues(world),
      committed: null,
      attempts: [],
      budgetLeft: world.goal.attempts,
      phase: 'playing',
      wonAtSeq: null,
      pending: null,
      notice: null,
      restored: null,
    }
    this.emit()
    // opening observation: the starting configuration is computed for real,
    // so the player sees WHY it does not meet the goal yet (no attempt used)
    const opening = await this.commit({}, { actor: 'init' })
    if (stale()) return { ok: false, errors: ['已切换到别的世界，放弃本次激活'] }
    if (opening.status === 'failed') this.note('error', `开局计算失败：${opening.reason}`)
    return { ok: true }
  }

  /** presentation helper: where a curve handle sits for the given values */
  evalFormulaAt(values: Record<string, number>, x: number): number | null {
    const s = this.session
    if (!s || s.world.model.kind !== 'formula' || !this.compiledFormula) return null
    const y = this.compiledFormula.run({ ...values, [s.world.model.independent]: x })
    return Number.isFinite(y) ? y : null
  }

  private plan(world: WorldDefinition, short: string, skill: string, inputs: Record<string, unknown>): string {
    const planId = `mw-${world.id}-${short}-${skill}`
    const m = world.model
    const variables = m.kind === 'kakeya'
      ? m.clusters.filter((c) => c.operable !== false).map((c) => ({ name: c.id, role: 'parameter' as const, confirmed: false }))
      : m.params.map((p) => ({ name: p.name, role: 'parameter' as const, confirmed: false }))
    registerPlan({
      planId,
      goal: world.objective,
      source: { docId: `mathworld:${world.id}`, title: world.title },
      variables,
      assumptions: [
        world.origin.kind === 'dev-sample' ? '开发样例：手写教科书方程，不是 PDF 解析、不是 Qwen 生成' : '用户在页面编辑的世界定义，未经来源确认',
        '闸门/阈值/预算是游戏政策，不是论文结论',
      ],
      skill,
      skillVersion: getSkill(skill)?.version ?? '?',
      renderer: 'r3f',
      metrics: skill === 'formula.plot' ? ['points', 'peak', 'integral'] : skill === 'formula.evaluate' ? ['value'] : skill === 'model.solve' ? ['series', 'perState'] : skill === 'kakeya.measure' ? ['occupiedVolume', 'maxMultiplicity'] : ['verifiedAt', 'freeParams'],
      inputs,
      evidenceBasis: m.kind === 'kakeya'
        ? '浏览器内注册内核真实计算（δ-管族 + 体素测量，同 src/kakeya 核），CALCULATED；目标判定为本地 Host'
        : '浏览器内注册内核真实计算（Cortex 编译 / 定步长 RK4），CALCULATED；目标判定为本地 Host',
      successCriteria: '每次正式提交产生绑定当前参数的 Run，独立 Goal 逐约束判定',
      nonClaims: ['不得声称证明了任何定理（有限采样 / 定步长数值实验）', '开发样例不代表任何论文的模型或结论'],
      createdAt: Date.now(),
    })
    return planId
  }

  private source(world: WorldDefinition, worldDigest: string, action: string, generation: number, actor: Actor) {
    return {
      kind: world.origin.kind === 'dev-sample' ? 'mathworld-dev-sample' : 'mathworld-edited',
      worldId: world.id,
      worldDigest,
      sessionId: this.session?.sessionId ?? null,
      action,
      generation,
      actor,
    }
  }

  // ---- validation of a player/agent patch (ControlPolicy) ----
  private checkPatch(patch: Record<string, number>): string | null {
    const s = this.session
    if (!s) return '没有加载世界'
    const tun = tunables(s.world)
    for (const [k, v] of Object.entries(patch)) {
      const t = tun.find((x) => x.name === k)
      if (!t) return `${k} 不是这个世界的可调符号`
      if (!t.operable) return `${t.label} 是场景条件，不可操作`
      if (typeof v !== 'number' || !Number.isFinite(v)) return `${t.label} 必须是有限数`
      if (v < t.min || v > t.max) return `越出定义域：${t.label} = ${fmt(v)} 不在 [${fmt(t.min)}, ${fmt(t.max)}]，保持最后合法值`
    }
    return null
  }

  // ---- preview (presentation only, never scored) ----
  private setPreview(p: PreviewState | null) {
    this.pv = p
    this.emitPreview()
  }

  preview(patch: Record<string, number>, diagnostic?: string): { ok: boolean; reason?: string } {
    const s = this.session
    if (!s) return { ok: false, reason: '没有加载世界' }
    this.exitReplayIfActive()
    const bad = this.checkPatch(patch)
    if (bad) {
      if (this.pv) this.setPreview({ ...this.pv, diagnostic: bad })
      return { ok: false, reason: bad }
    }
    const params = { ...(this.pv?.params ?? s.params), ...patch }
    const token = ++this.previewToken
    const m = s.world.model
    if (m.kind === 'formula') {
      const curve = sampleCurve(this.compiledFormula!, params, m.independent, m.range, PREVIEW_SAMPLES)
      if (!curve) {
        this.setPreview({ token, params: this.pv?.params ?? s.params, curve: this.pv?.curve, diagnostic, invalid: '这组参数让曲线出现非有限值（奇点），不能提交' })
        return { ok: false, reason: 'non-finite' }
      }
      this.setPreview({ token, params, curve, diagnostic })
    } else if (m.kind === 'kakeya') {
      // same canonical chain as the formal run, coarse grid, presentation only
      let kakeya: PreviewState['kakeya']
      try {
        kakeya = kakeyaPreview(m, this.clusterOffsets(m, params), 22)
      } catch (err) {
        this.setPreview({ token, params: this.pv?.params ?? s.params, kakeya: this.pv?.kakeya, diagnostic, invalid: err instanceof Error ? err.message : String(err) })
        return { ok: false, reason: 'outside-scoring-box' }
      }
      this.setPreview({ token, params, kakeya, diagnostic })
    } else {
      const { params: pv, initialState } = odeInputs(m, params)
      const traj = integratePreview(this.compiledSystem!, pv, m.states.map((st) => initialState[st.name]), m.tSpan, Math.max(240, Math.round(m.steps / 4)))
      if (!traj) {
        this.setPreview({ token, params: this.pv?.params ?? s.params, traj: this.pv?.traj, diagnostic, invalid: '这组参数让轨迹发散，不能提交' })
        return { ok: false, reason: 'diverged' }
      }
      this.setPreview({ token, params, traj, diagnostic })
    }
    return { ok: true }
  }

  /** cluster id → offset from a frozen params map */
  private clusterOffsets(m: KakeyaModel, params: Record<string, number>): Record<string, { x: number; y: number; z: number }> {
    const out: Record<string, { x: number; y: number; z: number }> = {}
    for (const c of m.clusters) out[c.id] = { x: params[`${c.id}.x`] ?? 0, y: params[`${c.id}.y`] ?? 0, z: params[`${c.id}.z`] ?? 0 }
    return out
  }

  /** drag a whole tube cluster by world-space deltas (cube coords): preview the
   *  clamped result — directions/lengths/radii never move, only the cluster's
   *  offset inside its admissible box */
  dragCluster(controlId: string, dx: number, dy: number, dz: number): { ok: boolean; reason?: string } {
    const s = this.session
    if (!s || s.world.model.kind !== 'kakeya') return { ok: false, reason: '当前世界没有管簇控制' }
    const m = s.world.model
    const c = s.world.controls.find((x) => x.id === controlId)
    if (!c || c.kind !== 'cluster-drag') return { ok: false, reason: `未知控制 ${controlId}` }
    const cluster = m.clusters.find((q) => q.id === c.cluster)
    if (!cluster || cluster.operable === false) return { ok: false, reason: `簇 ${c.cluster} 不可拖动` }
    const base = this.pv?.params ?? s.params
    const patch: Record<string, number> = {
      [`${cluster.id}.x`]: (base[`${cluster.id}.x`] ?? 0) + dx,
      [`${cluster.id}.y`]: (base[`${cluster.id}.y`] ?? 0) + dy,
      [`${cluster.id}.z`]: (base[`${cluster.id}.z`] ?? 0) + dz,
    }
    // clamp into the admissible box so a drag shows the extreme legal position
    // instead of an error (the player FEELS the wall of the scoring domain).
    // review m1: round-THEN-clamp — clamping first and rounding after can push
    // the value back outside the box by up to 5e-5, turning the wall into a
    // spurious "越出定义域" rejection and making the exact wall unreachable.
    const box = kakeyaClusterBox(m, cluster.id)
    let clamped = false
    if (box) {
      for (const axis of ['x', 'y', 'z'] as const) {
        const key = `${cluster.id}.${axis}`
        const v = Number(patch[key].toFixed(4))
        const c = Math.min(box.max[axis], Math.max(box.min[axis], v))
        if (c !== patch[key]) clamped = true
        patch[key] = c
      }
    }
    return this.preview(patch, clamped ? '已到计分域边界（管不能移出 [0,1]³ 测量盒）' : undefined)
  }

  endPreview() { this.setPreview(null) }

  /** a curve-handle drag: invert ONE parameter on its current branch */
  dragCurveHandle(controlId: string, targetY: number): { ok: boolean; reason?: string } {
    const s = this.session
    if (!s || s.world.model.kind !== 'formula') return { ok: false, reason: '当前世界没有曲线控制点' }
    const m: FormulaModel = s.world.model
    const c = s.world.controls.find((x) => x.id === controlId)
    if (!c || c.kind !== 'curve-handle') return { ok: false, reason: `未知控制点 ${controlId}` }
    const p = m.params.find((q) => q.name === c.param)!
    const base = this.pv?.params ?? s.params
    const g = (v: number) => this.compiledFormula!.run({ ...base, [c.param]: v, [m.independent]: c.atX })
    const res = inverseSolve(g, targetY, base[c.param], p.min, p.max)
    const at = `${m.output}(${fmt(c.atX)})`
    if (res.status === 'no-solution') {
      const why = res.reachable
        ? `无解：在定义域 [${fmt(p.min)}, ${fmt(p.max)}] 内调 ${p.name} 只能让 ${at} 落在 [${fmt(res.reachable[0])}, ${fmt(res.reachable[1])}]，到不了 ${fmt(targetY)}；保持最后合法值`
        : `无解：${at} 在 ${p.name} 的定义域内处处非有限；保持最后合法值`
      this.setPreview(this.pv ? { ...this.pv, diagnostic: why } : { token: ++this.previewToken, params: base, diagnostic: why })
      return { ok: false, reason: why }
    }
    if (res.status === 'ill-conditioned') {
      const why = `病态：${at} 几乎不随 ${p.name} 变化（∂${m.output}/∂${p.name} ≈ ${fmt(res.sensitivity)}），这个点反解不出 ${p.name}；先改别的参数或换控制点，保持最后合法值`
      this.setPreview(this.pv ? { ...this.pv, diagnostic: why } : { token: ++this.previewToken, params: base, diagnostic: why })
      return { ok: false, reason: why }
    }
    const scale = Math.max(1, Math.abs(targetY))
    if (res.residual > 1e-7 * scale) {
      const why = `反解残差 ${fmt(res.residual)} 超限，拒绝；保持最后合法值`
      this.setPreview(this.pv ? { ...this.pv, diagnostic: why } : { token: ++this.previewToken, params: base, diagnostic: why })
      return { ok: false, reason: why }
    }
    const branchNote = res.branches > 1 ? `${p.name} 有 ${res.branches} 个解，沿当前连续分支取 ${fmt(res.value)}` : undefined
    return this.preview({ [c.param]: res.value }, branchNote)
  }

  /** an initial-point drag (ode): direct control of two operable initial states, clamped to their domains */
  dragInitialPoint(controlId: string, a: number, b: number): { ok: boolean; reason?: string } {
    const s = this.session
    if (!s || s.world.model.kind !== 'ode') return { ok: false, reason: '当前世界没有初值控制点' }
    const m = s.world.model
    const c = s.world.controls.find((x) => x.id === controlId)
    if (!c || c.kind !== 'initial-point') return { ok: false, reason: `未知控制点 ${controlId}` }
    const patch: Record<string, number> = {}
    let clamped = false
    ;[a, b].forEach((v, i) => {
      const st = m.states.find((q) => q.name === c.states[i])!
      const lo = st.min!
      const hi = st.max!
      const cv = Math.min(hi, Math.max(lo, v))
      if (cv !== v) clamped = true
      patch[st.name] = cv
    })
    return this.preview(patch, clamped ? '已到初值定义域边界（钳制在合法范围内）' : undefined)
  }

  /** release of a drag: formally commit what the preview shows */
  async commitPreview(actor: Actor = 'user'): Promise<CommitResult | null> {
    const s = this.session
    const p = this.pv
    if (!s || !p) return null
    if (p.invalid) {
      this.setPreview(null)
      this.note('warn', `${p.invalid}；已回到最后合法状态`)
      return { status: 'rejected', reason: p.invalid }
    }
    const patch: Record<string, number> = {}
    for (const [k, v] of Object.entries(p.params)) if (s.params[k] !== v) patch[k] = v
    if (Object.keys(patch).length === 0) {
      this.setPreview(null)
      return null
    }
    const res = await this.commit(patch, { expectedRevision: s.revision, actor })
    return res
  }

  // ---- the formal action ----
  async commit(patch: Record<string, number>, opts: { expectedRevision?: number; actor?: Actor } = {}): Promise<CommitResult> {
    const s = this.session
    const actor = opts.actor ?? 'user'
    if (!s) return { status: 'rejected', reason: '没有加载世界' }
    this.exitReplayIfActive()
    const reject = (reason: string): CommitResult => {
      this.setPreview(null)
      this.note('warn', reason)
      return { status: 'rejected', reason }
    }
    if (opts.expectedRevision !== undefined && opts.expectedRevision !== s.revision) {
      return reject(`版本已过期：动作基于 revision ${opts.expectedRevision}，世界已是 ${s.revision}，拒绝`)
    }
    const bad = this.checkPatch(patch)
    if (bad) return reject(bad)
    const free = actor === 'restore' || actor === 'init'
    if (s.phase === 'lost' && !free) return reject('尝试次数已用完：请重置后再挑战')
    const exploration = (s.world.goal.mode === 'explore' || s.phase === 'won') && !free
    if (!exploration && !free && s.budgetLeft <= 0) return reject('尝试次数已用完：请重置后再挑战')

    const params = { ...s.params, ...patch }
    const generation = ++this.generation
    const sessionId = s.sessionId
    const world = s.world
    this.patch({ pending: { generation, params } })

    const runIds: string[] = []
    let evidence: Evidence
    let failure: string | null = null
    try {
      const src = this.source(world, s.worldDigest, 'commit', generation, actor)
      if (world.model.kind === 'kakeya') {
        const m = world.model
        const offsets = kakeyaOffsetArray(m, this.clusterOffsets(m, params))
        const base = { deltaExp: m.deltaExp, nTubes: m.nTubes, packing: m.packing, length: m.length, offsets }
        const measure = await executeSkill('kakeya.measure', { ...base, res: m.res }, { planId: s.planIds[0], source: src })
        const measureRun = keepRun(measure, runIds)
        if (measure.status !== 'ok' || !measureRun) throw new KernelFailure(outcomeMessage(measure))
        const refine = await executeSkill('kakeya.measure', { ...base, res: m.refineRes }, { planId: s.planIds[0], source: src })
        const refineRun = keepRun(refine, runIds)
        if (refine.status !== 'ok' || !refineRun) throw new KernelFailure(`加密对照：${outcomeMessage(refine)}`)
        evidence = { kind: 'kakeya', measureRunId: measureRun.runId, refineRunId: refineRun.runId }
      } else if (world.model.kind === 'formula') {
        const m = world.model
        const curve = await executeSkill('formula.plot', {
          expression: m.expression,
          parameters: m.params.map((p) => p.name),
          independent: m.independent,
          range: m.range,
          samples: m.samples,
          values: Object.fromEntries(m.params.map((p) => [p.name, params[p.name]])),
        }, { planId: s.planIds[0], source: src })
        const curveRun = keepRun(curve, runIds)
        if (curve.status !== 'ok' || !curveRun) throw new KernelFailure(outcomeMessage(curve))
        const gateRunIds: Record<string, string> = {}
        for (const k of world.goal.constraints) {
          if (k.kind !== 'gate') continue
          const out = await executeSkill('formula.evaluate', {
            expression: m.expression,
            bindings: { ...Object.fromEntries(m.params.map((p) => [p.name, params[p.name]])), [m.independent]: k.x },
          }, { planId: s.planIds[1], source: src })
          const gateRun = keepRun(out, runIds)
          if (out.status !== 'ok' || !gateRun) throw new KernelFailure(`${k.label ?? k.id}：${outcomeMessage(out)}`)
          gateRunIds[k.id] = gateRun.runId
        }
        evidence = { kind: 'formula', curveRunId: curveRun.runId, gateRunIds }
      } else {
        const m = world.model
        const { params: pv, initialState } = odeInputs(m, params)
        const input = { states: m.states.map((st) => st.name), rhs: m.rhs, params: pv, initialState, tSpan: m.tSpan, steps: m.steps }
        const solve = await executeSkill('model.solve', input, { planId: s.planIds[0], source: src })
        const solveRun = keepRun(solve, runIds)
        if (solve.status !== 'ok' || !solveRun) throw new KernelFailure(outcomeMessage(solve))
        const refine = await executeSkill('model.solve', { ...input, steps: m.steps * 2 }, { planId: s.planIds[0], source: src })
        const refineRun = keepRun(refine, runIds)
        if (refine.status !== 'ok' || !refineRun) throw new KernelFailure(`加密对照：${outcomeMessage(refine)}`)
        evidence = { kind: 'ode', solveRunId: solveRun.runId, refineRunId: refineRun.runId }
      }
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err)
      evidence = undefined as unknown as Evidence
    }

    // a newer action, reset or world switch happened while computing: this
    // receipt must not touch the world (the runs stay in the Run record)
    const now = this.session
    if (!now || now.sessionId !== sessionId || generation !== this.generation) {
      if (now && now.sessionId === sessionId) {
        this.patch({
          attempts: [...now.attempts, { seq: null, generation, actor, params, status: 'superseded', runIds, assessment: null, consumed: false, exploration, at: Date.now() }],
        })
      }
      return { status: 'superseded', generation }
    }

    if (failure !== null) {
      this.setPreview(null)
      this.patch({
        pending: null,
        attempts: [...now.attempts, { seq: null, generation, actor, params, status: 'failed', runIds, assessment: null, error: failure, consumed: false, exploration, at: Date.now() }],
        notice: { kind: 'error', text: `计算失败（不扣尝试，世界保持最后合法状态）：${failure}`, at: Date.now() },
      })
      return { status: 'failed', reason: failure, runIds }
    }

    const m = world.model
    const initial = m.kind === 'ode' ? odeInputs(m, params).initialState : {}
    const goalParams = m.kind === 'ode'
      ? odeInputs(m, params).params
      : m.kind === 'kakeya'
        ? params // kakeya tunables ARE the cluster offsets the goal rebinds
        : Object.fromEntries(m.params.map((p) => [p.name, params[p.name]]))
    let assessment = evaluateGoal(world, goalParams, initial, evidence)
    if (world.goal.mode === 'explore' && assessment.outcome === 'success') {
      assessment = { ...assessment, outcome: 'unknown', summary: '已按当前条件真实计算。这是自由探索，没有通关或失败判定。' }
    }
    const counted = !exploration && !free
    const consumes = counted && (assessment.outcome === 'success' || assessment.outcome === 'fail')
    const seq = consumes ? world.goal.attempts - now.budgetLeft + 1 : null
    const budgetLeft = consumes ? now.budgetLeft - 1 : now.budgetLeft
    let phase: Phase = now.phase
    let wonAtSeq = now.wonAtSeq
    if (counted && assessment.outcome === 'success') {
      phase = 'won'
      wonAtSeq = seq
    } else if (counted && budgetLeft <= 0 && phase === 'playing') {
      phase = 'lost'
    }
    const record: AttemptRecord = { seq, generation, actor, params, status: 'committed', runIds, assessment, evidence, consumed: consumes, exploration, at: Date.now() }
    const prefix = actor === 'init' ? '开局观察（不扣次数）：' : actor === 'restore' ? '恢复重算（不扣次数）：' : ''
    const notice: Notice = assessment.outcome === 'success'
      ? { kind: 'success', text: exploration ? '探索：这组参数也满足全部约束（通关后不计分）' : free ? `${prefix}${assessment.summary}` : `通关！第 ${seq ?? '—'} 次正式尝试满足全部约束`, at: Date.now() }
      : assessment.outcome === 'invalid'
        ? { kind: 'error', text: `${prefix}${assessment.summary}`, at: Date.now() }
        : phase === 'lost' && counted
          ? { kind: 'error', text: `尝试次数用完，挑战失败：${assessment.summary}。可以重置再来`, at: Date.now() }
          : { kind: assessment.outcome === 'unknown' ? 'warn' : 'info', text: `${prefix}${assessment.summary}`, at: Date.now() }
    // one atomic update: world state + attempt + assessment + budget together
    this.setPreview(null)
    this.session = {
      ...now,
      revision: now.revision + 1,
      params,
      committed: { generation, params, evidence, assessment },
      attempts: [...now.attempts, record],
      budgetLeft,
      phase,
      wonAtSeq,
      pending: null,
      notice,
    }
    this.emit()
    this.autosave()
    return { status: 'committed', generation, assessment, runIds }
  }

  /** new attempt session on the same world: initial values, full budget */
  async reset(): Promise<void> {
    const s = this.session
    if (!s) return
    this.generation++
    this.setPreview(null)
    this.replayIdx = null
    this.session = {
      ...s,
      sessionId: uid('mws'),
      revision: 0,
      params: initialValues(s.world),
      committed: null,
      attempts: [],
      budgetLeft: s.world.goal.attempts,
      phase: 'playing',
      wonAtSeq: null,
      pending: null,
      restored: null,
      notice: { kind: 'info', text: '已重置：参数回到初值，尝试次数恢复', at: Date.now() },
    }
    this.emit()
    await this.commit({}, { actor: 'init' })
  }

  // ---- undo / replay (CLI-131) -------------------------------------------------

  // review m7: replay is read-only presentation — any real interaction
  // (preview scrub, formal commit, drag release) exits replay mode first, so
  // state can never change silently behind the replay view
  private exitReplayIfActive(): void {
    if (this.replayIdx !== null) this.replayIdx = null
  }

  /** index into attempts of the state currently shown in REPLAY mode, or null */
  replayIdx: number | null = null

  /** undo: restore the PREVIOUS committed state (params + its already-verified
   *  assessment + evidence) — a state restore, NOT a new computation: no run
   *  is created, no budget is consumed, revision advances so in-flight
   *  actions are fenced */
  undo(): boolean {
    const s = this.session
    if (!s) return false
    this.replayIdx = null
    const history = s.attempts.filter((a) => a.status === 'committed' && !a.fromFile && !a.fromUndo && a.assessment && (a as AttemptRecord).evidence)
    if (history.length < 2) {
      this.note('warn', '没有可撤销的历史状态（至少要有两次已提交的尝试）')
      return false
    }
    let target = history[history.length - 2]
    // review m2: restoring the state we are ALREADY in would be a no-op
    // ping-pong — walk further back to the most recent DIFFERENT state
    const current = s.committed
    if (current) {
      for (let i = history.length - 2; i >= 0; i--) {
        if (JSON.stringify(history[i].params) !== JSON.stringify(current.params)) { target = history[i]; break }
      }
    }
    this.generation += 2
    const generation = this.generation
    this.setPreview(null)
    this.session = {
      ...s,
      revision: s.revision + 1,
      params: target.params,
      committed: { generation, params: target.params, evidence: (target as AttemptRecord).evidence as Evidence, assessment: target.assessment! },
      pending: null,
      notice: { kind: 'info', text: `已撤销：回到第 ${target.seq ?? '—'} 次尝试后的已验证状态（恢复历史状态，不产生新 Run、不扣次数）`, at: Date.now() },
      attempts: [...s.attempts, { seq: null, generation, actor: 'user', params: target.params, status: 'committed', runIds: [], assessment: target.assessment, evidence: (target as AttemptRecord).evidence, consumed: false, exploration: true, at: Date.now(), fromUndo: true }],
    }
    this.emit()
    this.autosave()
    return true
  }

  /** enter replay mode: show a historical attempt's layout (from its recorded
   *  params) — presentation only, the authoritative state is untouched */
  replay(attemptIdx: number): boolean {
    const s = this.session
    if (!s) return false
    const a = s.attempts[attemptIdx]
    if (!a) return false
    this.replayIdx = attemptIdx
    this.setPreview(null)
    this.emit()
    return true
  }

  /** params of the replayed attempt (for the scene to render), or null */
  replayParams(): Record<string, number> | null {
    const s = this.session
    if (!s || this.replayIdx === null) return null
    return s.attempts[this.replayIdx]?.params ?? null
  }

  exitReplay(): void {
    this.replayIdx = null
    this.emit()
  }

  // ---- save / restore (local file + browser storage; recompute on restore) ----
  exportSave(): string {
    const s = this.session
    if (!s) throw new Error('没有加载世界')
    const ids = [...new Set(s.attempts.flatMap((a) => (a.fromFile ? [] : a.runIds)).concat(s.compileRunId ? [s.compileRunId] : []))]
    const known = ids.filter((id) => getExperimentRun(id))
    return JSON.stringify({
      format: SAVE_FORMAT,
      savedAt: new Date().toISOString(),
      note: '本机保存文件：恢复时按 params 用注册内核重新计算，文件里的指标与判定只作历史记录显示，不会当作当前结果；不是服务端事务恢复',
      world: s.world,
      worldDigest: s.worldDigest,
      origin: s.origin,
      sessionId: s.sessionId,
      revision: s.revision,
      params: s.params,
      budgetLeft: s.budgetLeft,
      phase: s.phase,
      wonAtSeq: s.wonAtSeq,
      attempts: s.attempts,
      runs: JSON.parse(exportExperimentRuns(known)) as ExperimentRun[],
    }, null, 2)
  }

  private autosave() {
    try {
      const s = this.session
      if (s) localStorage.setItem(LOCAL_KEY(s.world.id), this.exportSave())
    } catch {
      // storage full / disabled: saving to file still works
    }
  }

  hasLocalSave(worldId: string): boolean {
    try {
      return !!localStorage.getItem(LOCAL_KEY(worldId))
    } catch {
      return false
    }
  }

  async resumeLocal(worldId: string): Promise<{ ok: boolean; reason?: string }> {
    let text: string | null = null
    try {
      text = localStorage.getItem(LOCAL_KEY(worldId))
    } catch {
      text = null
    }
    if (!text) return { ok: false, reason: '本机没有这个世界的保存' }
    return this.importSave(text, 'local')
  }

  async importSave(text: string, via: 'file' | 'local' = 'file'): Promise<{ ok: boolean; reason?: string }> {
    let file: {
      format?: string; world?: unknown; worldDigest?: string; params?: Record<string, number>; budgetLeft?: number
      phase?: Phase; wonAtSeq?: number | null; attempts?: AttemptRecord[]; origin?: Session['origin']
    }
    try {
      file = JSON.parse(text)
    } catch {
      return { ok: false, reason: '不是合法 JSON' }
    }
    if (file.format !== SAVE_FORMAT) return { ok: false, reason: `保存格式不是 ${SAVE_FORMAT}` }
    const v = validateWorld(file.world)
    if (!v.ok) return { ok: false, reason: `保存里的世界定义无效：${[...v.errors, ...v.unsupported].join('；')}` }
    if (planInputDigest(v.world as unknown as Record<string, unknown>) !== file.worldDigest) {
      return { ok: false, reason: '世界定义与保存的修订摘要不符（文件被改动过），拒绝恢复' }
    }
    // CLI-129 存档覆盖修复：导入前把该世界的本机自动存档备份一份，导入
    // 不会无声抹掉用户原有进度；备份可在导入不满意时手工取回。
    // review M2：'local' 通道同样备份——否则激活阶段的开局 autosave 会先
    // 覆盖原键，恢复重算失败时本机进度已被"初值+满预算"的新存档顶掉。
    {
      try {
        const key = LOCAL_KEY(v.world.id)
        const prev = localStorage.getItem(key)
        if (prev) localStorage.setItem(`${key}.backup`, prev)
      } catch {
        /* storage disabled: nothing to back up */
      }
    }
    const act = await this.activate(v.world, via === 'file' ? 'file' : file.origin ?? 'catalog')
    if (!act.ok) return { ok: false, reason: act.errors.join('；') }
    const s = this.session!
    const tun = tunables(s.world)
    const params = { ...s.params }
    for (const t of tun) {
      const val = file.params?.[t.name]
      if (typeof val === 'number' && Number.isFinite(val) && val >= t.min && val <= t.max) params[t.name] = val
    }
    const budget = typeof file.budgetLeft === 'number' && Number.isInteger(file.budgetLeft) ? Math.max(0, Math.min(s.world.goal.attempts, file.budgetLeft)) : s.world.goal.attempts
    const history = (Array.isArray(file.attempts) ? file.attempts : []).map((a) => ({ ...a, fromFile: true }))
    this.session = {
      ...s,
      params,
      budgetLeft: budget,
      phase: file.phase === 'won' || file.phase === 'lost' ? file.phase : 'playing',
      wonAtSeq: typeof file.wonAtSeq === 'number' ? file.wonAtSeq : null,
      attempts: history,
      restored: via,
    }
    this.emit()
    // the current state is RECOMPUTED by the real kernels, never imported.
    // CLI-129 导入通关状态修复：文件声称的 won/lost 不作数——恢复后的
    // phase 以重算出的 Assessment 为准；文件说通关而本机重算未复现时，
    // 回到 playing 并明说，绝不让“文件说了算”的通关留在界面上。
    const res = await this.commit({}, { actor: 'restore' })
    if (res.status !== 'committed') return { ok: false, reason: `恢复后重算未成功：${'reason' in res ? res.reason : res.status}` }
    const now = this.session!
    const recomputed = now.committed?.assessment?.outcome
    let phaseNote = ''
    if (file.phase === 'won' && recomputed !== 'success') {
      this.session = { ...now, phase: 'playing', wonAtSeq: null }
      this.emit()
      phaseNote = '；文件记录为已通关，但本机重算未复现（以重算为准，回到进行中）'
    }
    // review m6: the file's 'lost' claim gets the same treatment — a recomputed
    // success must not stay behind a "挑战失败" banner
    if (file.phase === 'lost' && recomputed === 'success') {
      this.session = { ...now, phase: 'playing', wonAtSeq: null }
      this.emit()
      phaseNote = '；文件记录为已失败，但本机重算满足全部约束（以重算为准，回到进行中）'
    }
    this.note('info', `已从${via === 'file' ? '本机文件' : '浏览器本机存储'}恢复：参数已用注册内核重新计算（历史记录来自文件，仅供查看）${via === 'file' ? '；原本机进度已备份' : ''}${phaseNote}`)
    return { ok: true }
  }
}

class KernelFailure extends Error {}

/** record any run the outcome carries (error runs included: resources were spent) */
function keepRun(o: SkillOutcome, runIds: string[]): ExperimentRun | null {
  const run = 'run' in o ? o.run ?? null : null
  if (run) runIds.push(run.runId)
  return run
}

function outcomeMessage(o: SkillOutcome): string {
  if (o.status === 'ok') return 'ok'
  if (o.status === 'needs_input') return `需要输入（${o.missing.join(', ')}）：${o.message}`
  if (o.status === 'unsupported') return `不支持：${o.message}`
  return `${o.code}：${o.message}`
}

export const host = new MathWorldHost()
export type { MathWorldHost }
