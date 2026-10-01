// Scientific Skill Registry (AGENTS.md v6 §6) — FAROS WorkflowNode-style
// declarations. An Agent (local or AgentScope) may ONLY invoke registered
// skills; every skill pins its runtime, renderer, evidence type and version
// so ExperimentRuns stay traceable. UI/AI never invents skills or numbers.
import type { ExperimentKind } from '../experiments/protocol'

export type SkillRuntime =
  | 'cortex-js' // Cortex Compute Engine compiled/interpreted in-browser
  | 'observable-cells' // Observable Runtime param→curve DAG
  | 'kakeya-worker' // Comlink voxel/tube worker (ts-kakeya-worker)
  | 'pyodide' // Pyodide scipy runtime
  | 'canvas' // pure canvas orchestration (no numerics)

export type SkillRenderer = 'jsxgraph' | 'r3f' | 'plot' | 'none' | 'canvas'
export type EvidenceType = 'CALCULATED' | 'AI_INFERENCE' | 'PAPER'

export interface ScientificSkill {
  name: string
  description: string
  /** JSON-Schema (draft-07 style object) describing valid skill input */
  inputSchema: Record<string, unknown>
  /** JSON-Schema describing the result payload (inside ExperimentRun.result or op payload) */
  outputSchema: Record<string, unknown>
  runtime: SkillRuntime
  renderer: SkillRenderer
  deterministic: boolean
  version: string
  evidence: EvidenceType
  /** ExperimentRun.kind this skill produces (numeric skills only) */
  runKind?: ExperimentKind
}

const num = { type: 'number' } as const
const range = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } as const

