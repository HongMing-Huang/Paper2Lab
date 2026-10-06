// Engine run persistence (Lane E): the engine child appends every completed
// ExperimentRun to an append-only JSONL log under PAPER2LAB_DATA_DIR and
// replays it (via the run repository's atomic import) on boot — a container
// restart therefore RESUMES with the original runs still referenceable.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { listExperimentRuns, type ExperimentRun } from '../src/experiments/protocol.ts'
import { importRuns } from '../src/experiments/runRepository.ts'

const RUNLOG = 'engine-runs.jsonl'

export function runlogPath(): string {
  const dir = process.env.PAPER2LAB_DATA_DIR || join(process.cwd(), 'server', 'data')
  try { mkdirSync(dir, { recursive: true }) } catch { /* read-only fs: persistence off */ }
  return join(dir, RUNLOG)
}

/** append a resolved run to the log (best-effort; never throws into physics) */
export function persistRun(run: ExperimentRun): void {
  try {
    if (run.status !== 'resolved') return
    appendFileSync(runlogPath(), JSON.stringify(run) + '\n')
  } catch {
    /* unwritable disk: /api/ready storage check reports it */
  }
}

/** reload historical runs on engine boot; returns how many were restored */
export function restoreRuns(): number {
  try {
    const path = runlogPath()
    if (!existsSync(path)) return 0
    const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim())
    const known = new Set(listExperimentRuns({ limit: 100000 }).map((r) => r.runId))
    const fresh = lines
      .map((l) => JSON.parse(l) as ExperimentRun)
      .filter((r) => !known.has(r.runId))
    if (fresh.length === 0) return 0
    importRuns(JSON.stringify(fresh))
    return fresh.length
  } catch {
    return 0 // a corrupt tail line must never block engine boot
  }
}
void dirname
