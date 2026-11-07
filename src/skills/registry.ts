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
const nullableNum = { type: ['number', 'null'] } as const
const bool = { type: 'boolean' } as const
const str = { type: 'string' } as const
const int = { type: 'integer' } as const
const numbers = { type: 'array', items: num } as const
const vec3 = { type: 'object', required: ['x', 'y', 'z'], properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } } as const
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
    runKind: 'formula.value',
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
        samples: { type: 'integer', minimum: 2, maximum: 20001 },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['points', 'peak', 'integral'],
      properties: {
        points: { type: 'array', items: { type: 'array', items: num, minItems: 2, maxItems: 2 } },
        peak: num,
        integral: num,
      },
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
    outputSchema: {
      type: 'object',
      oneOf: [
        {
          required: ['k', 'alpha', 'computedArea', 'triangleArea', 'boundArea', 'ratio', 'triangles'],
          properties: { k: int, alpha: num, computedArea: num, triangleArea: num, boundArea: num, ratio: num, triangles: int },
        },
        {
          required: ['grid', 'sweptArea', 'analyticArea', 'ratio'],
          properties: { grid: int, sweptArea: num, analyticArea: num, ratio: num },
        },
      ],
    },
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
    outputSchema: {
      type: 'object',
      required: ['t', 'y', 'conservedDrift', 'conserved0'],
      properties: {
        t: numbers,
        y: { type: 'object', required: ['prey', 'predator'], properties: { prey: numbers, predator: numbers } },
        conservedDrift: num,
        conserved0: num,
      },
    },
    runtime: 'pyodide',
    renderer: 'plot',
    deterministic: true,
    version: 'ts-rk4@0.1',
    evidence: 'CALCULATED',
    runKind: 'lv.ode',
    implemented: true,
  },
  {
    name: 'ode.phase',
    description:
      "Integrate a generic 2-state autonomous ODE (system.kind='generic2') whose right-hand sides are the PAPER'S OWN LaTeX with literal coefficients, compiled by Cortex to JS and integrated with fixed-step RK4. Phase plane, time series and period all come from the ONE run. States may take any sign (damped oscillators are physics, not populations). Symbolic parameters are not bound here: use model.solve.",
    inputSchema: {
      type: 'object',
      required: ['system', 'initialState', 'tSpan'],
      properties: {
        system: {
          type: 'object',
          required: ['kind', 'states', 'rhs'],
          properties: {
            kind: { type: 'string' },
            states: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 },
            rhs: { type: 'object', description: 'state name → LaTeX right-hand side' },
          },
        },
        initialState: { type: 'object', description: 'state name → value at t0' },
        tSpan: range,
      },
    },
    outputSchema: {
      type: 'object',
      required: ['t', 's0', 's1', 'period0', 'maxAbs0', 'maxAbs1'],
      properties: {
        t: numbers,
        s0: numbers,
        s1: numbers,
        period0: { ...nullableNum, description: 'first-state midline period; null when the signal completes no two rising crossings' },
        maxAbs0: num,
        maxAbs1: num,
      },
    },
    runtime: 'cortex-js',
    renderer: 'jsxgraph',
    deterministic: true,
    version: 'ode-rk4@0.2',
    evidence: 'CALCULATED',
    runKind: 'ode.phase2',
    implemented: true,
  },
  {
    name: 'model.build',
    description:
      "Compile an N-state model from the PAPER'S OWN LaTeX equations (paper→model L2): every state's right-hand side is parsed and compiled to JS by the same Cortex kernel the executor uses, then verified to evaluate FINITELY at the paper's stated initial state. Produces a model.compiled run; no numbers are invented — initials must be the paper's own.",
    inputSchema: {
      type: 'object',
      required: ['states', 'rhs', 'initialState'],
      properties: {
        states: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'state variable names' },
        rhs: { type: 'object', description: 'state name → LaTeX right-hand side (paper verbatim)' },
        params: { type: 'object', description: 'constant symbol → nominal value (paper-stated)' },
        initialState: { type: 'object', description: 'state name → value at t0 (PAPER evidence)' },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['nStates', 'verifiedAt', 'freeParams'],
      properties: {
        nStates: int,
        verifiedAt: {
          type: 'array',
          description: 'rhs values at the initial state (finite check)',
          items: { type: 'object', required: ['state', 'value'], properties: { state: str, value: num } },
        },
        freeParams: { type: 'array', items: { type: 'string' }, description: 'free symbols needing values at solve time' },
      },
    },
    runtime: 'cortex-js',
    renderer: 'none',
    deterministic: true,
    version: 'model-build@0.1',
    evidence: 'CALCULATED',
    runKind: 'model.compiled',
    implemented: true,
  },
  {
    name: 'model.solve',
    description:
      "Integrate the compiled N-state model with fixed-step RK4 (any number of states — beyond ode.phase's 2). Series/min-max/period for every state come from the ONE run; divergence is an explicit failure, never a silent NaN.",
    inputSchema: {
      type: 'object',
      required: ['states', 'rhs', 'initialState', 'tSpan'],
      properties: {
        states: { type: 'array', items: { type: 'string' }, minItems: 1 },
        rhs: { type: 'object', description: 'state name → LaTeX right-hand side' },
        params: { type: 'object', description: 'constant symbol → value bindings' },
        initialState: { type: 'object' },
        tSpan: range,
        steps: { type: 'number', description: 'RK4 steps (default 2400)' },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['t', 'series', 'perState', 'period0', 'steps'],
      properties: {
        t: numbers,
        series: {
          type: 'array',
          description: 'per-state { state, values }',
          items: { type: 'object', required: ['state', 'values'], properties: { state: str, values: numbers } },
        },
        perState: {
          type: 'array',
          description: 'per-state { state, min, max }',
          items: { type: 'object', required: ['state', 'min', 'max'], properties: { state: str, min: num, max: num } },
        },
        period0: { ...nullableNum, description: 'first-state midline period; null when the signal is not periodic in the window' },
        steps: int,
      },
    },
    runtime: 'cortex-js',
    renderer: 'jsxgraph',
    deterministic: true,
    version: 'model-rk4@0.1',
    evidence: 'CALCULATED',
    runKind: 'model.solved',
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
    outputSchema: {
      type: 'array',
      description: 'one { dir, center, radius } per tube',
      items: { type: 'object', required: ['dir', 'center', 'radius'], properties: { dir: vec3, center: vec3, radius: num } },
    },
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
    description: 'Finite-scale voxel measurement of a tube family: occupied cells, union volume, multiplicity. Optional per-tube offsets (one per tube, applied to the family centres) move clusters WITHOUT changing any direction, length or radius; a capsule that would leave the scoring domain [0,1]³ is rejected.',
    inputSchema: {
      type: 'object',
      required: ['deltaExp', 'nTubes', 'packing'],
      properties: {
        deltaExp: num,
        nTubes: { type: 'integer' },
        packing: num,
        res: { type: 'integer', minimum: 1, maximum: 1024 },
        length: num,
        offsets: {
          type: 'array',
          maxItems: 2048,
          items: { type: 'object', required: ['x', 'y', 'z'], properties: { x: num, y: num, z: num } },
        },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['occupiedVolume', 'sumTubeVolume', 'avgMultiplicity', 'maxMultiplicity'],
      properties: { occupiedVolume: num, sumTubeVolume: num, avgMultiplicity: num, maxMultiplicity: int },
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
        res: { type: 'integer', minimum: 1, maximum: 1024 },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['points'],
      properties: {
        points: {
          type: 'array',
          items: { type: 'object', required: ['x', 'y', 'series', 'runId'], properties: { x: num, y: num, series: str, runId: str } },
        },
      },
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
    outputSchema: {
      type: 'object',
      required: ['runA', 'runB', 'kindA', 'kindB', 'rows'],
      properties: {
        runA: str,
        runB: str,
        kindA: str,
        kindB: str,
        rows: {
          type: 'array',
          items: { type: 'object', required: ['key', 'a', 'b', 'delta'], properties: { key: str, a: nullableNum, b: nullableNum, delta: nullableNum } },
        },
      },
    },
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
    outputSchema: { type: 'object', required: ['anchorId'], properties: { anchorId: str, page: { type: 'integer' }, bbox: { type: 'object' } } },
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
        steps: { type: 'integer', minimum: 1, maximum: 100000 },
        sampleEvery: { type: 'integer', minimum: 1, maximum: 100000 },
        params: { type: 'object' },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['scene', 'steps', 'sampleEvery', 'nq', 't', 'qpos', 'geomSummary', 'metrics'],
      properties: {
        scene: str,
        steps: int,
        sampleEvery: int,
        nq: int,
        t: numbers,
        qpos: { type: 'array', items: numbers },
        geomSummary: {
          type: 'object',
          required: ['nbody', 'nq', 'nv', 'geoms'],
          properties: {
            nbody: int,
            nq: int,
            nv: int,
            geoms: {
              type: 'array',
              items: {
                type: 'object',
                required: ['bodyId', 'type', 'size', 'rgba'],
                properties: { bodyId: int, type: int, size: { type: 'array', items: num, minItems: 3, maxItems: 3 }, rgba: { type: 'array', items: num, minItems: 4, maxItems: 4 } },
              },
            },
          },
        },
        metrics: {
          type: 'object',
          required: ['finalTime', 'qposNormFinal', 'qvelNormFinal', 'qaccNormMean', 'comZFinal', 'allFinite'],
          properties: { finalTime: num, qposNormFinal: num, qvelNormFinal: num, qaccNormMean: num, comZFinal: nullableNum, allFinite: bool },
        },
      },
    },
    runtime: 'wasm',
    renderer: 'r3f',
    deterministic: true,
    version: 'mujoco-wasm@3.12.0',
    evidence: 'CALCULATED',
    runKind: 'mujoco.sim',
    implemented: true,
  },
  {
    name: 'challenge.attempt',
    description:
      'Play one attempt of a playable challenge (projectile / pendulum / tubes): a code-built model (programmatic MJCF or Kakeya geometry) computed by the REAL engine; hit, error, period and score are read from the computed result — never asserted. Shares goal, constraints and budget between user and agent.',
    inputSchema: {
      type: 'object',
      required: ['challenge', 'changes'],
      properties: {
        challenge: { type: 'string', enum: ['projectile', 'pendulum', 'tubes'] },
        changes: { type: 'object' },
        level: { type: 'object' },
      },
    },
    outputSchema: {
      type: 'object',
      oneOf: [
        {
          required: ['kind', 't', 'x', 'z', 'landingX', 'targetX', 'error', 'hit', 'tolerance', 'score'],
          properties: { kind: { type: 'string', enum: ['projectile'] }, t: numbers, x: numbers, z: numbers, landingX: num, targetX: num, error: num, hit: bool, tolerance: num, score: num },
        },
        {
          required: ['kind', 't', 'theta', 'measuredPeriod', 'targetPeriod', 'error', 'matched', 'tolerance', 'score'],
          properties: { kind: { type: 'string', enum: ['pendulum'] }, t: numbers, theta: numbers, measuredPeriod: nullableNum, targetPeriod: num, error: nullableNum, matched: bool, tolerance: num, score: num },
        },
        {
          required: ['kind', 'occupiedVolume', 'budget', 'withinBudget', 'score', 'packing', 'violations'],
          properties: { kind: { type: 'string', enum: ['tubes'] }, occupiedVolume: num, budget: num, withinBudget: bool, score: num, packing: numbers, violations: int },
        },
      ],
    },
    runtime: 'wasm',
    renderer: 'r3f',
    deterministic: true,
    version: 'challenge-kernel@0.1',
    evidence: 'CALCULATED',
    runKind: 'challenge.attempt',
    implemented: true,
  },
]

const byName = new Map(SKILL_REGISTRY.map((s) => [s.name, s]))
const byAlias = new Map(SKILL_REGISTRY.flatMap((s) => (s.aliases ?? []).map((a) => [a, s] as const)))

export function getSkill(name: string): ScientificSkill | undefined {
  return byName.get(name) ?? byAlias.get(name)
}

const TYPE_CHECKS: Record<string, (value: unknown) => boolean> = {
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  array: Array.isArray,
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  integer: (v) => typeof v === 'number' && Number.isSafeInteger(v),
  boolean: (v) => typeof v === 'boolean',
  null: (v) => v === null,
}

/** Validate the JSON-Schema subset declared above, including nested arrays. */
export function schemaError(schema: Record<string, unknown>, value: unknown, path: string): string | null {
  if (schema.type !== undefined) {
    const types = [schema.type].flat() as string[]
    if (!types.some((t) => TYPE_CHECKS[t]?.(value))) return `${path}: expected ${types.join(' or ')}`
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return `${path}: invalid choice`
  if (Array.isArray(schema.oneOf)) {
    const shapes = schema.oneOf as Array<Record<string, unknown>>
    const errors = shapes.map((shape) => schemaError(shape, value, path))
    const matches = errors.filter((e) => e === null).length
    if (matches !== 1) return `${path}: matches ${matches} of ${shapes.length} declared shapes (${errors.filter(Boolean).join('; ')})`
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return `${path}: below minimum ${schema.minimum}`
    if (typeof schema.maximum === 'number' && value > schema.maximum) return `${path}: above maximum ${schema.maximum}`
  }
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
