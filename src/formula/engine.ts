// Cortex Compute Engine singleton (AGENTS.md §2 v5: LaTeX → MathJSON is the
// internal math representation; regex parsing of formulas is forbidden).
import { ComputeEngine } from '@cortex-js/compute-engine'

let engine: ComputeEngine | null = null

export function getEngine(): ComputeEngine {
  if (!engine) engine = new ComputeEngine()
  return engine
}

export const CORTEX_VERSION = '0.142.0'
