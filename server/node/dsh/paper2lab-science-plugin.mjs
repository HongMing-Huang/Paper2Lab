// J1.2b — the Paper2Lab product plugin for DeepSeek Harness.
//
// Runs INSIDE the DSH runtime process and exposes the Registry's scientific
// tools to the model. It never imports Paper2Lab's executor or touches its
// database: every call goes through the Node science API (the same port the
// browser and tests use), so the runtime holds no writable scientific state.
//
// Identity: each model tool call maps to ONE science operation whose id is
// derived from (session id, tool call id). A tool call that is executed again
// after a crash/resume therefore replays the recorded receipt instead of
// computing a second Run.
//
// Cancellation: when the executor aborts a call (exec.signal), the plugin asks
// the API to cancel the science task and waits until the task is terminal —
// the owning worker kills its own engine process and confirms the exit.
//
// Whitelist: besides the product profile disabling every shell/fs/web/agent
// tool plugin, a global guard refuses to execute ANY tool that is not one of
// the names registered here.
import { createHash } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'paper2lab-science'
export const inject = ['tools']

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled'])
const POLL_MS = 250
export const SCIENCE_TOOL_NAMES = ['science_run', 'science_fork', 'science_compare', 'science_read_run', 'science_list_runs']

function operationIdFor(exec) {
  const session = exec?.agent?.session?.id ?? 'nosession'
  return 'dsh-' + createHash('sha256').update(`${session}\u0000${exec.callId}`).digest('hex').slice(0, 40)
}

/** compact, model-sized view of a committed run: identity, lineage, the
 *  experiment's parameters and the scalar observables (no raw arrays) */
function summarizeRun(run) {
  const result = run?.result && typeof run.result === 'object' && !Array.isArray(run.result) ? run.result : {}
  const metrics = {}
  const arrays = {}
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'number' && Number.isFinite(value)) metrics[key] = value
    else if (Array.isArray(value)) arrays[key] = value.length
  }
  return {
    runId: String(run.runId),
    kind: String(run.spec?.kind ?? 'unknown'),
    status: String(run.status),
    parentRunId: run.parentRunId ?? null,
    params: run.spec?.params ?? {},
    metrics,
    arrays,
    engine: `${run.engine}@${run.engineVersion}`,
    errors: Array.isArray(run.errors) ? run.errors.map(String) : [],
  }
}

function renderResult(value) {
  if (value.state !== 'completed') {
    const missing = value.missingFields?.length ? ` missing=${value.missingFields.join(',')}` : ''
    return [{ type: 'text', text: `NOT COMPUTED — ${value.state}${missing}: ${value.message ?? ''} (operation ${value.operationId})` }]
  }
  if (!value.run) {
    return [{ type: 'text', text: `completed (no run): ${JSON.stringify(value.payload ?? null).slice(0, 4000)}` }]
  }
  const r = value.run
  const metrics = Object.entries(r.metrics).map(([k, v]) => `${k}=${v}`).join(' ')
  const arrays = Object.entries(r.arrays).map(([k, n]) => `${k}[${n}]`).join(' ')
  return [{
    type: 'text',
    text: `CALCULATED run ${r.runId} (${r.kind}, ${r.status}) params=${JSON.stringify(r.params)} ${metrics}${arrays ? ` arrays: ${arrays}` : ''}${r.parentRunId ? ` parent=${r.parentRunId}` : ''} engine=${r.engine}`,
  }]
}

// ---- output schemas in the dsh-tools value DSL (objects must state
// additionalProperties; nullable fields use oneOf; free JSON uses type json)
function runSummarySchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      runId: { type: 'string', required: true },
      kind: { type: 'string', required: true },
      status: { type: 'string', required: true },
      parentRunId: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
      params: { type: 'object', additionalProperties: true, required: true },
      metrics: { type: 'object', additionalProperties: true, required: true },
      arrays: { type: 'object', additionalProperties: true, required: true },
      engine: { type: 'string', required: true },
      errors: { type: 'array', items: { type: 'string' }, required: true },
    },
  }
}

function resultSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      tool: { type: 'string', required: true },
      state: { type: 'string', required: true },
      operationId: { type: 'string', required: true },
      taskId: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
      run: runSummarySchema(),
      payload: { type: 'json' },
      missingFields: { type: 'array', items: { type: 'string' } },
      message: { type: 'string' },
    },
  }
}

