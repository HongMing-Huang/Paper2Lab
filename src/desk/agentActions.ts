// Agent action layer for the research desk — ported from tldraw
// agent-template client/actions/AgentActionUtil.ts (registry + base class
// contract): every agent-visible canvas operation is a registered action
// util with `sanitizeAction` (validate/transform or REJECT with null),
// `applyAction` (editor changes wrapped in one undoable editor.run) and
// `savesToHistory`. Scientific execution stays outside this layer — actions
// call the SAME desk/explorer/skill paths the UI uses (no free UI code, no
// numbers invented here; every metric comes back inside an ExperimentRun).
import type { Editor, TLShapeId } from '@tldraw/tldraw'
import { applyLabLayout, type LabFrameShape } from './labFrame'
import type { BoardLayoutMode } from './boardLayout'

// ---------------------------------------------------------------- types
export interface BaseAgentAction {
  type: string
  [key: string]: unknown
}

/** what an action reports back — becomes the external-execution tool result */
export interface ActionOutcome {
  ok: boolean
  reason?: string
  runs?: Array<{ runId: string; metrics?: Record<string, number> }>
}

export interface ChatHistoryInfo {
  label?: string
  detail?: string
}

export interface AgentHelpers {
  editor: Editor
  /** doc items of the ingested paper (anchor lookup for create_experiment) */
  docItems: Array<{ id: string; latex?: string; page: number }>
  /** ids of the explorers currently on the desk (oldest → newest) */
  explorerIds(): string[]
  /** parameters of one explorer (name → {min,max}) for validation */
  explorerParams(id: string): Array<{ name: string; min: number; max: number }>
  /** the explorer the user currently has selected (shape → props.explorerId) */
  selectedExplorerId(): string | null
  /** desk operations (single source of truth — same paths the UI buttons use) */
  play(anchorId: string): string | null
  fork(explorerId: string, changes: Record<string, number>): string | null
  compare(): void
}

// ---------------------------------------------------------------- base class
export abstract class AgentActionUtil<T extends BaseAgentAction = BaseAgentAction> {
  static type: string

  constructor(protected helpers: AgentHelpers) {}

  /** info for the agent history strip; null hides the entry */
  getInfo(_action: T): ChatHistoryInfo | null {
    return {}
  }

  /** validate/transform the action, or REJECT by returning null */
  sanitizeAction(action: T): T | null {
    return action
  }

  /** apply to the editor; runs inside ONE editor.run → single undo */
  applyAction(_action: T): Promise<ActionOutcome> | ActionOutcome {
    return { ok: true }
  }

  /** whether this action participates in the undo stack */
  savesToHistory(): boolean {
    return true
  }
}

export interface AgentActionUtilConstructor<T extends BaseAgentAction = BaseAgentAction> {
  new (helpers: AgentHelpers): AgentActionUtil<T>
  type: T['type']
}

// ---------------------------------------------------------------- registry
const defaultRegistry = new Map<string, AgentActionUtilConstructor<BaseAgentAction>>()
const modeRegistry = new Map<string, Map<string, AgentActionUtilConstructor<BaseAgentAction>>>()

export function registerActionUtil<T extends AgentActionUtilConstructor<BaseAgentAction>>(
  util: T,
  options?: { forModes?: string[] },
): T {
  const { forModes } = options ?? {}
  if (typeof util !== 'function' || !util.type) {
    throw new Error('registerActionUtil expects an AgentActionUtil subclass with a static type')
  }
  if (forModes && forModes.length > 0) {
    if (!modeRegistry.has(util.type)) modeRegistry.set(util.type, new Map())
    const modeMap = modeRegistry.get(util.type)!
    for (const mode of forModes) {
      if (modeMap.has(mode)) throw new Error(`Action util for ${util.type} already registered for mode ${mode}`)
      modeMap.set(mode, util)
    }
  } else {
    if (defaultRegistry.has(util.type)) throw new Error(`Agent action util already registered: ${util.type}`)
    defaultRegistry.set(util.type, util)
  }
  return util
}

