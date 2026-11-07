// CLI-151 结果一/二 — 把用户选中的论文公式变成"有来源、缺失条件明确"的
// 数学请求候选，并按数学结构（不是标题/关键词/固定 mechanicId）匹配已实现
// 的 Skill。规则：
//   - 公式只来自结构化解析（Docling/VLM 的公式条目），文本层碎片不确认公式；
//   - 每个取值都有来源：论文原文行（页码+parser+原句）或用户明确提供（记为
//     实验假设）；模型/AI 给的数值不算论文证据，这里不接收；
//   - 缺初值/缺参数/缺区间 → needs_input；转写无法解析、右端显含 t（非自治）、
//     关系式/不等式 → unsupported，附具体字段与原因；从不补默认值。
import { getEngine } from '../formula/engine'
import { analyzeFormula } from '../formula/analyze'
import { GREEK_TO_NAME } from '../skills/paperSpec'
import { ODE_LHS } from '../skills/paperBinding'

/** a structured formula from a page parse (Docling/VLM), with its anchor */
export interface FormulaFragment {
  id: string
  page: number
  latex: string
  parser: string
  bbox?: { x: number; y: number; w: number; h: number }
}

/** a prose line used as evidence for stated values (pdf.js or parsed text) */
export interface ProseLine {
  id: string
  page: number
  text: string
  parser: string
}

export type ValueSource =
  | { kind: 'paper'; page: number; lineId: string; parser: string; quote: string }
  | { kind: 'user' }
  | { kind: 'missing' }

export interface ValueField {
  name: string
  value: number | null
  source: ValueSource
}

export interface CandidateIssue {
  field: string
  level: 'needs_input' | 'unsupported'
  message: string
}

export interface MathRequestCandidate {
  skill: 'model.solve' | 'formula.plot'
  structure: 'autonomous-ode' | 'explicit-function'
  equations: Array<{ fragmentId: string; page: number; parser: string; latex: string; state?: string }>
  states: string[]
  independent: string
  params: ValueField[]
  initials: ValueField[]
  span: { value: [number, number] | null; source: ValueSource }
  observables: string[]
  /** transcription normalizations applied before compiling (shown, never silent) */
  notes: string[]
  issues: CandidateIssue[]
  status: 'ready' | 'needs_input' | 'unsupported'
}

export interface UserChoices {
  params?: Record<string, number>
  initials?: Record<string, number>
  span?: [number, number] | null
  /** user-corrected LaTeX per formula fragment id */
  latex?: Record<string, string>
}

const DERIVATIVE_LHS = [...ODE_LHS, /\\dot\s+([a-zA-Z])\s*=/]
const RELATIONAL = /\\(?:le|leq|ge|geq|neq|ne|approx|sim|lt|gt|ll|gg|subset|in)(?![a-zA-Z])|[<>]/
/** heads that are FUNCTIONS/CONSTANTS in MathJSON, never a paper symbol */
const NON_SYMBOL_HEADS = new Set([
  'Add', 'Negate', 'Multiply', 'Divide', 'Power', 'Subtract', 'Equal', 'Tuple', 'Sequence', 'LessEqual', 'GreaterEqual', 'Less', 'Greater', 'Approximately', 'Sin', 'Cos', 'Tan', 'Sec', 'Csc', 'Cot', 'Sinh', 'Cosh', 'Tanh', 'Arcsin', 'Arccos', 'Arctan', 'Exp', 'Log', 'Ln', 'Sqrt', 'Abs', 'Sum', 'Product', 'Integrate', 'Derivative', 'Pi', 'ExponentialE', 'ImaginaryUnit', 'Complex', 'Real', 'Rational', 'Gamma', 'EulerGamma',
])
/** greek letter names a paper uses as SYMBOLS (π stays the constant) */
const GREEK_SYMBOLS = [...new Set(Object.values(GREEK_TO_NAME))].filter((n) => n !== 'pi').concat(['zeta', 'eta', 'nu', 'xi', 'chi', 'upsilon', 'iota', 'varepsilon', 'varphi', 'vartheta'])
const GREEK_MACRO = new RegExp(`\\\\(${GREEK_SYMBOLS.join('|')})(?![a-zA-Z])`, 'g')

/** what the parse would do to a paper symbol, made explicit before it runs:
 *  greek macros become plain symbols (Cortex folds a bare \gamma into the
 *  Euler–Mascheroni constant in some contexts) */
