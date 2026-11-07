// PaperModelSpec (paper-to-model L1, docs/research/paper-to-model-survey.md):
// the SINGLE source of truth for what the paper's math MEANS — question,
// quantities (with roles), equations (classified), and claims. Everything is
// extracted DETERMINISTICALLY from the IngestedDoc here (provenance tagged);
// VLM/user channels fill the same shape later without changing consumers.
// AI never produces numbers here: nominal values only come from the paper's
// own prose/tables, and every field carries its anchor.
import type { IngestedDoc, IngestedItem } from '../ingest/doclingSchema'
import { formulasOf, docText } from '../ingest/doclingSchema'

export type QuantityRole = 'state' | 'parameter' | 'observable' | 'independent'

export interface SpecQuantity {
  name: string
  role: QuantityRole
  /** paper-stated initial value (states only) — PAPER evidence, verbatim */
  initial?: number
  /** free symbols that are neither states nor the independent variable */
  unit?: string
  source?: string // anchorId
}

export interface SpecEquation {
  latex: string
  /** \dot{q}=… / q'=… → governing; q(0)=… → initial; anything else → definition */
  role: 'governing' | 'initial' | 'definition'
  /** state name for governing/initial equations */
  state?: string
  source: string // anchorId
}

export interface SpecClaim {
  statement: string
  /** the text item the sentence was read from (evidence anchor) */
  source?: string
  /** #51 P0-A anchor honesty: 'region' = docling sentence bbox, 'page' =
   * VLM page-level anchor, 'ambiguous' = the sentence could not be bound to
   * a source item (claimed fact, unanchored — never pseudo-precise) */
  anchorPrecision: 'region' | 'page' | 'ambiguous'
}

export interface PaperModelSpec {
  /** the parsed document this comprehension is GROUNDED in — every field
   * below traces back to it via anchor ids (source) or item text */
  paperId: string
  /** comprehension schema version — bumps when extraction semantics change;
   * consumers can safely cache/migrate by (paperId, version) */
  version: 1
  /** epoch ms of extraction — a re-parse produces a NEW spec, the old one's
   * runs keep pointing at the old anchors (spec is immutable per version) */
  extractedAt: number
  /** the paper's research question: title + first abstract-ish sentence */
  question: string
  quantities: SpecQuantity[]
  equations: SpecEquation[]
  claims: SpecClaim[]
  /** all fields here were derived deterministically from the parsed doc */
  provenance: 'deterministic'
}

/** \dot{q} / \dot q / q' / dq/dt → the state name being differentiated */
const DERIVATIVE_STATE = /\\dot\s*\{\s*([a-zA-Z])\s*\}|\\dot\s+([a-zA-Z])\b|([a-zA-Z])\s*'/g
/** LaTeX commands that are NOT symbols (never parameter names) */
const TEX_COMMANDS = new Set([
  'dot', 'ddot', 'frac', 'dfrac', 'sqrt', 'sin', 'cos', 'tan', 'exp', 'log', 'ln',
  'mathrm', 'mathit', 'text', 'operatorname', 'left', 'right', 'cdot', 'times',
  'alpha', 'cdot', 'pm', 'mp', 'approx', 'sim', 'propto',
])
/** free symbols of a latex right-hand side (paper-spec parameter candidates;
 *  also reused by the paper-study candidate check — CLI-151) */
export const freeOf = (latex: string): string[] => {
  const rhs = latex.slice(latex.indexOf('=') + 1)
  const out = new Set<string>()
  // bare single letters (products like x y)
  for (const m of rhs.matchAll(/\b([a-zA-Z])\b/g)) out.add(m[1])
  // greek/symbol macros (\beta, \gamma — but never commands like \sin)
  for (const m of rhs.matchAll(/\\([a-zA-Z]+)/g)) {
    if (!TEX_COMMANDS.has(m[1])) out.add(m[1])
  }
  return [...out]
}
/** q(0) = v / q_0 = v — paper-stated initial conditions (PAPER evidence) */
const INITIAL = /([a-zA-Z])\s*(?:\(\s*0\s*\)|_0)\s*=\s*(-?\d+(?:\.\d+)?)/g
/** sentences that state a RESULT the experiments can be compared against */
const CLAIM_HINTS = [
  '周期', '稳定', '收敛', '守恒', '保持', '平衡', '峰值', '衰减', '增大', '减小', '一致',
  'period', 'stable', 'converge', 'conserv', 'equilibrium', 'peak', 'decay', 'increase', 'decrease',
]

