// Serverless-friendly engine: runs ONE skill execution from the prebuilt
// bundle as a SHORT-LIVED process (spawned per request, exits when done).
// The ModelScope FC runtime freezes background children between invocations,
// so a long-lived stdio engine starves there — a per-request process lives
// entirely inside the HTTP call and cannot be frozen mid-flight.
//
// Usage: node scripts/engine_once.mjs <skill> <inputJson> [planId] [parentRunId] [planJson] [sourceJson]
// Prints the outcome JSON to stdout.
//
// J1.2a candidate mode: node scripts/engine_once.mjs --candidate
// reads ONE request JSON from stdin {skill, input, planId?, plan?, parentRunId?,
// source?, priorRuns?, priorPlans?} and prints {outcome} — the CANDIDATE only.
// No run log is read or written: the Node science worker owns persistence (a
// fenced PostgreSQL transaction), and lineage parents plus the plans governing
// them arrive from that database as priorRuns/priorPlans.
import { executeSkill } from '../src/skills/executor.ts'
import { Worker } from 'node:worker_threads'
import '../src/physics/registerMujocoRunner.ts'
import '../src/challenges/registerChallengeRunner.ts'
import { persistRun } from './engine_persist.ts'
import { registerPlanFromJson } from '../src/skills/playPlan.ts'
import { restoreRuns } from './engine_persist.ts'
import { importRuns } from '../src/experiments/runRepository.ts'

// Wait for the pipe to drain before exiting: larger curve Runs otherwise
// truncate under an HTTP/uvloop parent even though the computation succeeded.
// `timing` (candidate mode) rides beside the outcome: same-process monotonic
// spans of THIS engine process — never part of the outcome or the Run.
async function writeOutcomeAndExit(outcome: unknown, timing?: Record<string, number>): Promise<never> {
  const payload = JSON.stringify(timing ? { outcome, timing } : { outcome })
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(payload, (error) => error ? reject(error) : resolve())
  })
  process.exit(0)
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

async function runCandidate(): Promise<never> {
  // performance.now() counts from this process's time origin: at entry it is
  // the Node boot + bundle import/evaluation cost this request paid
  const bootMs = performance.now()
  // the owning worker supervises this process; if that worker dies, the OS
  // reparents us — stop instead of computing for nobody (an orphaned engine
  // would keep burning CPU after its attempt was already fenced out). The
  // watch runs on a worker THREAD: kernels compute synchronously, so a
  // main-thread timer would never fire mid-compute. The expected owner comes
  // from the spawner (PAPER2LAB_ENGINE_OWNER_PID) so an owner that died
  // before this process even started is caught too.
  const owner = Number(process.env.PAPER2LAB_ENGINE_OWNER_PID) || process.ppid
  new Worker(
    "const { workerData } = require('node:worker_threads'); setInterval(() => { if (process.ppid !== workerData.owner) process.kill(process.pid, 'SIGKILL') }, 500)",
    { eval: true, workerData: { owner } },
  ).unref()
  let req: Record<string, unknown>
  const readStarted = performance.now()
  try {
    req = JSON.parse(await readStdin()) as Record<string, unknown>
  } catch (e) {
    console.error(`invalid candidate request JSON: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(2)
  }
  const readMs = performance.now() - readStarted
  if (typeof req.skill !== 'string' || !req.skill) {
    console.error('candidate request needs a skill')
    process.exit(2)
  }
  const refuse = (message: string) => writeOutcomeAndExit({ status: 'error', code: 'invalid_input', message })
  // lineage first: a fork reads its parent through the in-process history
  if (Array.isArray(req.priorRuns) && req.priorRuns.length > 0) {
    try {
      importRuns(JSON.stringify(req.priorRuns))
    } catch (e) {
      return refuse(`lineage import refused: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const plans = [...(Array.isArray(req.priorPlans) ? req.priorPlans : []), ...(req.plan ? [req.plan] : [])]
  for (const plan of plans) {
    try {
      registerPlanFromJson(plan)
    } catch (e) {
      return refuse(`invalid plan: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const planId = typeof req.planId === 'string' ? req.planId : (req.plan as { planId?: unknown } | undefined)?.planId
  const executeStarted = performance.now()
  const outcome = await executeSkill(req.skill, req.input ?? {}, {
    ...(typeof planId === 'string' ? { planId } : {}),
    ...(typeof req.parentRunId === 'string' ? { parentRunId: req.parentRunId } : {}),
    ...(req.source !== undefined && req.source !== null ? { source: req.source } : {}),
  })
  // executeMs covers plan gate + compile + compute + sealing; the Run's own
  // durationMs is the narrower executeSpec span inside it
  return writeOutcomeAndExit(outcome, {
    bootMs: Math.round(bootMs),
    readMs: Math.round(readMs),
    executeMs: Math.round(performance.now() - executeStarted),
  })
}

async function runLegacy(): Promise<never> {
  // #34: a fresh once-process must see earlier runs (fork lineage over
  // HTTP spans multiple once invocations) — restore from the shared runlog
  restoreRuns()
  const skill = process.argv[2]
  if (!skill) {
    console.error('usage: engine_once.mjs <skill> <inputJson> [planId] [parentRunId]')
    process.exit(2)
  }
  let input = {}
  try {
    input = JSON.parse(process.argv[3] ?? '{}')
  } catch (e) {
    console.error(`invalid input JSON: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(2)
  }
  const opts = {
    planId: process.argv[4] ?? `plan-once-${Date.now()}`,
    ...(process.argv[5] ? { parentRunId: process.argv[5] } : {}),
  }
  // #32: optional inline plan JSON (argv[6]) registers before the strict gate
  if (process.argv[6]) {
    try {
      registerPlanFromJson(JSON.parse(process.argv[6]))
    } catch (e) {
      console.error(`invalid plan JSON: ${e instanceof Error ? e.message : String(e)}`)
      process.exit(2)
    }
  }
  // S1.1 follow-through: the HTTP entry passes the caller's provenance anchor
  // through so server-side Runs keep their source (argv[7])
  let sourceOpt: unknown
  if (process.argv[7]) {
    try {
      sourceOpt = JSON.parse(process.argv[7])
    } catch (e) {
      console.error(`invalid source JSON: ${e instanceof Error ? e.message : String(e)}`)
      process.exit(2)
    }
  }
  const outcome = await executeSkill(skill, input, { ...opts, ...(sourceOpt !== undefined ? { source: sourceOpt } : {}) })
  // append to the shared run log so the long-lived engine's /runs (which
  // re-syncs from the same file) lists once-runner executions too — without
  // this, a run completed inline would be invisible to run-history queries
  if (outcome.status === 'ok' && outcome.run?.status === 'resolved') {
    persistRun(outcome.run)
  }
  return writeOutcomeAndExit(outcome)
}

if (process.argv[2] === '--candidate') await runCandidate()
else await runLegacy()
