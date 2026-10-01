// Optional LLM planner adapter (Qwen or any OpenAI-compatible endpoint).
// The LLM may ONLY return a structured ExperimentPlan — validated against the
// tool schema before execution — plus AI_INFERENCE explanations. It can never
// emit CALCULATED numbers (planSmugglesNumbers rejects numeric explain args).
// Credentials come exclusively from environment variables; no literals.
import { EXPERIMENT_PLAN_JSON_SCHEMA, planSmugglesNumbers, validatePlan, type ExperimentPlanSchema } from './toolSchema'
import { planExperiment, type ExperimentPlan } from './planner'

export interface LlmPlannerConfig {
  endpoint: string
  apiKey: string
  model: string
}

/** read config from env only (PAPER2LAB_LLM_* / VITE_/OPENAI_*); null when absent.
 *  In Vite the browser exposes import.meta.env (only VITE_-prefixed vars are
 *  forwarded); Node/tests keep process.env. No credential literals anywhere. */
function envVar(name: string): string | undefined {
  try {
    const meta = import.meta as unknown as { env?: Record<string, string | undefined> }
    const fromMeta = meta.env?.[name] ?? meta.env?.[`VITE_${name}`]
    if (fromMeta) return fromMeta
  } catch {
    /* import.meta.env unavailable */
  }
  try {
    const g = globalThis as { process?: { env?: Record<string, string | undefined> } }
    return g.process?.env?.[name]
  } catch {
    return undefined
  }
}

export function llmConfigFromEnv(): LlmPlannerConfig | null {
  const endpoint = envVar('PAPER2LAB_LLM_ENDPOINT') ?? envVar('OPENAI_BASE_URL')
  const apiKey = envVar('PAPER2LAB_LLM_API_KEY') ?? envVar('OPENAI_API_KEY')
  const model = envVar('PAPER2LAB_LLM_MODEL') ?? 'qwen-max'
  if (!endpoint || !apiKey) return null
  return { endpoint, apiKey, model }
}

const SYSTEM_PROMPT = `You are the Scientific Skills Agent of Paper2Lab (Wang–Zahl 3D Kakeya paper lab).
You must answer user questions by planning EXPERIMENTS, never by stating numeric results.
Return ONLY a JSON object matching this schema:
${JSON.stringify(EXPERIMENT_PLAN_JSON_SCHEMA)}
Rules:
- Prefer actions: fork_experiment, change_parameter, run_scale_sweep, compare_experiments, explain_result.
- change_parameter args use param ids: "kakeya.deltaExp" (3–5.5, δ=2^-e), "kakeya.nTubes" (16–256), "kakeya.packing" (0–1).
- For questions about proofs/theorems use open_proof.
- NEVER include numeric measurement results in explain_result args (they are read from ExperimentRuns).
Respond with JSON only, no prose.`

export async function planWithLlm(
  question: string,
  current: { nTubes: number; deltaExp: number; packing: number },
  cfg: LlmPlannerConfig,
): Promise<ExperimentPlan | null> {
  try {
    const res = await fetch(`${cfg.endpoint.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `${question}\n(current params: nTubes=${current.nTubes}, deltaExp=${current.deltaExp}, packing=${current.packing})`,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const content = data.choices?.[0]?.message?.content
    if (!content) return null
    const parsed = JSON.parse(content) as unknown
    const v = validatePlan(parsed)
    if (!v.ok) return null
    const plan = v.plan as ExperimentPlanSchema
    if (planSmugglesNumbers(plan)) return null
    return { title: plan.title, actions: plan.actions }
  } catch {
    return null
  }
}

/** entry: LLM when configured, deterministic fallback otherwise */
export async function planQuestion(
  question: string,
  current: { nTubes: number; deltaExp: number; packing: number },
): Promise<ExperimentPlan> {
  const cfg = llmConfigFromEnv()
  if (cfg) {
    const llm = await planWithLlm(question, current, cfg)
    if (llm) return llm
  }
  return planExperiment(question, current)!
}
