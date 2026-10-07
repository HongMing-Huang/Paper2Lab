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
import { llmConfigFromEnv, type LlmPlannerConfig } from './llmPlanner'
import {
  buildFitBinding, buildFormulaBinding, buildKakeyaBinding, buildOdeBinding,
  detectData, detectOde, type PaperBinding,
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
  // fit (the goal-table class "波形/频率/衰减/函数拟合").
  const ode = detectOde(doc)
  const hasDerivative = ode.matched.includes('latex-derivative')
  const data = detectData(doc)
  if (ode.isOde && (hasDerivative || !data)) {
    if (ode.hasInitial) {
      return {
        status: 'ok',
        adapter: 'ode',
        reason: `检出动力学方程与初值（${Object.entries(ode.initials).map(([k, v]) => `${k}(0)=${v}`).join(', ')}）→ 相平面初值实验`,
        keyFormula: null,
        binding: buildOdeBinding(doc, ode),
      }
    }
    return {
      status: 'needs-info',
      adapter: 'ode',
      reason: '检出动力学内容，但论文文本未给出状态初值——实验无法诚实启动',
      keyFormula: null,
      questions: [
        '论文未写明状态初值（形如 x(0)=…、y_0=…）。请补充各状态的 t=0 取值。',
        '若论文确实不含初值（纯理论结果），请指出该结果属于哪一类（平衡点/稳定性/周期解），以便绑定对应的观测量。',
      ],
      binding: buildOdeBinding(doc, { ...ode, hasInitial: false, initials: {} }),
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

// ---- optional Qwen routing (index-only contract) --------------------------

export async function routeAdapterWithLlm(
  doc: IngestedDoc,
  cfg?: LlmPlannerConfig | null,
): Promise<AdapterDecision> {
  const fallback = routeAdapter(doc)
  // no LLM can conjure missing paper content — only a formula-index refinement
  // is possible, and only when the deterministic pass already found formulas
  if (fallback.status !== 'ok' || fallback.adapter !== 'formula') return fallback
  const config = cfg === undefined ? llmConfigFromEnv() : cfg
  if (!config) return fallback
  const formulas = formulasOf(doc)
  const digest = {
    title: doc.title,
    formulas: formulas.map((f, i) => ({ i, latex: f.latex })),
    textHead: docText(doc).slice(0, 1500),
  }
  try {
    const res = await fetch(`${config.endpoint.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: 'system',
            content:
              'You refine the formula choice for an ingested paper. ' +
              'Return ONLY JSON: {"keyFormulaIndex":integer,"reason":string}. ' +
              'keyFormulaIndex must index the provided formulas array. No other fields.',
          },
          { role: 'user', content: JSON.stringify(digest) },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
      }),
    })
    if (!res.ok) return fallback
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? 'null') as {
      keyFormulaIndex?: number
      reason?: string
    }
    if (typeof parsed?.keyFormulaIndex === 'number') {
      const f = formulas[parsed.keyFormulaIndex]
      if (f && formulaScore(f) >= 0) {
        return {
          ...fallback,
          reason: parsed.reason ?? 'Qwen 选择的关键公式',
          keyFormula: f,
          binding: detectData(doc) ? buildFitBinding(doc, f) : buildFormulaBinding(doc, f),
        }
      }
    }
  } catch {
    /* fall through to deterministic */
  }
  return fallback
}
