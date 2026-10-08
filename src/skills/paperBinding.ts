// PaperBinding (#22) — the structured chain from PAPER CONTENT to experiment:
//   论文原文锚点 → 研究问题 → 方程与变量单位 → 初始条件和约束
//                 → 可操作对象 → 观测量 → 引擎与视图
// The binding is DATA derived from the ingested paper (deterministic here;
// an LLM may only propose one — every field is re-validated against the doc).
// No keyword → fixed demo: a "dynamics" paper without initial conditions is
// needs-info, a paper without equations/data is out-of-scope — never silently
// re-skinned as a generic formula explorer.
import type { IngestedDoc, IngestedItem } from '../ingest/doclingSchema'
import { analyzeFormula } from '../formula/analyze'

export type BindingKind = 'formula' | 'fit' | 'ode' | 'kakeya'

export interface BoundVariable {
  name: string
  role: 'parameter' | 'independent' | 'output' | 'state'
  /** e.g. s, m, rad — omitted when the paper does not state it */
  unit?: string
}

export interface BoundEquation {
  latex: string
  /** the paper item this equation was lifted from (Data → Experiment) */
  anchorId: string
  variables: BoundVariable[]
}

export type BoundCondition =
  | {
      kind: 'initial'
      description: string
      anchorId?: string
      /** state name → value at t=0, extracted from the paper text */
      values: Record<string, number>
    }
  | { kind: 'constraint'; description: string; anchorId?: string }

/** what the player physically drags — the object must come from THIS paper */
export interface BoundObject {
  name: string
  type: 'point' | 'coefficient' | 'cluster' | 'initial-state' | 'angle' | 'bob'
  /** variable names the object writes back to */
  manipulates: string[]
  anchorId?: string
}

/** what the experiment measures — the paper's own quantities */
export interface BoundObservable {
  name: string
  unit?: string
}

export interface PaperBinding {
  kind: BindingKind
  /** the research question this paper actually studies */
  question: string
  /** paper item ids the binding was derived from */
  anchors: string[]
  equations: BoundEquation[]
  conditions: BoundCondition[]
  objects: BoundObject[]
  observables: BoundObservable[]
  engine: { skill: string; view: string }
  /** fit only: numeric (x,y) pairs parsed from the paper's tables */
  dataPoints?: Array<[number, number]>
  /** ode only: the extracted 2-state system (paper latex, anchored) */
  system?: OdeSystem
}

// ---------------------------------------------------------------- detection

