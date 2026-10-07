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
import { runAgentSteps, type DeskKind } from '../src/skills/agentSteps.ts'
import { SKILL_REGISTRY } from '../src/skills/registry.ts'
import { exportExperimentRuns, getExperimentRun, listExperimentRuns, type ExperimentRun } from '../src/experiments/protocol.ts'
import { importRuns } from '../src/experiments/runRepository.ts'
// registers the engine-side mujoco.simulate runner (Node-only kernel)
import '../src/physics/registerMujocoRunner.ts'
// challenge.attempt (playable levels; engine-side kernels)
import '../src/challenges/registerChallengeRunner.ts'
// Lane E: run persistence — every resolved run appends to DATA_DIR; boot
// restores them so a container restart resumes with the original history
import { persistRun, restoreRuns } from './engine_persist.ts'

const restoredRuns = restoreRuns()

const t0 = Date.now()
let queue: Promise<unknown> = Promise.resolve()

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
  if (op === 'execute') {
    const outcome = await executeSkill(String(req.skill), req.input ?? {}, {
      planId: typeof req.planId === 'string' ? req.planId : undefined,
      parentRunId: typeof req.parentRunId === 'string' ? req.parentRunId : undefined,
    })
    return { ok: true, outcome }
  }
  if (op === 'agent_steps') {
    // full agent turn server-side: base skill + steps, everything through
    // the SAME registry-validated executor the browser runs
    const result = await runAgentSteps(
      String(req.deskKind) as DeskKind,
      Array.isArray(req.steps) ? (req.steps as never) : [],
      (req.base ?? {}) as Record<string, unknown>,
      typeof req.planId === 'string' ? req.planId : `plan-engine-${Date.now()}`,
    )
    // agent-turn runs must persist too (the reply rows carry only summaries;
    // the full records live in this process's history — persist them here)
    for (const row of result.runs) {
      const full = getExperimentRun(row.runId)
      if (full?.status === 'resolved') persistRun(full as ExperimentRun)
    }
    const target = result.targetRunId ? getExperimentRun(result.targetRunId) : undefined
    if (target?.status === 'resolved') persistRun(target as ExperimentRun)
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
