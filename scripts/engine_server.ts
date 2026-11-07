// Paper2Lab backend engine — long-lived Node side of the engine bridge.
// The unified scientific executor (src/skills/executor.ts) is the SAME code
// the browser runs; this process exposes it over newline-delimited JSON on
// stdio so the FastAPI backend can execute registered skills headless.
//
// Boot:  node --import tsx scripts/engine_server.ts     (repo root cwd)
// Wire:  one JSON request object per stdin line → one JSON response line.
// Requests are processed strictly sequentially (deterministic run order).
//
// Ops:
//   {id, op:"ping"}                                         → {id, ok, node, uptimeMs}
//   {id, op:"skills"}                                       → {id, ok, skills:[...meta]}
//   {id, op:"execute", skill, input, planId?, parentRunId?} → {id, ok, outcome}
//   {id, op:"agent_steps", deskKind, steps, base, planId}   → {id, ok, result}
//   {id, op:"runs", limit?, kind?}                          → {id, ok, runs:[...]}
//   {id, op:"export", runIds:[...]}                         → {id, ok, bundle:"..."}
//   {id, op:"import", bundle:"..."}                         → {id, ok, imported:n}
//   {id, op:"shutdown"}                                     → {id, ok} then exit
import { createInterface } from 'node:readline'
import { executeSkill, inputForRun } from '../src/skills/executor.ts'
import { planInputDigest } from '../src/skills/playPlan.ts'
import { runAgentSteps, type DeskKind } from '../src/skills/agentSteps.ts'
import { SKILL_REGISTRY } from '../src/skills/registry.ts'
import { toolCatalog, invokeScientificTool, invokeScientificOperation } from '../src/skills/toolPort.ts'
import { exportExperimentRuns, getExperimentRun, listExperimentRuns, type ExperimentRun } from '../src/experiments/protocol.ts'
import { importRuns } from '../src/experiments/runRepository.ts'
// registers the engine-side mujoco.simulate runner (Node-only kernel)
import '../src/physics/registerMujocoRunner.ts'
// challenge.attempt (playable levels; engine-side kernels)
import '../src/challenges/registerChallengeRunner.ts'
// Lane E: run persistence — every resolved run appends to DATA_DIR; boot
// restores them so a container restart resumes with the original history
import { persistRun, restoreRuns } from './engine_persist.ts'
import { registerPlanFromJson, getPlan } from '../src/skills/playPlan.ts'

const restoredRuns = restoreRuns()

const t0 = Date.now()
let queue: Promise<unknown> = Promise.resolve()

/** A1.3: agent_steps operation ledger — in-process until J1 (same caveat as
 *  toolPort's); keys carry one semantic batch each */
const agentOpsLedger = new Map<string, { digest: string; result: unknown }>()

/** agent-turn runs must persist too (the reply rows carry only summaries;
 *  the full records live in this process's history) */
function _persistAgentSteps(result: { runs: Array<{ runId: string }>; targetRunId?: string | null }): void {
  for (const row of result.runs) {
    const full = getExperimentRun(row.runId)
    if (full?.status === 'resolved') persistRun(full as ExperimentRun)
  }
  const target = result.targetRunId ? getExperimentRun(result.targetRunId) : undefined
  if (target?.status === 'resolved') persistRun(target as ExperimentRun)
}

function send(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + '\n')
  // Lane E: outgoing execute outcomes append to the run log (best-effort)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = (obj as any)?.outcome?.run
  if (run?.runId && run?.status === 'resolved') persistRun(run)
}

