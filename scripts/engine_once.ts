// Serverless-friendly engine: runs ONE skill execution from the prebuilt
// bundle as a SHORT-LIVED process (spawned per request, exits when done).
// The ModelScope FC runtime freezes background children between invocations,
// so a long-lived stdio engine starves there — a per-request process lives
// entirely inside the HTTP call and cannot be frozen mid-flight.
//
// Usage: node scripts/engine_once.mjs <skill> <inputJson> [planId] [parentRunId]
// Prints the outcome JSON to stdout.
import { executeSkill } from '../src/skills/executor.ts'
import '../src/physics/registerMujocoRunner.ts'
import '../src/challenges/registerChallengeRunner.ts'
import { persistRun } from './engine_persist.ts'
import { registerPlanFromJson } from '../src/skills/playPlan.ts'

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
  registerPlanFromJson(JSON.parse(process.argv[6]))
}
const outcome = await executeSkill(skill, input, opts)
// append to the shared run log so the long-lived engine's /runs (which
// re-syncs from the same file) lists once-runner executions too — without
// this, a run completed inline would be invisible to run-history queries
if (outcome.status === 'ok' && outcome.run?.status === 'resolved') {
  persistRun(outcome.run)
}
process.stdout.write(JSON.stringify({ outcome }))
process.exit(0)
