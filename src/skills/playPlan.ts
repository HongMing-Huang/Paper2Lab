// PlayPlan — the FAROS-PlanPackage-inspired experiment contract (AGENTS.md
// v6 §5). Entering an experiment requires a structured plan: goal, confirmed
// variables vs assumptions, chosen skill, metrics, renderer, evidence basis
// and — critically — the claims it must NOT make. The plan is data, never
// prose; both the local planner and the AgentScope orchestrator must emit it
// before any run.
import type { SourceAnchor } from '../formula/spec'
import type { FormulaAnalysis } from '../formula/analyze'
import { getSkill, type ScientificSkill } from './registry'
import type { PaperBinding } from './paperBinding'

export interface PlayPlanVariable {
  name: string
  role: 'parameter' | 'independent' | 'output' | 'condition'
  confirmed: boolean
  /** where in the paper this variable/condition came from (if anchored) */
  anchorId?: string
}

export interface PlayPlan {
  planId: string
  goal: string
  source: { docId: string; anchorId?: string; title: string }
  variables: PlayPlanVariable[]
  /** unverified guesses the plan depends on (e.g. "Docling latex is faithful") */
  assumptions: string[]
  skill: string
  skillVersion: string
  renderer: string
  metrics: string[]
  /** experiment inputs — the seed spec for the first run */
  inputs: Record<string, unknown>
  evidenceBasis: string
  successCriteria: string
  /** claims this experiment must never make (finite-scale ≠ proof etc.) */
  nonClaims: string[]
  /** v2 (#22): the paper-content binding chain — 锚点→问题→方程与单位→
   * 条件→可操作对象→观测量→引擎与视图。Present when the plan came from a
   * routed paper; synthesised below when built standalone. */
  binding?: PaperBinding
  createdAt: number
}

// ---- plan registry (#32): the executor gate accepts REGISTERED plans only
// — a bare planId string proves nothing. Builders register on creation;
// the engine exposes a `plan` op / inline plan field for remote callers.
const PLAN_REGISTRY = new Map<string, PlayPlan>()

/** orchestration/companion skills any experiment plan governs implicitly */
export const PLAN_COMPANION_SKILLS = new Set([
  'experiment.fork',
  'experiment.compare',
  'paper.trace-source',
  'kakeya.sweep', // companion measurement of a kakeya plan's terminal run
  'kakeya.generate', // geometry prerequisite of a kakeya measurement plan
])

export function registerPlan(plan: PlayPlan): PlayPlan {
  if (!plan || typeof plan.planId !== 'string' || typeof plan.skill !== 'string' || typeof plan.goal !== 'string') {
    throw new Error('registerPlan: plan must carry planId/skill/goal')
  }
  // first registration wins — a replayed/duplicate planId cannot silently
  // REPLACE an existing contract (idempotent re-register of equal content)
  if (!PLAN_REGISTRY.has(plan.planId)) PLAN_REGISTRY.set(plan.planId, plan)
  return plan
}

export function getPlan(planId: string): PlayPlan | undefined {
  return PLAN_REGISTRY.get(planId)
}

export function planCoversSkill(plan: PlayPlan, skill: string): boolean {
  if (plan.skill === skill) return true
  if (PLAN_COMPANION_SKILLS.has(skill)) return true
  // canonical aliases (AGENTS §4) are the same contract
  const target = getSkill(skill)
  const planned = getSkill(plan.skill)
  if (target && planned) {
    return (target.aliases?.includes(plan.skill) ?? false) || (planned.aliases?.includes(skill) ?? false)
  }
  return false
}

/** remote/engine callers register a plan from parsed JSON (shape-checked) */
export function registerPlanFromJson(raw: unknown): PlayPlan {
  const p = raw as Partial<PlayPlan>
  if (!p || typeof p.planId !== 'string' || typeof p.skill !== 'string' || typeof p.goal !== 'string') {
    throw new Error('plan JSON must carry planId, skill and goal')
  }
  return registerPlan({
    planId: p.planId,
    goal: p.goal,
    source: p.source ?? { docId: 'engine', title: 'engine-submitted plan' },
    variables: Array.isArray(p.variables) ? p.variables : [],
    assumptions: Array.isArray(p.assumptions) ? p.assumptions : [],
    skill: p.skill,
    skillVersion: p.skillVersion ?? '?',
    renderer: p.renderer ?? 'none',
    metrics: Array.isArray(p.metrics) ? p.metrics : [],
    inputs: (p.inputs ?? {}) as Record<string, unknown>,
    evidenceBasis: p.evidenceBasis ?? 'engine-submitted PlayPlan',
    successCriteria: p.successCriteria ?? '',
    nonClaims: Array.isArray(p.nonClaims) ? p.nonClaims : [],
    binding: p.binding,
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
  })
}

/** build (and register) a real plan for tests, probes and app surfaces that
 *  need an explicit contract without a paper binding */