function protectGreek(latex: string): string {
  return latex.replace(GREEK_MACRO, (_m, name: string) => `\\mathrm{${name}}`)
}

interface ParsedSymbols {
  symbols: string[]
  /** the parse turned something into a mathematical CONSTANT (e, i) */
  constants: Array<'e' | 'i'>
  error: string | null
}

/** every plain symbol in the parsed MathJSON tree (heads excluded) — the
 *  same parse the executor compiles, after the same greek protection */
function symbolsOfParsed(latex: string): ParsedSymbols {
  try {
    const box = getEngine().parse(protectGreek(latex))
    if (box.errors.length > 0 || !box.isValid) return { symbols: [], constants: [], error: box.errors.map(String).join('; ') || 'parse error' }
    const out = new Set<string>()
    const walk = (e: unknown, isHead: boolean): void => {
      if (typeof e === 'string') {
        if (!isHead && !NON_SYMBOL_HEADS.has(e)) out.add(e)
      } else if (Array.isArray(e)) {
        e.forEach((x, i) => walk(x, i === 0 && typeof x === 'string'))
      } else if (e && typeof e === 'object' && 'sym' in (e as object)) {
        walk((e as { sym: unknown }).sym, false)
      }
    }
    walk(box.json, false)
    const json = JSON.stringify(box.json)
    const constants: Array<'e' | 'i'> = []
    if (json.includes('"ExponentialE"')) constants.push('e')
    if (json.includes('"ImaginaryUnit"') || json.includes('"Complex"')) constants.push('i')
    return { symbols: [...out].map((s) => GREEK_TO_NAME[s] ?? s), constants, error: null }
  } catch (err) {
    return { symbols: [], constants: [], error: String(err) }
  }
}

/** the parse's constant interpretations, surfaced instead of silent */
function constantIssues(where: string, parsed: ParsedSymbols, issues: CandidateIssue[], notes: string[]): void {
  if (parsed.constants.includes('e')) notes.push(`${where}：e 按欧拉数 e≈2.718 处理；若论文中 e 是参数，请在公式里改用其它字母`)
  if (parsed.constants.includes('i')) issues.push({ field: where, level: 'unsupported', message: `${where}含虚数单位 i——现有内核只做实数计算` })
}

/** docling/VLM trailing sentence punctuation and equation tags are not math;
 *  unicode greek becomes the macro form the executor binds by name */
export function cleanLatex(latex: string): string {
  return latex
    .trim()
    .replace(/[α-ωΑ-Ωµϵϕϰ]/g, (ch) => (GREEK_TO_NAME[ch] ? `\\${GREEK_TO_NAME[ch]} ` : ch))
    .replace(/\\tag\s*\{[^}]*\}\s*$/, '')
    .replace(/\\(?:quad|qquad)\s*\(\s*\d+\s*\)\s*$/, '')
    .replace(/[\s,.;]+$/, '')
    .trim()
}

/** a trailing "(N)" is usually an equation number, but could be math
 *  (`g(1)`): it is removed only when separated by whitespace, and always
 *  reported so the user can put it back */
function stripEquationNumber(latex: string): { latex: string; removed: string | null } {
  const m = latex.match(/\s+\(\s*(\d+)\s*\)\s*$/)
  if (!m) return { latex, removed: null }
  return { latex: latex.slice(0, m.index).replace(/[\s,.;]+$/, '').trim(), removed: `(${m[1]})` }
}

function derivativeState(latex: string): string | null {
  for (const p of DERIVATIVE_LHS) {
    const m = latex.match(p)
    if (m) return m[1]
  }
  return null
}

function rhsOf(latex: string): string {
  return latex.slice(latex.indexOf('=') + 1).trim()
}

const NUMBER = '(-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?)'

function symbolPattern(name: string): string {
  const greek = Object.entries(GREEK_TO_NAME)
    .filter(([, n]) => n === name)
    .map(([ch]) => ch)
  const alts = [name.length > 1 ? `\\\\${name}` : name, ...greek]
  return `(?:${alts.join('|')})`
}

/** first prose line stating `name = number` — the paper's own value, verbatim */
function statedValue(name: string, lines: ProseLine[], initial: boolean): ValueField {
  const sym = symbolPattern(name)
  const lhs = initial ? `${sym}\\s*(?:\\(\\s*0\\s*\\)|_\\{?0\\}?)` : sym
  const re = new RegExp(`(?<![A-Za-z0-9_\\\\])${lhs}\\s*=\\s*${NUMBER}(?![\\w(])`)
  for (const line of lines) {
    const m = line.text.match(re)
    if (m) {
      return {
        name,
        value: Number(m[1]),
        source: { kind: 'paper', page: line.page, lineId: line.id, parser: line.parser, quote: line.text.slice(0, 200) },
      }
    }
  }
  return { name, value: null, source: { kind: 'missing' } }
}

