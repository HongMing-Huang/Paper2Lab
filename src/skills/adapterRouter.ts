// Adapter Router (AGENTS.md §4 v5): reads the Docling output and decides which
// EXISTING interactive module fits this paper — 'kakeya' (Wang–Zahl 3D lab) or
// the generic 'formula' explorer. Deterministic heuristic by default; an
// optional Qwen call (env-only credentials) may pick the formula *index* but
// can never inject latex or numbers — the index is re-validated locally.
import { analyzeFormula } from '../formula/analyze'
import { docText, formulasOf, type IngestedDoc, type IngestedItem } from '../ingest/doclingSchema'
import { llmConfigFromEnv, type LlmPlannerConfig } from './llmPlanner'

export interface AdapterDecision {
  adapter: 'kakeya' | 'formula'
  reason: string
  /** the formula to lift out of the paper (formula adapter only) */
  keyFormula: IngestedItem | null
}

const KAKEYA_KEYWORDS = ['kakeya', 'besicovitch', 'besicovitch–rado', 'kakeya set', 'kakeya conjecture']

/** score a formula for first-Play suitability: plottable, 1–3 params, display-sized */
function formulaScore(item: IngestedItem): number {
  const a = analyzeFormula(item.latex!)
  if (!a.ok || !a.independent || a.params.length < 1 || a.params.length > 3) return -1
  let s = a.params.length * 2 + (a.output ? 1 : 0)
  if (item.bbox.w > 0.25) s += 2 // display formula, not inline
  return s
}

export function routeAdapter(doc: IngestedDoc): AdapterDecision {
  const hay = `${doc.title}\n${docText(doc)}`.toLowerCase()
  if (KAKEYA_KEYWORDS.some((k) => hay.includes(k))) {
    return {
      adapter: 'kakeya',
      reason: '论文主题命中 Kakeya/Besicovitch — 使用 Wang–Zahl 3D Kakeya 专用 Adapter',
      keyFormula: null,
    }
  }
  const formulas = formulasOf(doc)
  const ranked = formulas
    .map((f) => ({ f, s: formulaScore(f) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
  if (ranked.length > 0) {
    return {
      adapter: 'formula',
      reason: `检测到 ${formulas.length} 个公式 — 展开评分最高的可操作公式`,
      keyFormula: ranked[0].f,
    }
  }
  return { adapter: 'formula', reason: '未检测到可操作公式', keyFormula: null }
}

// ---- optional Qwen routing (index-only contract) --------------------------

export async function routeAdapterWithLlm(
  doc: IngestedDoc,
  cfg?: LlmPlannerConfig | null,
): Promise<AdapterDecision> {
  const fallback = routeAdapter(doc)
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
              'You route an ingested paper to an interactive module. ' +
              'Return ONLY JSON: {"adapter":"kakeya"|"formula","keyFormulaIndex":integer|null,"reason":string}. ' +
              'kakeya only for Kakeya-set/Besicovitch tube geometry papers. ' +
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
      adapter?: string
      keyFormulaIndex?: number | null
      reason?: string
    }
    if (parsed?.adapter === 'kakeya') {
      return { adapter: 'kakeya', reason: parsed.reason ?? 'Qwen: Kakeya 主题', keyFormula: null }
    }
    if (parsed?.adapter === 'formula' && typeof parsed.keyFormulaIndex === 'number') {
      const f = formulas[parsed.keyFormulaIndex]
      if (f && formulaScore(f) >= 0) {
        return { adapter: 'formula', reason: parsed.reason ?? 'Qwen 选择的关键公式', keyFormula: f }
      }
    }
  } catch {
    /* fall through to deterministic */
  }
  return fallback
}