export const SKILL_REGISTRY: ScientificSkill[] = [
  {
    name: 'formula.evaluate',
    description: 'Evaluate a MathJSON expression at given variable bindings via the Cortex Compute Engine (no UI).',
    inputSchema: {
      type: 'object',
      required: ['expression', 'bindings'],
      properties: { expression: { type: 'object' }, bindings: { type: 'object' } },
    },
    outputSchema: { type: 'object', required: ['value'], properties: { value: num } },
    runtime: 'cortex-js',
    renderer: 'none',
    deterministic: true,
    version: 'cortex-ce@0.142.0',
    evidence: 'CALCULATED',
    runKind: 'formula.curve',
  },
  {
    name: 'formula.plot',
    description: 'Sample a compiled formula over the independent range with parameter chips; emits a curve run.',
    inputSchema: {
      type: 'object',
      required: ['expression', 'parameters', 'independent', 'range'],
      properties: {
        expression: { type: 'object' },
        parameters: { type: 'array', items: { type: 'string' } },
        independent: { type: 'string' },
        range,
      },
    },
    outputSchema: {
      type: 'object',
      required: ['points', 'peak', 'integral'],
      properties: { points: { type: 'array' }, peak: num, integral: num },
    },
    runtime: 'cortex-js',
    renderer: 'jsxgraph',
    deterministic: true,
    version: 'cortex-ce@0.142.0',
    evidence: 'CALCULATED',
    runKind: 'formula.curve',
  },
  {
    name: 'geometry.2d',
    description: '2D geometric construction measurement (Perron tree / needle sweep) in the Kakeya 2D kernel.',
    inputSchema: {
      type: 'object',
      required: ['construction', 'params'],
      properties: {
        construction: { type: 'string', enum: ['perron-tree', 'needle-sweep'] },
        params: { type: 'object' },
      },
    },
    outputSchema: { type: 'object', properties: { area: num, ratio: num } },
    runtime: 'kakeya-worker',
    renderer: 'jsxgraph',
    deterministic: true,
    version: 'ts-kakeya-2d@v3',
    evidence: 'CALCULATED',
    runKind: 'perron.tree',
  },
  {
    name: 'ode.solve',
    description: 'Solve an ODE system (Pyodide/scipy solve_ivp) and emit a trajectory run.',
    inputSchema: {
      type: 'object',
      required: ['system', 'initialValues', 'tSpan'],
      properties: { system: { type: 'object' }, initialValues: { type: 'object' }, tSpan: range },
    },
    outputSchema: { type: 'object', properties: { t: { type: 'array' }, y: { type: 'object' } } },
    runtime: 'pyodide',
    renderer: 'plot',
    deterministic: true,
    version: 'pyodide-scipy@v0.27.7',
    evidence: 'CALCULATED',
    runKind: 'lv.ode',
  },
  {
    name: 'kakeya.generate',
    description: 'Generate the δ-tube family geometry (directions, packing, radius) as a kakeya.geometry run.',
    inputSchema: {
      type: 'object',
      required: ['deltaExp', 'nTubes', 'packing'],
      properties: { deltaExp: num, nTubes: { type: 'integer' }, packing: num },
    },
    outputSchema: { type: 'object', properties: { tubes: { type: 'array' }, boundingRadius: num } },
    runtime: 'kakeya-worker',
    renderer: 'r3f',
    deterministic: true,
    version: 'ts-kakeya-worker@v3',
    evidence: 'CALCULATED',
    runKind: 'kakeya.geometry',
  },
  {
    name: 'kakeya.measure',
    description: 'Finite-scale voxel measurement of a tube family: occupied cells, union volume, multiplicity.',
    inputSchema: {
      type: 'object',
      required: ['deltaExp', 'nTubes', 'packing'],
      properties: {
        deltaExp: num,
        nTubes: { type: 'integer' },
        packing: num,
        res: { type: 'integer' },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['occupiedVolume', 'avgMultiplicity', 'maxMultiplicity'],
      properties: { occupiedVolume: num, avgMultiplicity: num, maxMultiplicity: { type: 'integer' } },
    },
    runtime: 'kakeya-worker',
    renderer: 'r3f',
    deterministic: true,
    version: 'ts-kakeya-worker@v3',
    evidence: 'CALCULATED',
    runKind: 'kakeya.voxel',
  },
  {
    name: 'kakeya.sweep',
    description: 'Parameter sweep of kakeya.measure over N — every datapoint is its own ExperimentRun.',
    inputSchema: {
      type: 'object',
      required: ['param', 'values'],
      properties: {
        param: { type: 'string', enum: ['nTubes', 'deltaExp', 'packing'] },
        values: { type: 'array', items: num },
      },
    },
    outputSchema: {
      type: 'object',
      properties: { points: { type: 'array', items: { type: 'object' } } },
    },
    runtime: 'kakeya-worker',
    renderer: 'plot',
    deterministic: true,
    version: 'ts-kakeya-worker@v3',
    evidence: 'CALCULATED',
    runKind: 'kakeya.sweep',
  },
  {
    name: 'experiment.fork',
    description: 'Clone an experiment (same skill, new run lineage via parentRunId). No numerics by itself.',
    inputSchema: {
      type: 'object',
      required: ['sourceRunId'],
      properties: { sourceRunId: { type: 'string' }, parameterChanges: { type: 'object' } },
    },
    outputSchema: { type: 'object', required: ['forkRunId'], properties: { forkRunId: { type: 'string' } } },
    runtime: 'canvas',
    renderer: 'canvas',
    deterministic: true,
    version: 'desk@v6',
    evidence: 'CALCULATED',
  },
  {
    name: 'experiment.compare',
    description: 'Compare two ExperimentRuns metric-by-metric; differences reference run ids only.',
    inputSchema: {
      type: 'object',
      required: ['runA', 'runB'],
      properties: { runA: { type: 'string' }, runB: { type: 'string' } },
    },
    outputSchema: { type: 'object', properties: { rows: { type: 'array' } } },
    runtime: 'canvas',
    renderer: 'canvas',
    deterministic: true,
    version: 'desk@v6',
    evidence: 'CALCULATED',
  },
  {
    name: 'paper.trace-source',
    description: 'Return the Docling source anchor (page + bbox) for a formula/run and move the camera there.',
    inputSchema: { type: 'object', required: ['anchorId'], properties: { anchorId: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { page: { type: 'integer' }, bbox: { type: 'object' } } },
    runtime: 'canvas',
    renderer: 'canvas',
    deterministic: true,
    version: 'desk@v6',
    evidence: 'PAPER',
  },
]

const byName = new Map(SKILL_REGISTRY.map((s) => [s.name, s]))

export function getSkill(name: string): ScientificSkill | undefined {
  return byName.get(name)
}

/** lightweight structural validation of a skill invocation payload */
export function validateSkillInput(name: string, input: unknown): { ok: boolean; error?: string } {
  const skill = byName.get(name)
  if (!skill) return { ok: false, error: `unknown skill: ${name}` }
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'input must be an object' }
  const required = (skill.inputSchema.required as string[] | undefined) ?? []
  for (const key of required) {
    if (!(key in (input as Record<string, unknown>))) return { ok: false, error: `missing field: ${key}` }
  }
  return { ok: true }
}
