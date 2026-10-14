// Adapter Router (#22): reads the Docling output and decides which EXISTING
// interactive module fits this paper — and, critically, what to do when NONE
// does. Three terminal states:
//   ok          — the paper's own equations/conditions/objects drive a module
//   needs-info  — the paper's type is clear but required conditions (e.g.
//                 initial values) are missing → ask, never invent
//   out-of-scope — no equations, no data → explicit rejection, never a
//                 keyword-matched fixed demo or an empty formula explorer
// Deterministic by default; the optional Qwen call may only pick the formula
// *index* (re-validated locally) and can never invent bindings or numbers.
import { analyzeFormula } from '../formula/analyze'
import { docText, formulasOf, type IngestedDoc, type IngestedItem } from '../ingest/doclingSchema'
import {
  buildFitBinding, buildFormulaBinding, buildKakeyaBinding, buildOdeBinding,
  detectData, detectOde, odeSystemOf, type PaperBinding,
} from './paperBinding'

export interface AdapterDecisionOk {
  status: 'ok'
  adapter: 'formula' | 'kakeya' | 'ode'
  reason: string
  /** the formula to lift out of the paper (formula adapter only) */
  keyFormula: IngestedItem | null
  /** the paper-content binding (anchors→question→equations→conditions→
   * objects→observables→engine/view) every downstream surface must obey */
  binding: PaperBinding
}

export interface AdapterDecisionNeedsInfo {
  status: 'needs-info'
  adapter: 'formula' | 'kakeya' | 'ode'
  reason: string
  keyFormula: IngestedItem | null
  /** concrete questions the user must answer before the experiment can run */
  questions: string[]
  /** the partial binding — what the experiment WOULD be once answered */
  binding: PaperBinding
}

export interface AdapterDecisionOutOfScope {
  status: 'out-of-scope'
  adapter: 'none'
  reason: string
  keyFormula: null
  binding: null
}

export type AdapterDecision = AdapterDecisionOk | AdapterDecisionNeedsInfo | AdapterDecisionOutOfScope

const KAKEYA_KEYWORDS = ['kakeya', 'besicovitch', 'besicovitch–rado', 'kakeya set', 'kakeya conjecture']

/** score a formula for first-Play suitability: plottable, 1–3 params, display-sized */
function formulaScore(item: IngestedItem): number {
  const a = analyzeFormula(item.latex!)
  if (!a.ok || !a.independent || a.params.length < 1 || a.params.length > 3) return -1
  let s = a.params.length * 2 + (a.output ? 1 : 0)
  if (item.bbox.w > 0.25) s += 2 // display formula, not inline
  return s
}