function statesOfDerivativeLatex(latex: string): string[] {
  const names: string[] = []
  for (const m of latex.matchAll(DERIVATIVE_STATE)) {
    const name = m[1] ?? m[2] ?? m[3]
    if (name && !names.includes(name)) names.push(name)
  }
  return names
}

/**
 * Build the comprehension spec from a parsed paper, deterministically:
 * - governing equations: every formula whose latex contains a derivative
 * - initial conditions: q(0)=v patterns in the paper TEXT (numbers are the
 *   paper's own, quoted verbatim — never inferred)
 * - parameters: free symbols appearing in governing right-hand sides that
 *   are neither states nor the independent variable (t)
 * - claims: sentences carrying a result-hint word (PAPER evidence)
 */
export function buildPaperSpec(doc: IngestedDoc): PaperModelSpec {
  const equations: SpecEquation[] = []
  const governingStates = new Set<string>()

  for (const f of formulasOf(doc)) {
    const states = statesOfDerivativeLatex(f.latex ?? '')
    if (states.length > 0) {
      // one governing equation per leading \dot state in this latex line
      for (const s of states) {
        governingStates.add(s)
        equations.push({
          latex: f.latex!,
          role: 'governing',
          state: s,
          source: f.id,
        })
      }
    } else {
      equations.push({ latex: f.latex!, role: 'definition', source: f.id })
    }
  }

  // initial conditions from prose: x(0) = 2 and y(0) = 0.5 etc.
  const text = docText(doc)
  const initials: Record<string, number> = {}
  for (const m of text.matchAll(INITIAL)) {
    initials[m[1]] = Number(m[2])
  }
  for (const [name, value] of Object.entries(initials)) {
    equations.push({
      latex: `${name}(0) = ${value}`,
      role: 'initial',
      state: name,
      source: '',
    })
  }

  // quantities: states (with paper initials), parameters from rhs symbols,
  // the independent variable, and table observables
  const quantities: SpecQuantity[] = []
  for (const s of governingStates) {
    quantities.push({
      name: s,
      role: 'state',
      ...(Number.isFinite(initials[s]) ? { initial: initials[s] } : {}),
    })
  }
  // free letters of right-hand sides — params for ODE papers (from governing
  // rhs); for definition-only papers (fit class) from EVERY definition rhs
  const known = new Set<string>([...governingStates, 't'])
  const paramNames = new Set<string>()
  if (governingStates.size > 0) {
    for (const eq of equations) {
      if (eq.role !== 'governing') continue
      for (const p of freeOf(eq.latex)) if (!known.has(p)) paramNames.add(p)
    }
  }
  // table observables: first alphabetic run of each column header, with
  // parenthesized UNITS stripped first ("(s)" → nothing, "y (mm)" → y,
  // "$x$ (s)" → x). Docling sometimes swallows a bare symbol into the unit
  // cell — what remains is what we can honestly claim.
  const observableNames: string[] = []
  for (const item of doc.items) {
    if (item.kind === 'table' && item.table?.columns) {
      const headerCells: string[] = (item.table.rows ?? [])[0] ?? item.table.columns
      for (const cell of headerCells) {
        const bare = cell.replace(/\([^)]*\)/g, '')
        const name = (bare.match(/[a-zA-Z]+/) ?? [])[0] ?? ''
        if (name && !observableNames.includes(name)) observableNames.push(name)
      }
    }
  }
  if (governingStates.size === 0) {
    // fit class: independent by letter preference (x, t, …) among the
    // definitions' free letters — headers are unreliable (units swallow
    // symbols); remaining free letters are the tunable parameters (a, b)
    const defLetters = new Set<string>()
    for (const eq of equations) {
      if (eq.role !== 'definition') continue
      for (const p of freeOf(eq.latex)) defLetters.add(p)
    }
    const independent = ['x', 't', 'u', 's'].find((c) => defLetters.has(c)) ?? observableNames[0] ?? 'x'
    for (const p of defLetters) {
      if (p !== independent && !observableNames.includes(p)) paramNames.add(p)
    }
    quantities.push({ name: independent, role: 'independent' })
  } else {
    quantities.push({ name: 't', role: 'independent' })
  }
  for (const p of paramNames) quantities.push({ name: p, role: 'parameter' })
  for (const name of observableNames) {
    if (!quantities.some((q) => q.name === name)) {
      quantities.push({ name, role: 'observable', source: '' })
    }
  }

  // claims: sentences with a result hint (max 4, verbatim, PAPER evidence),
  // each bound to the text ITEM it was read from — unbound ⇒ ambiguous
  const claims: SpecClaim[] = []
  for (const raw of text.split(/(?<=[.。!?])\s+/)) {
    const sentence = raw.trim()
    if (sentence.length < 12 || sentence.length > 220) continue
    const low = sentence.toLowerCase()
    if (!CLAIM_HINTS.some((h) => low.includes(h))) continue
    const host = doc.items.find((i) => (i.text ?? '').includes(sentence.slice(0, 40)))
    claims.push(
      host
        ? { statement: sentence, source: host.id, anchorPrecision: host.anchorPrecision ?? 'region' }
        : { statement: sentence, anchorPrecision: 'ambiguous' },
    )
    if (claims.length >= 4) break
  }

  // question: title + first substantive text sentence
  const firstSentence = docText(doc).split(/(?<=[.。!?])\s+/).find((s) => s.trim().length > 20) ?? ''
  return {
    paperId: doc.docId,
    version: 1,
    extractedAt: Date.now(),
    question: `${doc.title} — ${firstSentence.trim().slice(0, 160)}`,
    quantities,
    equations,
    claims,
    provenance: 'deterministic',
  }
}