export function buildPlan(input: { skill: string; goal: string; metrics?: string[]; inputs?: Record<string, unknown>; renderer?: string; nonClaims?: string[] }): PlayPlan {
  return registerPlan({
    planId: `plan-${Date.now().toString(36)}-${(planSeq++).toString(36)}`,
    goal: input.goal,
    source: { docId: 'app', title: 'app plan' },
    variables: [],
    assumptions: [],
    skill: input.skill,
    skillVersion: getSkill(input.skill)?.version ?? '?',
    renderer: input.renderer ?? getSkill(input.skill)?.renderer ?? 'none',
    metrics: input.metrics ?? [],
    inputs: input.inputs ?? {},
    evidenceBasis: '本地确定性内核 CALCULATED',
    successCriteria: '结果来自真实内核执行并携带 runId',
    nonClaims: input.nonClaims ?? FINITE_SCALE_NON_CLAIMS,
    createdAt: Date.now(),
  })
}

let planSeq = 0
function nextPlanId(): string {
  return `plan-${Date.now().toString(36)}-${(planSeq++).toString(36)}`
}

const FINITE_SCALE_NON_CLAIMS = [
  '不得声称证明了任何定理（有限尺度数值实验）',
  '不得外推到论文未陈述的参数范围',
]

/** plan for the generic formula explorer (skill formula.plot) */
export function buildFormulaPlayPlan(
  analysis: FormulaAnalysis,
  anchor: SourceAnchor,
  paperTitle: string,
  skill: ScientificSkill,
  binding?: PaperBinding,
): PlayPlan {
  return registerPlan({
    planId: nextPlanId(),
    goal: `操作论文公式 ${analysis.latex} 的参数，观察 ${analysis.output ?? '输出'} 如何随之变化`,
    source: { docId: anchor.docId, anchorId: `${anchor.docId}:p${anchor.page}`, title: paperTitle },
    variables: [
      ...analysis.params.map<PlayPlanVariable>((p) => ({
        name: p.name,
        role: 'parameter',
        confirmed: false,
      })),
      {
        name: analysis.independent!,
        role: 'independent',
        confirmed: false,
      },
      { name: analysis.output ?? 'y', role: 'output', confirmed: !!analysis.output },
    ],
    assumptions: ['变量角色与范围为启发式建议，尚未由论文条件确认；Cortex 可解析不等于提取忠实'],
    skill: skill.name,
    skillVersion: skill.version,
    renderer: skill.renderer,
    metrics: ['curve', 'peak', 'integral'],
    inputs: {
      expression: analysis.rhs,
      parameters: analysis.params.map((p) => p.name),
      independent: analysis.independent,
      range: analysis.domain,
    },
    evidenceBasis: `paper p.${anchor.page} 公式（Docling anchor）+ 本地 Cortex 真计算`,
    successCriteria: '拖动参数时曲线连续重算，LOCAL CALC 徽章引用真实 run',
    nonClaims: FINITE_SCALE_NON_CLAIMS,
    binding:
      binding ??
      ({
        kind: 'formula',
        question: `${paperTitle} 中关键方程的参数如何决定输出？`,
        anchors: [`${anchor.docId}:p${anchor.page}`],
        equations: [
          {
            latex: analysis.latex,
            anchorId: `${anchor.docId}:p${anchor.page}`,
            variables: [
              ...analysis.params.map((p) => ({ name: p.name, role: 'parameter' as const })),
              { name: analysis.independent!, role: 'independent' as const },
              { name: analysis.output ?? 'y', role: 'output' as const },
            ],
          },
        ],
        conditions: [],
        objects: analysis.params.map((p) => ({
          name: `系数 ${p.name}`,
          type: 'coefficient' as const,
          manipulates: [p.name],
        })),
        observables: [{ name: '曲线' }, { name: '峰值' }, { name: '∫|y|dx' }],
        engine: { skill: 'formula.plot', view: 'jsxgraph' },
      }) satisfies PaperBinding,
    createdAt: Date.now(),
  })
}

/** plan for the Kakeya hero demo (skill kakeya.measure) */
export function buildKakeyaPlayPlan(
  params: { deltaExp: number; nTubes: number; packing: number },
  paperTitle: string,
  skill: ScientificSkill,
): PlayPlan {
  return registerPlan({
    planId: nextPlanId(),
    goal: '探索 δ / 方向数 / packing 如何影响有限尺度 tube 并集体积与重叠度',
    source: { docId: 'wang-zahl-kakeya3d', title: paperTitle },
    variables: [
      { name: 'deltaExp', role: 'parameter', confirmed: true },
      { name: 'nTubes', role: 'parameter', confirmed: true },
      { name: 'packing', role: 'parameter', confirmed: true },
    ],
    assumptions: ['Fibonacci 半球面方向集满足 δ-分离（代码内已验证 minSep ≥ 2δ）'],
    skill: skill.name,
    skillVersion: skill.version,
    renderer: skill.renderer,
    metrics: ['occupiedCells', 'unionVolume', 'multiplicity'],
    inputs: { ...params, res: 48 },
    evidenceBasis: 'Wang–Zahl (2025) p.3 定理为 PAPER；本实验为 48³ 体素有限尺度 CALCULATED',
    successCriteria: 'Worker 重算 |⋃T| 与 multiplicity，3D 与图表随动',
    nonClaims: FINITE_SCALE_NON_CLAIMS,
    createdAt: Date.now(),
  })
}
