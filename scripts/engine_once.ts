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
const outcome = await executeSkill(skill, input, opts)
process.stdout.write(JSON.stringify({ outcome }))
process.exit(0)