export function getActionUtils(helpers: AgentHelpers, mode?: string): Record<string, AgentActionUtil<BaseAgentAction>> {
  const out: Record<string, AgentActionUtil<BaseAgentAction>> = {}
  for (const [type, Util] of defaultRegistry.entries()) out[type] = new Util(helpers)
  if (mode) {
    for (const [type, modeMap] of modeRegistry.entries()) {
      const Util = modeMap.get(mode)
      if (Util) out[type] = new Util(helpers)
    }
  }
  return out
}

/** dispatch one action through the registry: sanitize → apply, with full
 *  backfill (rejected actions report ok:false instead of throwing mid-turn) */
export async function runAgentAction(
  helpers: AgentHelpers,
  action: BaseAgentAction,
  mode?: string,
): Promise<ActionOutcome & { label?: string }> {
  const utils = getActionUtils(helpers, mode)
  const Util = utils[String(action.type)]
  if (!Util) return { ok: false, reason: `unknown agent action: ${String(action.type)}` }
  const clean = Util.sanitizeAction(action)
  if (!clean) return { ok: false, reason: `action rejected by validation: ${String(action.type)}` }
  const editor = helpers.editor
  let outcome: ActionOutcome = { ok: false, reason: 'action did not run' }
  if (Util.savesToHistory() && editor) {
    await editor.run(async () => {
      outcome = await Util.applyAction(clean)
    })
  } else {
    outcome = await Util.applyAction(clean)
  }
  return { ...outcome, ...(Util.getInfo(clean) ?? {}) }
}

// ---------------------------------------------------------------- actions
/** grow a new experiment from a paper formula anchor */
export class CreateExperimentAction extends AgentActionUtil<{ type: 'create_experiment'; anchorId?: string }> {
  static override type = 'create_experiment'
  override sanitizeAction(a: { type: 'create_experiment'; anchorId?: string }) {
    const anchorId = typeof a.anchorId === 'string' ? a.anchorId : ''
    const anchor = this.helpers.docItems.find((i) => i.id === anchorId && i.latex)
    if (!anchor) return null // unknown/latex-less anchor → reject, never guess
    return { ...a, anchorId }
  }
  override applyAction({ anchorId }: { type: 'create_experiment'; anchorId?: string }) {
    const explorerId = this.helpers.play(anchorId!)
    return explorerId
      ? { ok: true, runs: [], reason: `experiment ${explorerId} grew on the desk` }
      : { ok: false, reason: 'formula could not compile into an experiment' }
  }
  override getInfo() {
    return { label: '展开实验', detail: '从论文公式长出实验纸' }
  }
}

/** fork the selected (or named) experiment with validated parameter changes */
export class ForkExperimentAction extends AgentActionUtil<{
  type: 'fork_experiment'
  explorerId?: string
  changes?: Record<string, number>
}> {
  static override type = 'fork_experiment'
  override sanitizeAction(a: { type: 'fork_experiment'; explorerId?: string; changes?: Record<string, number> }) {
    const explorerId = typeof a.explorerId === 'string' && a.explorerId ? a.explorerId : this.helpers.selectedExplorerId()
    if (!explorerId || !this.helpers.explorerIds().includes(explorerId)) return null
    const params = this.helpers.explorerParams(explorerId)
    const raw = (a.changes ?? {}) as Record<string, unknown>
    if (Object.keys(raw).some((name) => !params.some((p) => p.name === name))) return null
    const changes: Record<string, number> = {}
    for (const p of params) {
      const v = raw[p.name]
      if (!(p.name in raw)) continue
      if (typeof v !== 'number' || !Number.isFinite(v) || v < p.min || v > p.max) return null
      changes[p.name] = v
    }
    if (Object.keys(changes).length === 0) return null // nothing valid to change
    return { ...a, explorerId, changes }
  }
  override applyAction({ explorerId, changes }: { type: 'fork_experiment'; explorerId?: string; changes?: Record<string, number> }) {
    const newId = this.helpers.fork(explorerId!, changes!)
    return newId
      ? { ok: true, runs: [], reason: `forked ${explorerId} → ${newId}` }
      : { ok: false, reason: 'fork failed' }
  }
  override getInfo(a: { type: 'fork_experiment'; explorerId?: string; changes?: Record<string, number> }) {
    const c = Object.entries(a.changes ?? {}).map(([k, v]) => `${k}=${v}`).join(', ')
    return { label: 'Fork 实验', detail: c || '' }
  }
}