/** governing equations as a state→latex-rhs map (what model.build consumes) */
export function governingSystem(spec: PaperModelSpec): { states: string[]; rhs: Record<string, string> } {
  const rhs: Record<string, string> = {}
  const states: string[] = []
  for (const eq of spec.equations) {
    if (eq.role !== 'governing' || !eq.state) continue
    if (!(eq.state in rhs)) {
      states.push(eq.state)
      rhs[eq.state] = eq.latex.slice(eq.latex.indexOf('=') + 1).trim()
    }
  }
  return { states, rhs }
}

/** paper-stated initials for the given states (PAPER evidence) */
export function initialsOf(spec: PaperModelSpec): Record<string, number> {
  const out: Record<string, number> = {}
  for (const q of spec.quantities) {
    if (q.role === 'state' && Number.isFinite(q.initial)) out[q.name] = q.initial as number
  }
  return out
}

/** the observable item (measurement table) if the paper carries one */
export function observableTable(doc: IngestedDoc): IngestedItem | null {
  return doc.items.find((i) => i.kind === 'table' && i.table) ?? null
}

/** unicode greek (docling renders `\beta` as β) → macro symbol name.
 * NOTE: LaTeX `\mu` frequently comes back as the MICRO SIGN µ (U+00B5), not
 * the greek letter μ (U+03BC) — both are mapped. */
export const GREEK_TO_NAME: Record<string, string> = {
  β: 'beta', γ: 'gamma', α: 'alpha', δ: 'delta', ω: 'omega', λ: 'lambda', μ: 'mu',
  µ: 'mu', σ: 'sigma', ρ: 'rho', κ: 'kappa', ε: 'epsilon', θ: 'theta', τ: 'tau',
  φ: 'phi', ψ: 'psi', π: 'pi', ϕ: 'phi', ϰ: 'kappa', ϵ: 'epsilon',
}

/**
 * Paper-stated NOMINAL parameter values (PAPER evidence, verbatim): the
 * prose sentence "the nominal parameters are β = 0.4 and γ = 0.1". Only
 * names the spec already labeled as parameters are accepted — a stray
 * "a = 2" elsewhere in the text never becomes a binding.
 */
export function nominalParams(doc: IngestedDoc, paramNames: string[]): Record<string, number> {
  const text = docText(doc)
  const out: Record<string, number> = {}
  for (const m of text.matchAll(/([a-zA-Zα-ωΑ-Ωµϵϕϰ])\s*=\s*(-?\d+(?:\.\d+)?)/g)) {
    const key = GREEK_TO_NAME[m[1]] ?? m[1]
    if (paramNames.includes(key) && !(key in out)) out[key] = Number(m[2])
  }
  return out
}