function resolveValue(name: string, lines: ProseLine[], initial: boolean, user?: Record<string, number>): ValueField {
  const given = user?.[name]
  if (typeof given === 'number' && Number.isFinite(given)) return { name, value: given, source: { kind: 'user' } }
  return statedValue(name, lines, initial)
}

/** keep a declared multi-letter symbol (\gamma, \beta…) a variable: Cortex
 *  folds `\gamma` into the Euler–Mascheroni constant otherwise. Same rewrite
 *  the model executor applies to declared names. */
function protectSymbols(latex: string, names: string[]): string {
  let out = latex
  for (const n of names) {
    if (n.length > 1 && /^[A-Za-z]+$/.test(n)) out = out.replace(new RegExp(`\\\\${n}(?![a-zA-Z])`, 'g'), `\\mathrm{${n}}`)
  }
  return out
}

function finish(c: Omit<MathRequestCandidate, 'status'>): MathRequestCandidate {
  const status = c.issues.some((i) => i.level === 'unsupported')
    ? 'unsupported'
    : c.issues.length > 0 || c.params.some((p) => p.value === null) || c.initials.some((p) => p.value === null) || c.span.value === null
      ? 'needs_input'
      : 'ready'
  return { ...c, status }
}

function spanOf(user: UserChoices): MathRequestCandidate['span'] {
  const s = user.span
  if (s && Number.isFinite(s[0]) && Number.isFinite(s[1]) && s[1] > s[0]) return { value: [s[0], s[1]], source: { kind: 'user' } }
  return { value: null, source: { kind: 'missing' } }
}

/**
 * Build the request candidate for the formula the user selected.
 * `formulas` are all structured formulas parsed so far (an ODE system's other
 * equations live there); `prose` is the text evidence for stated values.
 */