async function handle(req: Record<string, unknown>): Promise<Record<string, unknown>> {
  const op = String(req.op ?? '')
  if (op === 'ping') return { ok: true, node: process.version, uptimeMs: Date.now() - t0 }
  if (op === 'skills') {
    return {
      ok: true,
      skills: SKILL_REGISTRY.map((s) => ({
        name: s.name,
        aliases: s.aliases ?? [],
        description: s.description,
        version: s.version,
        deterministic: s.deterministic,
        evidence: s.evidence,
        runKind: s.runKind,
      })),
    }
  }
  if (op === 'tools') {
    // A1.1: the framework-agnostic contract — full catalog WITH schemas, so
    // AgentScope/Python surfaces generate their tool definitions from the
    // registry instead of hand-writing a second list
    return { ok: true, catalog: toolCatalog() }
  }
  if (op === 'tool_execute') {
    // A1.1: one invocation → one receipt envelope over the SAME executor.
    // Inline plan JSON registers first, exactly like the execute op — the
    // port never relaxes the gate for its callers.
    if (req.plan !== undefined) {
      try {
        registerPlanFromJson(req.plan)
      } catch (err) {
        return { ok: false, error: `invalid plan: ${err instanceof Error ? err.message : String(err)}` }
      }
    }
    const baseOpts = {
      planId: typeof req.planId === 'string' ? req.planId : undefined,
      parentRunId: typeof req.parentRunId === 'string' ? req.parentRunId : undefined,
      ...(req.source !== undefined ? { source: req.source } : {}),
      ...(typeof req.invocationId === 'string' ? { invocationId: req.invocationId } : {}),
    }
    // A1.2: an operationId routes through the operation ledger — retries
    // replay the recorded receipt; same key with a different payload conflicts
    const receipt = typeof req.operationId === 'string'
      ? await invokeScientificOperation(
          {
            operationId: req.operationId,
            ...(typeof req.idempotencyKey === 'string' ? { idempotencyKey: req.idempotencyKey } : {}),
            ...(typeof req.workspace === 'string' ? { workspace: req.workspace } : {}),
            skill: String(req.skill),
            input: req.input ?? {},
          },
          baseOpts,
        )
      : await invokeScientificTool(String(req.skill), req.input ?? {}, baseOpts)
    return { ok: true, receipt }
  }
  if (op === 'plan') {
    // #32: remote callers register a full PlayPlan (shape-checked); execute
    // then accepts its planId. Re-submitting the SAME contract (createdAt
    // aside) is idempotent; a DIFFERENT contract under a known planId is a
    // conflict error.
    try {
      const plan = registerPlanFromJson(req.plan)
      return { ok: true, planId: plan.planId, known: getPlan(plan.planId) === plan }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
  if (op === 'execute') {
    if (req.plan !== undefined) {
      try {
        registerPlanFromJson(req.plan)
      } catch (err) {
        return { ok: false, error: `invalid plan: ${err instanceof Error ? err.message : String(err)}` }
      }
    }
    const outcome = await executeSkill(String(req.skill), req.input ?? {}, {
      planId: typeof req.planId === 'string' ? req.planId : undefined,
      parentRunId: typeof req.parentRunId === 'string' ? req.parentRunId : undefined,
      // S1.1 follow-through: provenance anchor from the HTTP/agent caller
      ...(req.source !== undefined ? { source: req.source } : {}),
    })
    return { ok: true, outcome }
  }
  if (op === 'agent_steps') {
    // full agent turn server-side: base skill + steps, everything through
    // the SAME registry-validated executor the browser runs
    if (req.plan !== undefined) {
      try {
        registerPlanFromJson(req.plan)
      } catch (err) {
        return { ok: false, error: `invalid plan: ${err instanceof Error ? err.message : String(err)}` }
      }
    }
    // A1.3: a baseRunId chains the batch onto the RECORDED run's replayable
    // input (the agent turn's latest run) instead of a re-read original base
    let base = (req.base ?? {}) as Record<string, unknown>
    if (typeof req.baseRunId === 'string') {
      const resolved = inputForRun(req.baseRunId)
      if ('error' in resolved) {
        return { ok: false, error: `baseRunId cannot be resolved: ${resolved.error}` }
      }
      base = resolved.input as Record<string, unknown>
    }
    // A1.3: one operationId → one execution. An identical retry replays the
    // recorded result (zero duplicate forks); a different payload under the
    // same id is refused. In-process until J1 persists the ledger.
    if (typeof req.operationId === 'string') {
      const digest = planInputDigest({ desk: req.deskKind, steps: req.steps, base })
      const hit = agentOpsLedger.get(req.operationId)
      if (hit) {
        if (hit.digest !== digest) {
          return { ok: false, error: `operation conflict: '${req.operationId}' is recorded with a different batch` }
        }
        return { ok: true, result: hit.result, replayed: true }
      }
      const result = await runAgentSteps(
        String(req.deskKind) as DeskKind,
        Array.isArray(req.steps) ? (req.steps as never) : [],
        base,
        typeof req.planId === 'string' ? req.planId : `plan-engine-${Date.now()}`,
      )
      _persistAgentSteps(result)
      if (agentOpsLedger.size >= 256) {
        const oldest = agentOpsLedger.keys().next().value
        if (oldest !== undefined) agentOpsLedger.delete(oldest)
      }
      agentOpsLedger.set(req.operationId, { digest, result })
      return { ok: true, result }
    }
    const result = await runAgentSteps(
      String(req.deskKind) as DeskKind,
      Array.isArray(req.steps) ? (req.steps as never) : [],
      base,
      typeof req.planId === 'string' ? req.planId : `plan-engine-${Date.now()}`,
    )
    _persistAgentSteps(result)
    return { ok: true, result }
  }
  if (op === 'run_input') {
    // chaining contract: the replayable base input of a recorded run, so a
    // follow-up turn continues from the LATEST run (not the first one)
    const out = inputForRun(String(req.runId))
    return 'error' in out ? { ok: false, error: out.error } : { ok: true, skill: out.skill, input: out.input }
  }
  if (op === 'runs') {
    // once-runner executions (engine_api's inline path) complete in a
    // DIFFERENT short-lived process; their persisted runs must be visible
    // here too — re-sync from the run log before listing (runId-deduped,
    // idempotent, small file)
    restoreRuns()
    const runs = listExperimentRuns({
      kind: typeof req.kind === 'string' ? (req.kind as never) : undefined,
      limit: typeof req.limit === 'number' ? req.limit : 50,
    })
    return { ok: true, runs }
  }
  if (op === 'export') {
    const ids = Array.isArray(req.runIds) ? req.runIds.map(String) : []
    return { ok: true, bundle: exportExperimentRuns(ids) }
  }
  if (op === 'import') {
    const text = typeof req.bundle === 'string' ? req.bundle : ''
    const { imported } = importRuns(text)
    return { ok: true, imported }
  }
  if (op === 'shutdown') return { ok: true, exit: true }
  return { ok: false, error: `unknown op: ${op || '(none)'}` }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  const text = line.trim()
  if (!text) return
  let req: Record<string, unknown>
  try {
    req = JSON.parse(text)
  } catch {
    send({ id: null, ok: false, error: 'malformed JSON line' })
    return
  }
  // serialize: run order must match request order (deterministic lineage)
  queue = queue
    .then(async () => {
      try {
        const res = await handle(req)
        send({ id: req.id ?? null, ...res })
        if (res.exit) process.exit(0)
      } catch (err) {
        send({ id: req.id ?? null, ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    })
    .catch(() => {})
})
process.on('SIGTERM', () => process.exit(0))
send({ ok: true, event: 'engine-ready', node: process.version, restoredRuns })