/** grow/reveal the comparison chart (metrics come from real Run diffs) */
export class CompareExperimentsAction extends AgentActionUtil<{ type: 'compare_experiments' }> {
  static override type = 'compare_experiments'
  override sanitizeAction(a: { type: 'compare_experiments' }) {
    if (this.helpers.explorerIds().length < 2) return null // need two experiments
    return a
  }
  override applyAction() {
    this.helpers.compare()
    return { ok: true, reason: 'comparison chart updated' }
  }
  override getInfo() {
    return { label: '对比实验', detail: 'Comparison 纸更新（真实 Run 差异）' }
  }
}

/** switch the lab frame layout (undoable, from the frame header or the agent) */
export class ArrangeLabAction extends AgentActionUtil<{ type: 'arrange_lab'; mode: BoardLayoutMode }> {
  static override type = 'arrange_lab'
  override sanitizeAction(a: { type: 'arrange_lab'; mode: BoardLayoutMode }) {
    const mode = a.mode
    return mode === 'free' || mode === 'row' || mode === 'grid' || mode === 'spotlight' ? { ...a, mode } : null
  }
  override applyAction({ mode }: { type: 'arrange_lab'; mode: BoardLayoutMode }) {
    const editor = this.helpers.editor
    const frames = editor.getCurrentPageShapeIds()
    let frameId: TLShapeId | null = null
    for (const id of frames) {
      const s = editor.getShape(id)
      if (s?.type === 'p2l-lab') {
        frameId = id
        break
      }
    }
    if (!frameId) return { ok: false, reason: 'no lab frame on the desk' }
    editor.updateShape({ id: frameId, type: 'p2l-lab', props: { layout: mode } })
    applyLabLayout(editor, frameId)
    return { ok: true, reason: `lab arranged: ${mode}` }
  }
  override getInfo(a: { type: 'arrange_lab'; mode: BoardLayoutMode }) {
    return { label: '重排桌面', detail: String(a.mode) }
  }
}

/** promote a shape to the spotlight hero (聚焦) — moves it leftmost so the
 *  spotlight layout enlarges it; auto re-flows the rest */
export class FocusShapeAction extends AgentActionUtil<{ type: 'focus_shape'; shapeId?: string }> {
  static override type = 'focus_shape'
  override sanitizeAction(a: { type: 'focus_shape'; shapeId?: string }) {
    const editor = this.helpers.editor
    let shapeId = typeof a.shapeId === 'string' ? (a.shapeId as TLShapeId) : undefined
    if (!shapeId) {
      const sel = editor.getSelectedShapes()[0]
      shapeId = sel?.id
    }
    if (!shapeId || !editor.getShape(shapeId)) return null
    return { ...a, shapeId: shapeId as string }
  }
  override applyAction({ shapeId }: { type: 'focus_shape'; shapeId?: string }) {
    const editor = this.helpers.editor
    let frameId: TLShapeId | null = null
    for (const id of editor.getCurrentPageShapeIds()) {
      const s = editor.getShape(id)
      if (s?.type === 'p2l-lab') {
        frameId = id
        break
      }
    }
    const frame = frameId ? (editor.getShape(frameId) as LabFrameShape | undefined) : undefined
    if (!frame) return { ok: false, reason: 'no lab frame on the desk' }
    const target = editor.getShape(shapeId as unknown as TLShapeId)
    if (!target || target.parentId !== frame.id) return { ok: false, reason: 'shape is not part of the lab' }
    // spotlight picks the left-most child as hero → move it there, re-layout
    editor.updateShape({ id: target.id, type: target.type, x: 0, y: target.y })
    editor.updateShape({ id: frame.id, type: 'p2l-lab', props: { layout: 'spotlight' } })
    applyLabLayout(editor, frame.id)
    return { ok: true, reason: `focused ${String(shapeId)}` }
  }
  override getInfo() {
    return { label: '聚焦', detail: '主实验放大，分支并排' }
  }
}

registerActionUtil(CreateExperimentAction)
registerActionUtil(ForkExperimentAction)
registerActionUtil(CompareExperimentsAction)
registerActionUtil(ArrangeLabAction)
registerActionUtil(FocusShapeAction)
