// Natural-language → structured formula-experiment operations (AGENTS.md §4 v5).
// "如果 a 增大一倍会怎样？" must yield {fork, scale a ×2, rerun, compare} —
// never prose, never model-computed results. Deterministic patterns first;
// an optional Qwen pass (env-only credentials) is validated and clamped:
// values are *parameter configs* the user asked for, not measurements.
export interface FormulaAction {
  op: 'fork' | 'set' | 'scale' | 'rerun' | 'compare'
  param?: string
  /** set: absolute value · scale: multiplicative factor (clamped 0.1–10) */
  value?: number
}

function clampFactor(v: number): number {
  return Math.min(10, Math.max(0.1, v))
}

const NUM = String.raw`(-?\d+(?:\.\d+)?)`

/** pick the param a Chinese/English phrase refers to, or the only param */
function resolveParam(q: string, params: string[]): string | null {
  for (const p of params) if (new RegExp(`\\b${p}\\b`).test(q) || q.includes(`参数${p}`)) return p
  if (params.length === 1) return params[0]
  return null
}

export function planFormulaQuestion(q: string, params: string[]): FormulaAction[] | null {
  if (params.length === 0) return null
  const param = resolveParam(q, params)

  let scale: number | null = null
  if (/(增大|增加|放大|加倍|翻倍)(一倍|1倍|两倍|2倍)?|double/i.test(q)) scale = 2
  else if (/(增大|增加|放大)(三倍|3倍)|triple/i.test(q)) scale = 3
  else if (/(减少一半|减半|减到一半|缩小一半|halve)/.test(q)) scale = 0.5
  else {
    const m = q.match(new RegExp(String.raw`(乘以|×|\\times)\s*${NUM}`))
    if (m) scale = clampFactor(parseFloat(m[2]))
  }
  if (scale !== null) {
    const p = param ?? params[0]
    return [
      { op: 'fork' },
      { op: 'scale', param: p, value: clampFactor(scale) },
      { op: 'rerun' },
      { op: 'compare' },
    ]
  }

  const setMatch = q.match(new RegExp(String.raw`(设为|改为|置为|调整为|set(?:\s+to)?)\s*${NUM}`))
  if (setMatch) {
    const p = param ?? params[0]
    return [
      { op: 'fork' },
      { op: 'set', param: p, value: parseFloat(setMatch[2]) },
      { op: 'rerun' },
      { op: 'compare' },
    ]
  }

  if (/(对比|比较|compare)/i.test(q)) return [{ op: 'compare' }]
  if (/(重算|重新计算|rerun|recompute)/i.test(q)) return [{ op: 'rerun' }]
  return null
}

/** validate an LLM-produced action list (whitelist + clamp), null on any breach */
export function validateFormulaActions(raw: unknown, params: string[]): FormulaAction[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 8) return null
  const out: FormulaAction[] = []
  for (const a of raw as Array<Record<string, unknown>>) {
    if (typeof a?.op !== 'string') return null
    switch (a.op) {
      case 'fork':
      case 'rerun':
      case 'compare':
        out.push({ op: a.op })
        break
      case 'set':
      case 'scale': {
        if (typeof a.param !== 'string' || !params.includes(a.param)) return null
        if (typeof a.value !== 'number' || !Number.isFinite(a.value)) return null
        if (a.value === 0 && a.op === 'scale') return null
        out.push({
          op: a.op,
          param: a.param,
          value: a.op === 'scale' ? clampFactor(a.value) : Math.min(50, Math.max(-50, a.value)),
        })
        break
      }
      default:
        return null
    }
  }
  return out
}

/** entry: optional Qwen, deterministic fallback */
export async function planFormulaActions(
  q: string,
  params: string[],
  llm?: (q: string) => Promise<unknown>,
): Promise<FormulaAction[] | null> {
  if (llm) {
    try {
      const raw = await llm(q)
      const v = validateFormulaActions(raw, params)
      if (v) return v
    } catch {
      /* fall back */
    }
  }
  return planFormulaQuestion(q, params)
}
