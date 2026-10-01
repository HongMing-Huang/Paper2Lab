// Formula analysis: LaTeX (from Docling) → MathJSON → variable classification.
// No regex LaTeX parsing: everything goes through the Cortex Compute Engine.
import type { MathJsonExpression } from '@cortex-js/compute-engine'
import { getEngine } from './engine'

/** preferred independent-variable names, in order */
const INDEPENDENT_PREFERENCE = ['x', 't', 'θ', 'theta', 'u', 's'] as const

/** default plotting domain — registered config, not evidence */
const TRIG_DOMAIN: [number, number] = [-7, 7]
const PLAIN_DOMAIN: [number, number] = [-5, 5]

export interface ParamSpec {
  name: string
  default: number
  min: number
  max: number
  step: number
}

export interface FormulaAnalysis {
  ok: boolean
  error?: string
  /** original LaTeX as given (Docling output) */
  latex: string
  /** whole-formula MathJSON (the `Equal` node when present) */
  mathjson: MathJsonExpression
  /** right-hand side MathJSON — the expression actually plotted/compiled */
  rhs: MathJsonExpression
  /** RHS LaTeX (what MathLive shows next to the chart) */
  rhsLatex: string
  /** dependent-variable name when the formula is `name = …` with a plain symbol LHS */
  output: string | null
  /** the plotting independent variable */
  independent: string | null
  /** tunable parameters (free variables minus the independent one) */
  params: ParamSpec[]
  /** suggested x domain for plotting */
  domain: [number, number]
}

/** scan MathJSON for trig heads → prefer a 2π-friendly domain */
function containsTrig(e: MathJsonExpression): boolean {
  if (Array.isArray(e)) {
    const head = e[0]
    if (typeof head === 'string' && /^(Sin|Cos|Tan|Sec|Csc|Cot)$/.test(head)) return true
    return (e.slice(1) as unknown[]).some((x) => containsTrig(x as MathJsonExpression))
  }
  if (e && typeof e === 'object' && 'fn' in (e as Record<string, unknown>)) {
    return containsTrig((e as { fn: unknown }).fn as MathJsonExpression)
  }
  return false
}

const PARAM_DEFAULTS: Omit<ParamSpec, 'name'> = { default: 1, min: -5, max: 5, step: 0.05 }

export function analyzeFormula(latex: string): FormulaAnalysis {
  const ce = getEngine()
  // Docling's formula model appends sentence punctuation (e.g. "y = a \sin ( b x ) .") — strip it
  const trimmed = latex.trim().replace(/[.;,]+$/, '').trim()
  const base: FormulaAnalysis = {
    ok: false,
    latex: trimmed,
    mathjson: trimmed as unknown as MathJsonExpression,
    rhs: trimmed as unknown as MathJsonExpression,
    rhsLatex: trimmed,
    output: null,
    independent: null,
    params: [],
    domain: PLAIN_DOMAIN,
  }
  if (!trimmed) return { ...base, error: 'empty formula' }

  let expr
  try {
    expr = ce.parse(trimmed)
  } catch (err) {
    return { ...base, error: `parse failed: ${String(err)}` }
  }
  if (expr.errors.length > 0 || !expr.isValid) {
    return { ...base, error: `invalid LaTeX: ${expr.errors.map(String).join('; ') || 'parse error'}` }
  }
  const mathjson = expr.json as MathJsonExpression

  // split `lhs = rhs` on the Equal head (engine-canonical, not string surgery)
  let lhs: MathJsonExpression | null = null
  let rhs: MathJsonExpression = mathjson
  if (Array.isArray(mathjson) && mathjson[0] === 'Equal' && mathjson.length === 3) {
    lhs = mathjson[1] as MathJsonExpression
    rhs = mathjson[2] as MathJsonExpression
  }
  if (Array.isArray(rhs) && rhs.length === 0) return { ...base, error: 'empty right-hand side' }

  const rhsExpr = ce.box(rhs)
  const free = [...rhsExpr.freeVariables]

  const independent =
    INDEPENDENT_PREFERENCE.find((name) => free.includes(name)) ??
    (free.length === 1 ? free[0] : null)
  if (!independent) {
    return { ...base, error: 'no independent variable found' }
  }
  const paramNames = free.filter((v) => v !== independent).sort((a, b) => a.localeCompare(b))

  // `y = …` → plain symbol LHS; `u(t) = …` → function-application LHS ["u","t"]
  let output: string | null = null
  if (typeof lhs === 'string') output = lhs
  else if (Array.isArray(lhs) && lhs.length === 2 && typeof lhs[0] === 'string') output = lhs[0]

  return {
    ok: true,
    latex: trimmed,
    mathjson,
    rhs,
    rhsLatex: rhsExpr.latex,
    output,
    independent,
    params: paramNames.map((name) => ({ name, ...PARAM_DEFAULTS })),
    domain: containsTrig(rhs) ? TRIG_DOMAIN : PLAIN_DOMAIN,
  }
}