export async function apply(ctx, config) {
  const base = String(config?.scienceUrl ?? 'http://127.0.0.1:8790').replace(/\/+$/, '')
  const token = process.env.PAPER2LAB_API_TOKEN
  const headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }

  const call = async (method, path, body, signal) => {
    const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal })
    const text = await res.text()
    let json
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      throw new Error(`science API ${method} ${path} answered ${res.status} with non-JSON`)
    }
    return { status: res.status, json }
  }

  // the tool catalog is the Registry, read from the science API at boot; an
  // unreachable science API fails the runtime boot instead of offering tools
  // that cannot run
  const { status, json: catalog } = await call('GET', '/api/v1/science/skills')
  if (status !== 200 || !Array.isArray(catalog.tools)) throw new Error(`paper2lab-science: cannot read the skill catalog from ${base} (HTTP ${status})`)
  const computeSkills = catalog.tools.filter((t) => t.runKind)
  if (computeSkills.length === 0) throw new Error('paper2lab-science: the skill catalog lists no compute skills')
  const skillLines = computeSkills.map((t) => `- ${t.name}: ${t.description} Input schema: ${JSON.stringify(t.inputSchema)}`).join('\n')

  /** submit one operation, wait for its terminal state, and read the run */
  const execute = async (tool, exec, body) => {
    const operationId = operationIdFor(exec)
    const submitted = await call('POST', '/api/v1/science/operations', { operationId, ...body }, exec.signal)
    if ([404, 409, 413, 422].includes(submitted.status)) {
      // a refusal BEFORE anything ran (unknown skill, invalid input, missing
      // plan, unknown lineage, conflict): a structured answer the model can act on
      const j = submitted.json
      return { tool, state: String(j.state ?? 'error'), operationId, taskId: null, missingFields: (j.missingFields ?? []).map(String), message: String(j.message ?? j.error ?? `HTTP ${submitted.status}`) }
    }
    if (submitted.status !== 202 && submitted.status !== 200) throw new Error(`science API refused the operation (HTTP ${submitted.status}): ${JSON.stringify(submitted.json).slice(0, 300)}`)
    const taskId = Number(submitted.json.taskId)
    let task
    for (;;) {
      if (exec.signal.aborted) {
        // cooperative cancel: the worker kills ITS engine and confirms exit
        await call('POST', `/api/v1/science/tasks/${taskId}/cancel`).catch(() => {})
        for (let i = 0; i < 120; i++) {
          const t = await call('GET', `/api/v1/science/tasks/${taskId}`).catch(() => null)
          if (t && TERMINAL.has(t.json.status)) break
          await new Promise((r) => setTimeout(r, POLL_MS))
        }
        throw new Error(`cancelled: science task ${taskId} was asked to stop`)
      }
      task = (await call('GET', `/api/v1/science/tasks/${taskId}`)).json
      if (TERMINAL.has(task.status)) break
      await new Promise((r) => setTimeout(r, POLL_MS))
    }
    const op = (await call('GET', `/api/v1/science/operations/${encodeURIComponent(operationId)}`)).json
    const receipt = op.receipt ?? {}
    const value = { tool, state: String(op.status ?? receipt.state ?? task.status), operationId, taskId }
    if (Array.isArray(receipt.missingFields)) value.missingFields = receipt.missingFields.map(String)
    if (receipt.message !== undefined) value.message = String(receipt.message)
    if (receipt.payload !== undefined) value.payload = receipt.payload
    if (op.runId) {
      const runRes = await call('GET', `/api/v1/science/runs/${encodeURIComponent(op.runId)}`)
      if (runRes.status === 200) value.run = summarizeRun(runRes.json.run)
    }
    return value
  }

  const output = { schema: resultSchema(), render: (_args, value) => renderResult(value), presentationMeta: (_args, value) => value }

  ctx.tools.register(defineTool({
    name: 'science_run',
    description: `Run ONE registered scientific skill on the Paper2Lab executor and return the committed ExperimentRun (CALCULATED evidence). The call is governed by a PlayPlan built from exactly this input and your stated goal. Available skills:\n${skillLines}`,
    parameters: {
      skill: { type: 'string', required: true, enum: computeSkills.map((t) => t.name), description: 'Registered skill name.' },
      input: { type: 'object', additionalProperties: true, required: true, description: "The skill's input, matching its schema." },
      goal: { type: 'string', required: true, description: 'What this experiment is meant to show (recorded in its plan).' },
    },
    output,
    timeoutMs: 300_000,
    execute: (args, exec) => execute('science_run', exec, {
      skill: args.skill,
      input: args.input,
      plan: { planId: `plan-${operationIdFor(exec)}`, goal: args.goal, skill: args.skill, inputs: args.input, evidenceBasis: 'agent tool call (DeepSeek Harness)', nonClaims: ['有限尺度数值实验，不构成定理证明'] },
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'science_fork',
    description: 'Re-run an existing ExperimentRun with changed numeric parameters; the new run records the source as its parent. Choose the source run EXPLICITLY — forking from a different run changes both the result and the lineage. Use parameterChanges for absolute values, or parameterScale to multiply the SOURCE run\'s recorded value (e.g. {"a": 2} doubles a), never both for the same parameter.',
    parameters: {
      sourceRunId: { type: 'string', required: true, description: 'The run to fork from.' },
      parameterChanges: { type: 'object', additionalProperties: true, description: 'Parameter name → new absolute numeric value.' },
      parameterScale: { type: 'object', additionalProperties: true, description: "Parameter name → factor applied to the source run's recorded value." },
    },
    output,
    timeoutMs: 300_000,
    execute: async (args, exec) => {
      const changes = {}
      const absolute = args.parameterChanges ?? {}
      const scale = args.parameterScale ?? {}
      for (const [k, v] of Object.entries(absolute)) {
        if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`parameterChanges.${k} must be a finite number`)
        changes[k] = v
      }
      if (Object.keys(scale).length > 0) {
        const src = await call('GET', `/api/v1/science/runs/${encodeURIComponent(args.sourceRunId)}`, undefined, exec.signal)
        if (src.status !== 200) {
          return { tool: 'science_fork', state: 'error', operationId: operationIdFor(exec), taskId: null, message: `Unknown run: ${args.sourceRunId}` }
        }
        const params = src.json.run?.spec?.params ?? {}
        for (const [k, factor] of Object.entries(scale)) {
          if (typeof factor !== 'number' || !Number.isFinite(factor)) throw new Error(`parameterScale.${k} must be a finite number`)
          if (k in changes) throw new Error(`parameter ${k} is given both as an absolute change and a scale factor`)
          if (typeof params[k] !== 'number') {
            return { tool: 'science_fork', state: 'error', operationId: operationIdFor(exec), taskId: null, message: `source run ${args.sourceRunId} records no numeric parameter '${k}' (known: ${Object.keys(params).join(', ') || 'none'})` }
          }
          changes[k] = params[k] * factor
        }
      }
      if (Object.keys(changes).length === 0) throw new Error('science_fork needs parameterChanges or parameterScale')
      return execute('science_fork', exec, { skill: 'experiment.fork', input: { sourceRunId: args.sourceRunId, parameterChanges: changes } })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'science_compare',
    description: 'Compare two committed runs (same-kind metrics side by side, with differences).',
    parameters: {
      runA: { type: 'string', required: true },
      runB: { type: 'string', required: true },
    },
    output,
    timeoutMs: 120_000,
    execute: (args, exec) => execute('science_compare', exec, { skill: 'experiment.compare', input: { runA: args.runA, runB: args.runB } }),
  }))

  ctx.tools.register(defineTool({
    name: 'science_read_run',
    description: 'Read one committed run: kind, status, lineage, parameters and scalar observables. Raw arrays are summarized by length.',
    parameters: { runId: { type: 'string', required: true } },
    output: { schema: runSummarySchema(), render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }], presentationMeta: (_args, value) => ({ tool: 'science_read_run', run: value }) },
    timeoutMs: 30_000,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      const res = await call('GET', `/api/v1/science/runs/${encodeURIComponent(args.runId)}`, undefined, exec.signal)
      if (res.status !== 200) throw new Error(`unknown run ${args.runId} (HTTP ${res.status})`)
      return summarizeRun(res.json.run)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'science_list_runs',
    description: 'List recent committed runs (newest first) with their parameters and lineage, to pick a source run explicitly.',
    parameters: { limit: { type: 'integer', description: 'How many (1–50, default 10).' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { runs: { type: 'array', required: true, items: runSummarySchema() } } },
      render: (_args, value) => [{ type: 'text', text: value.runs.map((r) => `${r.runId} ${r.kind} params=${JSON.stringify(r.params)}${r.parentRunId ? ` parent=${r.parentRunId}` : ''}`).join('\n') || '(no runs)' }],
      presentationMeta: (_args, value) => ({ tool: 'science_list_runs', runIds: value.runs.map((r) => r.runId) }),
    },
    timeoutMs: 30_000,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      const limit = Math.min(50, Math.max(1, Number.isInteger(args.limit) ? args.limit : 10))
      const res = await call('GET', `/api/v1/science/runs?limit=${limit}`, undefined, exec.signal)
      if (res.status !== 200) throw new Error(`run listing failed (HTTP ${res.status})`)
      return { runs: res.json.runs.map((r) => summarizeRun(r.record)) }
    },
  }))

  // hard whitelist at the execution layer: nothing but the tools above runs
  const allowed = new Set(SCIENCE_TOOL_NAMES)
  ctx.tools.guard((execution) => (allowed.has(execution.name) ? undefined : `tool '${execution.name}' is not part of the Paper2Lab research profile`))
}
