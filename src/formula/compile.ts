// MathJSON → JavaScript via the Cortex Compute Engine compiler (JS target).
// The returned `run` is the single numeric source for charts/chips — UI code
// must never hardcode curve values (AGENTS.md §0.3 / v5 ingest rules).
import { compile, type MathJsonExpression } from '@cortex-js/compute-engine'
import { CORTEX_VERSION } from './engine'

export interface CompiledFormula {
  /** numeric evaluation: pass every free symbol (incl. the independent var) */
  run: (vars: Record<string, number>) => number
  /** generated JS source (shown in the experiment's engine badge) */
  code: string
  /** true = lowered to JS source; false = engine interpreter fallback */
  success: boolean
  /** evidence label for the LOCAL CALC badge */
  engine: string
  freeSymbols: string[]
}

export function compileFormula(rhs: MathJsonExpression): CompiledFormula | null {
  let result
  try {
    result = compile(rhs, { to: 'javascript' })
  } catch {
    return null
  }
  if (!result || typeof result.run !== 'function') return null
  const rawRun = result.run
  const run = (vars: Record<string, number>): number => {
    const v = rawRun(vars)
    return typeof v === 'number' ? v : Number(v)
  }
  return {
    run,
    code: result.code ?? '',
    success: result.success,
    engine: result.success
      ? `cortex-ce@${CORTEX_VERSION}·js`
      : `cortex-ce@${CORTEX_VERSION}·interp`,
    freeSymbols: result.freeSymbols ?? [],
  }
}