function rankFormulas(doc: IngestedDoc): IngestedItem[] {
  return formulasOf(doc)
    .map((f) => ({ f, s: formulaScore(f) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.f)
}

export function routeAdapter(doc: IngestedDoc): AdapterDecision {
  const hay = `${doc.title}\n${docText(doc)}`.toLowerCase()
  if (KAKEYA_KEYWORDS.some((k) => hay.includes(k))) {
    return {
      status: 'ok',
      adapter: 'kakeya',
      reason: '论文主题命中 Kakeya/Besicovitch — 使用 Wang–Zahl 3D Kakeya 专用 Adapter',
      keyFormula: null,
      binding: buildKakeyaBinding(doc),
    }
  }
  // ODE vs FIT ordering: explicit derivative patterns in the paper's own
  // LATEX mean the equations ARE ODEs → phase-plane. Dynamics words alone,
  // combined with data cues, mean the paper fits a model to measurements →
  // fit (the goal-table class "波形/频率/衰减/函数拟合"). Words alone NEVER
  // claim ODE: odeSystemOf only consumes derivative latex, so a keyword-only
  // match would be a guaranteed needs-info dead end — and it stole genuinely
  // formula papers (sample-harmonic: "oscillation" prose + y=a·sin(bx), no
  // \dot, no table) into that dead end since #47's CI.
  const ode = detectOde(doc)
  const hasDerivative = ode.matched.includes('latex-derivative')
  const data = detectData(doc)
  if (hasDerivative) {
    const system = odeSystemOf(doc)
    if (!system) {
      return {
        status: 'needs-info',
        adapter: 'ode',
        reason: '检出动力学内容，但未能从论文公式中识别出两条状态方程（形如 \\dot{x}=…、\\frac{dy}{dt}=…）',
        keyFormula: null,
        questions: [
          '请指出论文中的两条状态方程（每条形如 ẋ=f(x,y)、ẏ=g(x,y)）——系统需要按论文原文编译右端，不能用通用模型顶替。',
        ],
        binding: buildOdeBinding(doc, ode, null),
      }
    }
    const initialsOf = (s: string) => ode.initials[s]
    if (system.states.every((s) => Number.isFinite(initialsOf(s)))) {
      return {
        status: 'ok',
        adapter: 'ode',
        reason: `识别状态方程（${system.states.join(', ')}）与初值（${system.states.map((s) => `${s}(0)=${initialsOf(s)}`).join(', ')}）→ 相平面初值实验`,
        keyFormula: null,
        binding: buildOdeBinding(doc, ode, system),
      }
    }
    const missing = system.states.filter((s) => !Number.isFinite(initialsOf(s)))
    return {
      status: 'needs-info',
      adapter: 'ode',
      reason: '识别出状态方程，但论文文本未给出全部状态的初值——实验无法诚实启动',
      keyFormula: null,
      questions: [
        `论文未写明状态 ${missing.join('/')} 的初值（形如 ${missing[0]}(0)=…）。请补充 t=0 时的取值。`,
        '若论文确实不含初值（纯定性结果），请说明应观察的量（平衡点/稳定性/周期解）。',
      ],
      binding: buildOdeBinding(doc, ode, system),
    }
  }
  const ranked = rankFormulas(doc)
  if (ranked.length > 0) {
    if (data) {
      return {
        status: 'ok',
        adapter: 'formula',
        reason: '检出公式与论文测量数据 — 函数拟合实验（残差为观测量）',
        keyFormula: ranked[0],
        binding: buildFitBinding(doc, ranked[0]),
      }
    }
    return {
      status: 'ok',
      adapter: 'formula',
      reason: `检测到 ${formulasOf(doc).length} 个公式 — 展开评分最高的可操作公式`,
      keyFormula: ranked[0],
      binding: buildFormulaBinding(doc, ranked[0]),
    }
  }
  return {
    status: 'out-of-scope',
    adapter: 'none',
    reason: '论文中未检出可操作的方程、数据表或动力学内容 — 无法生成本产品的实验（明确拒绝，不套固定 Demo）',
    keyFormula: null,
    binding: null,
  }
}

// ---- optional server-side LLM routing (#29) --------------------------------
// The browser holds NO provider keys: the env-configured provider is used
// server-side via POST /api/agent/route, which may return a formula INDEX
// (re-validated below). Any failure keeps the deterministic decision and is
// reported as non-enhanced — never a silent "AI answered".

export async function routeAdapterWithLlm(doc: IngestedDoc): Promise<AdapterDecision> {
  const fallback = routeAdapter(doc)
  // no LLM can conjure missing paper content — only a formula-index refinement
  // is possible, and only when the deterministic pass already found formulas
  if (fallback.status !== 'ok' || fallback.adapter !== 'formula') return fallback
  try {
    const res = await fetch('/api/agent/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: doc.title,
        formulas: formulasOf(doc).map((f) => ({ i: f.id, latex: f.latex })),
        textHead: docText(doc).slice(0, 1500),
      }),
    })
    if (!res.ok) return fallback
    const data = (await res.json()) as { enhanced?: boolean; keyFormulaIndex?: number | null }
    if (data.enhanced !== true || typeof data.keyFormulaIndex !== 'number') return fallback
    const f = formulasOf(doc)[data.keyFormulaIndex]
    if (f && formulaScore(f) >= 0) {
      return {
        ...fallback,
        keyFormula: f,
        binding: detectData(doc) ? buildFitBinding(doc, f) : buildFormulaBinding(doc, f),
      }
    }
  } catch {
    /* server unreachable → deterministic routing (offline product keeps working) */
  }
  return fallback
}