export function buildCandidate(
  selected: FormulaFragment,
  formulas: FormulaFragment[],
  prose: ProseLine[],
  user: UserChoices = {},
): MathRequestCandidate {
  const notes: string[] = []
  const issues: CandidateIssue[] = []
  const latexOf = (f: FormulaFragment) => {
    const corrected = user.latex?.[f.id]
    const cleaned = cleanLatex(corrected ?? f.latex)
    if (corrected !== undefined) return cleaned // the user's own text: no further rewriting
    const { latex, removed } = stripEquationNumber(cleaned)
    if (removed) notes.push(`第 ${f.page} 页公式末尾的 ${removed} 按公式编号移除；若它是公式的一部分，请在下方改回`)
    return latex
  }
  const selectedLatex = latexOf(selected)
  // STRUCTURE comes from the parsed transcription; the user's corrections
  // change content, never silently drop an equation out of the system
  const state = derivativeState(cleanLatex(selected.latex))

  if (state) {
    // the selected line is one equation of a system: collect every derivative
    // equation the parse found (first per state wins), selected one first
    const byState = new Map<string, FormulaFragment>()
    for (const f of [selected, ...formulas]) {
      const s = derivativeState(cleanLatex(f.latex))
      if (s && !byState.has(s)) byState.set(s, f)
    }
    const states = [...byState.keys()]
    const equations = [...byState.entries()].map(([s, f]) => ({ fragmentId: f.id, page: f.page, parser: f.parser, latex: latexOf(f), state: s }))
    for (const e of equations) {
      if (derivativeState(e.latex) !== e.state) {
        issues.push({ field: `equation:${e.fragmentId}`, level: 'unsupported', message: `第 ${e.page} 页这条方程改写后左端不再是 ${e.state} 的导数（应形如 \\dot{${e.state}} = …）` })
      }
      if (RELATIONAL.test(e.latex)) {
        issues.push({ field: `equation:${e.fragmentId}`, level: 'unsupported', message: `第 ${e.page} 页「${e.latex}」是关系式/不等式，不是微分方程` })
      }
    }
    const rhs: Record<string, string> = Object.fromEntries(equations.map((e) => [e.state, rhsOf(e.latex)]))
    const symbols = new Set<string>()
    for (const e of equations) {
      const parsed = symbolsOfParsed(rhsOf(e.latex))
      if (parsed.error) {
        issues.push({ field: `equation:${e.fragmentId}`, level: 'unsupported', message: `第 ${e.page} 页「${e.latex}」无法解析（可能是误转写）：${parsed.error}——请对照原文纠正 LaTeX` })
      }
      constantIssues(`第 ${e.page} 页 ${e.state} 的方程`, parsed, issues, notes)
      for (const s of parsed.symbols) symbols.add(s)
    }
    if (symbols.has('t')) {
      issues.push({ field: 'rhs', level: 'unsupported', message: '右端显含 t（非自治系统）——现有 model.solve 只积分自治系统，不做静默改写' })
    }
    const params = [...symbols].filter((s) => s !== 't' && !states.includes(s)).sort()
    for (const s of states) {
      if (!rhs[s]) issues.push({ field: `rhs:${s}`, level: 'unsupported', message: `状态 ${s} 的方程右端为空` })
    }
    return finish({
      skill: 'model.solve',
      structure: 'autonomous-ode',
      equations,
      states,
      independent: 't',
      params: params.map((p) => resolveValue(p, prose, false, user.params)),
      initials: states.map((s) => resolveValue(s, prose, true, user.initials)),
      span: spanOf(user),
      observables: [...states.map((s) => `${s}(t)`), 'min/max', 'period'],
      notes: equations.length < 2 && states.length === 1 ? [...notes, '只识别出一条导数方程（单状态系统）；如论文还有其他方程，请先精读其所在页'] : notes,
      issues,
    })
  }

  // explicit function y = f(x; params)
  const equations = [{ fragmentId: selected.id, page: selected.page, parser: selected.parser, latex: selectedLatex }]
  if (RELATIONAL.test(selectedLatex)) {
    issues.push({ field: `equation:${selected.id}`, level: 'unsupported', message: '这是关系式/不等式，不是可采样的显式函数 y = f(x)' })
  }
  // same greek protection the parse scan uses, so γ/β are variables here too
  const analysis = analyzeFormula(protectGreek(selectedLatex))
  if (!analysis.ok) {
    issues.push({ field: `equation:${selected.id}`, level: 'unsupported', message: `第 ${selected.page} 页公式无法作为显式函数分析：${analysis.error ?? '未知原因'}——请对照原文纠正 LaTeX` })
  }
  const independent = analysis.independent ?? 'x'
  const scanned = symbolsOfParsed(selectedLatex)
  constantIssues(`第 ${selected.page} 页公式`, scanned, issues, notes)
  const analyzerNames = analysis.ok ? analysis.params.map((p) => p.name) : []
  // a plain symbol in the tree the analyzer did not list would compile as a
  // constant — surface it as a missing parameter instead of a silent number
  const extra = analysis.ok ? scanned.symbols.filter((s) => s !== independent && s !== analysis.output && !analyzerNames.includes(s)) : []
  if (extra.length > 0) notes.push(`符号 ${extra.join(', ')} 不在分析出的自由符号中——按缺失参数列出`)
  const names = [...new Set([...analyzerNames, ...extra])]
  return finish({
    skill: 'formula.plot',
    structure: 'explicit-function',
    equations,
    states: [],
    independent,
    params: names.map((p) => resolveValue(p, prose, false, user.params)),
    initials: [],
    span: spanOf(user),
    observables: [analysis.output ? `${analysis.output}(${independent})` : `f(${independent})`, 'peak', '∫|y|'],
    notes,
    issues,
  })
}

/** the registry input for a READY candidate (throws when it is not ready) */
export function requestInput(c: MathRequestCandidate): Record<string, unknown> {
  if (c.status !== 'ready' || !c.span.value) throw new Error(`candidate is ${c.status}`)
  const params = Object.fromEntries(c.params.map((p) => [p.name, p.value as number]))
  if (c.skill === 'model.solve') {
    return {
      states: c.states,
      rhs: Object.fromEntries(c.equations.map((e) => [e.state as string, rhsOf(e.latex)])),
      params,
      initialState: Object.fromEntries(c.initials.map((p) => [p.name, p.value as number])),
      tSpan: c.span.value,
    }
  }
  const names = c.params.map((p) => p.name)
  return {
    expression: protectSymbols(protectGreek(c.equations[0].latex), names),
    parameters: names,
    independent: c.independent,
    range: c.span.value,
    values: params,
    samples: 401,
  }
}