const ODE_LATEX = [/\\dot\{/, /\\frac\s*\{\s*d[a-zA-Z]/, /\bd[a-zA-Z]\s*\/\s*d[tτs]/, /[xy]' *\(/, /[xy]'/]
const ODE_TEXT = [
  '微分方程', '动力系统', '种群', '捕食', '猎物', '稳定性', '平衡点', '周期解', '振动', '阻尼',
  'differential equation', 'dynamical system', 'population', 'predator', 'prey', 'stability',
  'equilibrium', 'oscillat', 'lotka', 'volterra', 'pendulum', '摆',
]
const DATA_TEXT = [
  '数据', '测量值', '实验值', '观测', '拟合', '残差', '最小二乘', '表格',
  'measured', 'experimental data', 'observ', 'residual', 'least squares', 'fitting', 'fit the',
]

export interface OdeDetection {
  isOde: boolean
  hasInitial: boolean
  initials: Record<string, number>
  matched: string[]
}

/** detect ODE content and extract initial conditions from the paper text.
 * Values like "x(0) = 2", "y_0 = 0.5", "初值 x=2, y=0.5" are read as-is —
 * nothing is invented; missing → hasInitial=false (the router asks). */
export function detectOde(doc: IngestedDoc): OdeDetection {
  const text = doc.items.map((i) => i.text ?? '').join('\n')
  const latex = doc.items.map((i) => i.latex ?? '').join('\n')
  const hasDerivative = ODE_LATEX.some((r) => r.test(latex))
  const matched: string[] = []
  if (hasDerivative) matched.push('latex-derivative')
  for (const k of ODE_TEXT) {
    if (text.toLowerCase().includes(k) || latex.toLowerCase().includes(k)) matched.push(k)
  }
  const formulaCount = doc.items.filter((i) => i.kind === 'formula' && i.latex).length
  // a bare keyword ("摆"/"population") with no equations at all is NOT an ODE
  // paper for our purposes — it falls through to formula/out-of-scope
  const isOde = hasDerivative || (formulaCount >= 1 && matched.some((m) => m !== 'latex-derivative'))
  const initials: Record<string, number> = {}
  const patterns = [
    /([a-zA-Z])\s*\(\s*0\s*\)\s*=\s*(-?\d+(?:\.\d+)?)/g,
    /([a-zA-Z])_0\s*=\s*(-?\d+(?:\.\d+)?)/g,
    /([a-zA-Z])\s*\(\s*t\s*=\s*0\s*\)\s*=\s*(-?\d+(?:\.\d+)?)/g,
  ]
  for (const p of patterns) {
    for (const m of text.matchAll(p)) initials[m[1]] = Number(m[2])
  }
  return { isOde, hasInitial: Object.keys(initials).length >= 1, initials, matched }
}

/** data/fitting cues: the paper compares its model against measured numbers */
export function detectData(doc: IngestedDoc): boolean {
  const hasTable = doc.items.some((i) => i.kind === 'table')
  if (hasTable) return true
  const text = doc.items.map((i) => i.text ?? '').join('\n').toLowerCase()
  return DATA_TEXT.some((k) => text.includes(k))
}

/** numeric (x, y) pairs parsed from the paper's TABLE items — the fit
 * experiment's reference data. Nothing is invented: no table, no pairs. */
export function parseDataPairs(doc: IngestedDoc): Array<[number, number]> {
  const pairs: Array<[number, number]> = []
  for (const item of doc.items) {
    if (item.kind !== 'table') continue
    // REAL docling tables are structured: { columns, rows } (verified against
    // tectonic papers); the synthetic fixtures carry plain text lines
    const rows = (item as { table?: { rows?: string[][] } }).table?.rows
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (!Array.isArray(row) || row.length < 2) continue
        const x = Number(row[0])
        const y = Number(row[1])
        // header rows ("x (m)", "y (mV)") are NaN and skipped — never faked
        if (Number.isFinite(x) && Number.isFinite(y)) pairs.push([x, y])
      }
      continue
    }
    if (!item.text) continue
    for (const line of item.text.split(/\n+/)) {
      const nums = line.match(/-?\d+(?:\.\d+)?/g)
      if (nums && nums.length >= 2) {
        const x = Number(nums[0])
        const y = Number(nums[1])
        if (Number.isFinite(x) && Number.isFinite(y)) pairs.push([x, y])
      }
    }
  }
  return pairs
}

// ---------------------------------------------------------------- ODE system

export interface OdeEquationItem {
  state: string
  /** the paper's ORIGINAL latex for this state equation (with LHS) */
  latex: string
  anchorId: string
}
export interface OdeSystem {
  states: [string, string]
  equations: [OdeEquationItem, OdeEquationItem]
}

const ODE_LHS = [
  /\\dot\s*\{\s*([a-zA-Z])\s*\}\s*=/,
  /\\frac\s*\{\s*d\s*([a-zA-Z])\s*\}\s*\{\s*d[a-zA-Z]+\s*\}\s*=/,
  /([a-zA-Z])'\s*=/,
]

/** extract a 2-state autonomous system from the paper's own formulas:
 *  \dot{x}=…, \frac{dy}{dt}=…, x'=… — one equation per state, anchored.
 *  Fewer than two distinct states → null (the router asks instead of
 *  inventing the missing equation). */
export function odeSystemOf(doc: IngestedDoc): OdeSystem | null {
  const byState = new Map<string, OdeEquationItem>()
  for (const item of doc.items) {
    if (item.kind !== 'formula' || !item.latex) continue
    for (const p of ODE_LHS) {
      const m = item.latex.match(p)
      if (m) {
        if (!byState.has(m[1])) byState.set(m[1], { state: m[1], latex: item.latex, anchorId: item.id })
        break
      }
    }
  }
  if (byState.size < 2) return null
  const eqs = [...byState.values()].slice(0, 2) as [OdeEquationItem, OdeEquationItem]
  return { states: [eqs[0].state, eqs[1].state], equations: eqs }
}

// ---------------------------------------------------------------- builders

function variablesOf(item: IngestedItem, extraRole: 'state' | 'output' = 'output'): BoundVariable[] {
  const a = analyzeFormula(item.latex ?? '')
  if (!a.ok) return []
  return [
    ...a.params.map<BoundVariable>((p) => ({ name: p.name, role: 'parameter' })),
    ...(a.independent ? [{ name: a.independent, role: 'independent' as const }] : []),
    ...(a.output ? [{ name: a.output, role: extraRole }] : []),
  ]
}

