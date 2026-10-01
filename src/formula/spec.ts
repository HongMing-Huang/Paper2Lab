// FormulaExplorerSpec — the *configuration* an adapter/AI emits to instantiate
// an existing interactive module (AGENTS.md §4 v5: agents choose & configure
// modules; they never emit code, never emit numbers).
import type { MathJsonExpression } from '@cortex-js/compute-engine'
import type { FormulaAnalysis, ParamSpec } from './analyze'
import { compileFormula, type CompiledFormula } from './compile'

/** anchor into the ingested paper (Docling provenance, page 1-based) */
export interface SourceAnchor {
  docId: string
  page: number
  /** top-left origin, fractions of page width/height (0..1) */
  bbox: { x: number; y: number; w: number; h: number }
  /** formula LaTeX as extracted by Docling */
  latex: string
}

export interface FormulaExplorerSpec {
  type: 'formula'
  expression: MathJsonExpression
  rhs: MathJsonExpression
  parameters: ParamSpec[]
  independent: { name: string; range: [number, number] }
  output: string | null
  renderer: 'jsxgraph'
  anchor: SourceAnchor
}

export interface BuiltExplorer {
  spec: FormulaExplorerSpec
  compiled: CompiledFormula | null
}

export function buildExplorerSpec(
  analysis: FormulaAnalysis,
  anchor: SourceAnchor,
): BuiltExplorer {
  const independent = analysis.independent!
  const spec: FormulaExplorerSpec = {
    type: 'formula',
    expression: analysis.mathjson,
    rhs: analysis.rhs,
    parameters: analysis.params,
    independent: { name: independent, range: analysis.domain },
    output: analysis.output,
    renderer: 'jsxgraph',
    anchor,
  }
  return { spec, compiled: compileFormula(analysis.rhs) }
}
