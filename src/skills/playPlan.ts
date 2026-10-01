// PlayPlan — the FAROS-PlanPackage-inspired experiment contract (AGENTS.md
// v6 §5). Entering an experiment requires a structured plan: goal, confirmed
// variables vs assumptions, chosen skill, metrics, renderer, evidence basis
// and — critically — the claims it must NOT make. The plan is data, never
// prose; both the local planner and the AgentScope orchestrator must emit it
// before any run.
import type { SourceAnchor } from '../formula/spec'
import type { FormulaAnalysis } from '../formula/analyze'
import type { ScientificSkill } from './registry'

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
  createdAt: number
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
): PlayPlan {
  return {
    planId: nextPlanId(),
    goal: `操作论文公式 ${analysis.latex} 的参数，观察 ${analysis.output ?? '输出'} 如何随之变化`,
    source: { docId: anchor.docId, anchorId: undefined, title: paperTitle },
    variables: [
      ...analysis.params.map<PlayPlanVariable>((p) => ({
        name: p.name,
        role: 'parameter',
        confirmed: true,
      })),
      {
        name: analysis.independent!,
        role: 'independent',
        confirmed: true,
      },
      { name: analysis.output ?? 'y', role: 'output', confirmed: !!analysis.output },
    ],
    assumptions: ['Docling 提取的 LaTeX 与论文排版一致（已过 Cortex 解析校验）'],
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
    createdAt: Date.now(),
  }
}

/** plan for the Kakeya hero demo (skill kakeya.measure) */
export function buildKakeyaPlayPlan(
  params: { deltaExp: number; nTubes: number; packing: number },
  paperTitle: string,
  skill: ScientificSkill,
): PlayPlan {
  return {
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
  }
}