/** formula explorer binding: drag the paper's own coefficients */
export function buildFormulaBinding(doc: IngestedDoc, keyFormula: IngestedItem): PaperBinding {
  return {
    kind: 'formula',
    question: `${doc.title} 中关键方程的参数如何决定输出？`,
    anchors: [keyFormula.id],
    equations: [{ latex: keyFormula.latex!, anchorId: keyFormula.id, variables: variablesOf(keyFormula) }],
    conditions: [],
    objects: (analyzeFormula(keyFormula.latex!).ok ? analyzeFormula(keyFormula.latex!).params : []).map((p) => ({
      name: `系数 ${p.name}`,
      type: 'coefficient' as const,
      manipulates: [p.name],
      anchorId: keyFormula.id,
    })),
    observables: [{ name: '曲线' }, { name: '峰值' }, { name: '∫|y|dx' }],
    engine: { skill: 'formula.plot', view: 'jsxgraph' },
  }
}

/** fitting binding: the paper measures data — residuals are the observable */
export function buildFitBinding(doc: IngestedDoc, keyFormula: IngestedItem): PaperBinding {
  const base = buildFormulaBinding(doc, keyFormula)
  const dataPoints = parseDataPairs(doc)
  return {
    ...base,
    kind: 'fit',
    question: `${doc.title} 的模型与论文测量数据的残差能压到多小？`,
    objects: [
      ...base.objects,
      { name: '曲线上的控制点（反拖改参数）', type: 'point', manipulates: base.objects.map((o) => o.manipulates[0]), anchorId: keyFormula.id },
    ],
    observables: [...base.observables, { name: '对论文数据的残差' }, { name: 'RMSE' }],
    engine: { skill: 'formula.plot', view: 'jsxgraph-fit' },
    dataPoints,
  }
}

/** ODE binding: drag the initial state in the phase plane — the paper's own
 * equations and initial values; neither is ever invented here */
export function buildOdeBinding(doc: IngestedDoc, det: OdeDetection, system?: OdeSystem | null): PaperBinding {
  const eqSources: Array<{ latex: string; anchorId: string }> = system
    ? system.equations.map((e) => ({ latex: e.latex, anchorId: e.anchorId }))
    : doc.items
        .filter((i) => i.kind === 'formula' && i.latex)
        .slice(0, 2)
        .map((i) => ({ latex: i.latex!, anchorId: i.id }))
  const equations: BoundEquation[] = eqSources.map((e) => ({
    latex: e.latex,
    anchorId: e.anchorId,
    variables: variablesOf({ kind: 'formula', id: e.anchorId, page: 1, bbox: { x: 0, y: 0, w: 0, h: 0 }, latex: e.latex } as IngestedItem, 'state'),
  }))
  const states = system ? system.states : (Object.keys(det.initials).length >= 2 ? [Object.keys(det.initials)[0], Object.keys(det.initials)[1]] as [string, string] : ['x', 'y'])
  return {
    kind: 'ode',
    question: `${doc.title} 的系统从论文给定的初值出发如何演化？拖动相平面初值或施加扰动会怎样？`,
    anchors: equations.map((e) => e.anchorId),
    equations,
    conditions: [
      {
        kind: 'initial',
        description: '论文给出的状态初值',
        values: det.initials,
      },
      { kind: 'constraint', description: '方程右端按论文原文编译执行（Cortex LaTeX→JS），不替换为通用摆/种群演示' },
    ],
    objects: [
      { name: '相平面初始点（拖动释放）', type: 'initial-state', manipulates: [...states] },
    ],
    observables: [{ name: '状态轨迹' }, { name: '平衡点' }, { name: '时间曲线' }, { name: '周期' }],
    engine: { skill: 'ode.phase', view: 'phase-plane-jsxgraph' },
    system: system ?? undefined,
  }
}

/** Kakeya binding — the hero paper's own objects and observables */
export function buildKakeyaBinding(doc: IngestedDoc): PaperBinding {
  const anchors = doc.items.filter((i) => i.kind === 'formula' || i.kind === 'text').slice(0, 3).map((i) => i.id)
  return {
    kind: 'kakeya',
    question: 'Wang–Zahl：δ-管束族在单位立方体内的并集体积与重叠结构如何随 δ/方向数/排布变化？',
    anchors,
    equations: [],
    conditions: [{ kind: 'constraint', description: '所有管段必须留在测量区域 [0,1]³ 内——出界不得降分（#21）' }],
    objects: [
      { name: '管簇（δ-tube clusters）', type: 'cluster', manipulates: ['packing'] },
    ],
    observables: [{ name: '|⋃T|（占据体积）' }, { name: '重叠度' }, { name: '最大重数' }],
    engine: { skill: 'kakeya.measure', view: 'kakeya-3d' },
  }
}
