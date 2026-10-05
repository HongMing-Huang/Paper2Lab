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
  | 'wasm' // Emscripten WASM kernel (engine-side Node, e.g. MuJoCo)
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
  /** false ⇒ the unified executor answers `unsupported` (no runnable path yet) */
  implemented: boolean
  /** why an unimplemented skill exists in the registry (shown in unsupported) */
  unavailableReason?: string
  /**
   * Canonical AGENTS §4 names that resolve to THIS skill (same input/output
   * contract). Lets agent-side planners speak the canonical vocabulary while
   * the executor surface stays the registry names.
   */
  aliases?: string[]
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
      properties: { expression: {}, bindings: { type: 'object' } },
    },
    outputSchema: { type: 'object', required: ['value'], properties: { value: num } },
    runtime: 'cortex-js',
    renderer: 'none',
    deterministic: true,
    version: 'cortex-ce@0.142.0',
    evidence: 'CALCULATED',
    runKind: 'formula.curve',
    implemented: true,
  },
  {
    name: 'formula.plot',
    description: 'Sample a compiled formula over the independent range with parameter chips; emits a curve run.',
    inputSchema: {
      type: 'object',
      required: ['expression', 'parameters', 'independent', 'range'],
      properties: {
        expression: {},
        parameters: { type: 'array', items: { type: 'string' } },
        independent: { type: 'string' },
        range,
        values: { type: 'object' },
        samples: { type: 'integer' },
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
    implemented: true,
  },
  {
    name: 'geometry.2d',
    description: '2D geometric measurement: Perron tree (k, α) union area or unit-needle sweep area.',
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
    implemented: true,
  },
  {
    name: 'ode.solve',
    description: "Integrate a 2-species Lotka–Volterra system (system.kind='lv2') over tSpan with a fixed-step RK4 kernel.",
    inputSchema: {
      type: 'object',
      required: ['system', 'initialValues', 'tSpan'],
      properties: {
        system: { type: 'object' },
        initialValues: { type: 'object' },
        tSpan: range,
      },
    },
    outputSchema: { type: 'object', properties: { t: { type: 'array' }, y: { type: 'object' } } },
    runtime: 'pyodide',
    renderer: 'plot',
    deterministic: true,
    version: 'ts-rk4@0.1',
    evidence: 'CALCULATED',
    runKind: 'lv.ode',
    implemented: true,
  },
  {
    name: 'kakeya.generate',
    aliases: ['simulate_geometry'],
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
    implemented: true,
  },
  {
    name: 'kakeya.measure',
    aliases: ['measure_volume', 'measure_multiplicity'],
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
    implemented: true,
  },
  {
    name: 'kakeya.sweep',
    aliases: ['run_scale_sweep'],
    description: 'Parameter sweep of kakeya.measure over N — every datapoint is its own ExperimentRun.',
    inputSchema: {
      type: 'object',
      required: ['param', 'values'],
      properties: {
        param: { type: 'string', enum: ['nTubes', 'deltaExp', 'packing'] },
        values: { type: 'array', items: num, minItems: 1 },
        nTubes: { type: 'integer' },
        deltaExp: num,
        packing: num,
        res: { type: 'integer' },
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
    implemented: true,
  },
  {
    name: 'experiment.fork',
    aliases: ['fork_experiment'],
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
    implemented: true,
  },
  {
    name: 'experiment.compare',
    aliases: ['compare_experiments'],
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
    implemented: true,
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
    implemented: true,
  },
  {
    name: 'mujoco.simulate',
    description:
      'Headless MuJoCo simulation of a vendored demo scene (upstream zalo/mujoco_wasm@f6b202c, @mujoco/mujoco 3.12.0 single-thread WASM): real mj_step physics with model-level params (gravityZ/windX/timestep). Runs in the backend engine; the page imports the resulting Runs.',
    inputSchema: {
      type: 'object',
      required: ['scene', 'steps'],
      properties: {
        scene: { type: 'string' },
        steps: { type: 'integer' },
        sampleEvery: { type: 'integer' },
        params: { type: 'object' },
      },
    },
    outputSchema: { type: 'object', required: ['metrics'], properties: { metrics: { type: 'object' } } },
    runtime: 'wasm',
    renderer: 'r3f',
    deterministic: true,
    version: 'mujoco-wasm@3.12.0',
    evidence: 'CALCULATED',
    runKind: 'mujoco.sim',
    implemented: true,
  },
]

const byName = new Map(SKILL_REGISTRY.map((s) => [s.name, s]))
const byAlias = new Map(SKILL_REGISTRY.flatMap((s) => (s.aliases ?? []).map((a) => [a, s] as const)))

export function getSkill(name: string): ScientificSkill | undefined {
  return byName.get(name) ?? byAlias.get(name)
}

/** Validate the JSON-Schema subset declared above, including nested arrays. */
export function schemaError(schema: Record<string, unknown>, value: unknown, path: string): string | null {
  const type = schema.type
  if ((type === 'object' && (value === null || typeof value !== 'object' || Array.isArray(value))) ||
      (type === 'array' && !Array.isArray(value)) ||
      (type === 'string' && typeof value !== 'string') ||
      (type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) ||
      (type === 'integer' && (typeof value !== 'number' || !Number.isSafeInteger(value)))) return `${path}: expected ${type}`
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return `${path}: invalid choice`
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) return `${path}: too few items`
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return `${path}: too many items`
    if (schema.items) for (let i = 0; i < value.length; i++) {
      const error = schemaError(schema.items as Record<string, unknown>, value[i], `${path}[${i}]`)
      if (error) return error
    }
  } else if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    for (const key of (schema.required as string[] | undefined) ?? []) {
      if (!Object.hasOwn(obj, key)) return `${path}: missing field ${key}`
    }
    for (const [key, child] of Object.entries((schema.properties as Record<string, Record<string, unknown>>) ?? {})) {
      if (Object.hasOwn(obj, key)) {
        const error = schemaError(child, obj[key], `${path}.${key}`)
        if (error) return error
      }
    }
  }
  return null
}
export function validateSkillInput(name: string, input: unknown): { ok: boolean; error?: string } {
  const skill = byName.get(name)
  if (!skill) return { ok: false, error: `unknown skill: ${name}` }
  const error = schemaError(skill.inputSchema, input, name)
  return error ? { ok: false, error } : { ok: true }
}
