// Natural-language → structured formula-experiment operations (AGENTS.md §4 v5).
// "如果 a 增大一倍会怎样？" must yield {fork, scale a ×2, rerun, compare} —
// never prose, never model-computed results. Deterministic patterns first;
// an optional Qwen pass (env-only credentials) is validated without changing requested values:
// values are *parameter configs* the user asked for, not measurements.
export interface FormulaAction {
  op: 'fork' | 'set' | 'scale' | 'rerun' | 'compare'
  param?: string
  /** set: absolute value · scale: multiplicative factor (validated against the model at execution) */
  value?: number
}

const NUM = String.raw`(-?\d+(?:\.\d+)?)`

/** Explicit offline grammar: reject ambiguity instead of guessing another experiment. */
export function planFormulaQuestion(q: string, params: string[]): FormulaAction[] | null {
  const text = q.trim()
  if (/^(对比|比较|compare)[？?。]?$/i.test(text)) return [{ op: 'compare' }]
  if (/^(重算|重新计算|rerun|recompute)[？?。]?$/i.test(text)) return [{ op: 'rerun' }]
  for (const param of [...params].sort((a, b) => b.length - a.length)) {
    const escaped = param.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = text.match(new RegExp(`^(?:如果\\s*|把\\s*)?${escaped}\\s*(.+?)(?:会怎样|会怎么样)?[？?。]?$`))
    if (!match) continue
    const action = match[1].trim()
    let op: 'set' | 'scale' = 'scale'
    let value: number
    if (/^(?:(?:增大|增加|放大)(?:一倍|1倍|两倍|2倍)|加倍|翻倍|double)$/i.test(action)) value = 2
    else if (/^(?:(?:增大|增加|放大)(?:三倍|3倍)|triple)$/i.test(action)) value = 3
    else if (/^(?:减少一半|减半|减到一半|缩小一半|halve)$/i.test(action)) value = 0.5
    else {
      const factor = action.match(new RegExp(String.raw`^(?:乘以|×|\\times)\s*${NUM}$`))
      const set = action.match(new RegExp(String.raw`^(?:设为|改为|置为|调整为|=|set(?:\s+to)?)\s*${NUM}$`, 'i'))
      if (factor) value = Number(factor[1])
      else if (set) { op = 'set'; value = Number(set[1]) }
      else return null
    }
    if (!Number.isFinite(value)) return null
    return [{ op: 'fork' }, { op, param, value }, { op: 'rerun' }, { op: 'compare' }]
  }
  return null
}

/** validate an LLM-produced action list (whitelist; model bounds checked by executor), null on any breach */
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
          value: a.value,
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
