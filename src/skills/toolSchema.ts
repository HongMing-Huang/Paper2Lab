// Agent Tool Schema — the ONLY shape an LLM (Qwen or any future planner) may
// emit: a structured ExperimentPlan. The model may also produce explain_result
// prose (AI_INFERENCE). It can NEVER emit CALCULATED numbers — those come
// exclusively from ExperimentRun (AGENTS.md §2.8).
export const AGENT_SKILL_WHITELIST = [
  'inspect_source',
  'change_parameter',
  'fork_experiment',
  'simulate_geometry',
  'generate_directions',
  'generate_tubes',
  'interpolate_packing',
  'measure_volume',
  'measure_multiplicity',
  'run_scale_sweep',
  'compare_experiments',
  'explain_result',
  'trace_evidence',
  'open_proof',
] as const

export type AgentSkillId = (typeof AGENT_SKILL_WHITELIST)[number]

export interface AgentActionSchema {
  skill: AgentSkillId
  args: Record<string, number | string>
  label: string
}

export interface ExperimentPlanSchema {
  title: string
  actions: AgentActionSchema[]
}

/** JSON-Schema description (for the LLM system prompt / tool definition) */
export const EXPERIMENT_PLAN_JSON_SCHEMA = {
  type: 'object',
  required: ['title', 'actions'],
  properties: {
    title: { type: 'string', description: 'one-line description of the planned experiment' },
    actions: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['skill', 'args', 'label'],
        properties: {
          skill: { type: 'string', enum: [...AGENT_SKILL_WHITELIST] },
          args: { type: 'object', description: 'skill inputs (numbers/strings only)' },
          label: { type: 'string', description: 'human-readable action summary' },
        },
      },
    },
  },
} as const

export function validatePlan(plan: unknown): { ok: true; plan: ExperimentPlanSchema } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (typeof plan !== 'object' || plan === null) return { ok: false, errors: ['plan must be an object'] }
  const p = plan as Partial<ExperimentPlanSchema>
  if (typeof p.title !== 'string' || p.title.length === 0) errors.push('title must be a non-empty string')
  if (!Array.isArray(p.actions) || p.actions.length === 0) errors.push('actions must be a non-empty array')
  const whitelist = new Set<string>(AGENT_SKILL_WHITELIST)
  for (const [i, a] of (p.actions ?? []).entries()) {
    const act = a as Partial<AgentActionSchema>
    if (typeof act.skill !== 'string' || !whitelist.has(act.skill)) errors.push(`actions[${i}].skill '${String(act.skill)}' not in whitelist`)
    if (typeof act.label !== 'string') errors.push(`actions[${i}].label must be a string`)
    if (typeof act.args !== 'object' || act.args === null) errors.push(`actions[${i}].args must be an object`)
  }
  if (errors.length) return { ok: false, errors }
  return { ok: true, plan: p as ExperimentPlanSchema }
}

/** guard for LLM output: reject plans that try to smuggle numeric results */
export function planSmugglesNumbers(plan: ExperimentPlanSchema): boolean {
  return plan.actions.some((a) =>
    a.skill === 'explain_result'
      ? Object.values(a.args).some((v) => typeof v === 'number')
      : false,
  )
}
