// #31: a crashed append can leave a HALF-WRITTEN tail line in the run log —
// restoreRuns must keep every COMPLETE run (before and after the corrupt
// line) instead of losing the whole log on the first JSON.parse failure.
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { restoreRuns, runlogPath } from './engine_persist.ts'

const GOOD = (i: number) => ({
  runId: `persist-tail-run-${i}`,
  spec: { kind: 'formula.value', params: { x: i }, seed: 0 },
  status: 'resolved',
  result: { value: i },
  engine: 'cortex-ce-js',
  engineVersion: '0.142.0',
  durationMs: 0.1,
  evidence: 'CALCULATED',
  createdAt: 1700000000000 + i,
  startedAt: 1700000000000 + i,
  errors: [],
})

describe('engine_persist JSONL corrupt-tail tolerance (#31)', () => {
  let dir: string
  const prevEnv = process.env.PAPER2LAB_DATA_DIR

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'p2l-persist-'))
    process.env.PAPER2LAB_DATA_DIR = dir
  })
  afterAll(() => {
    if (prevEnv === undefined) delete process.env.PAPER2LAB_DATA_DIR
    else process.env.PAPER2LAB_DATA_DIR = prevEnv
    rmSync(dir, { recursive: true, force: true })
  })

  it('a half-written tail line loses ONLY itself — intact runs all restore', () => {
    // 3 complete runs, a crashed half-line (no trailing newline mid-object),
    // then 2 more complete runs appended after a "recovery"
    const lines = [
      JSON.stringify(GOOD(1)),
      JSON.stringify(GOOD(2)),
      JSON.stringify(GOOD(3)),
      '{"runId":"persist-tail-run-4","spec":{"kind":"for', // crashed append
      JSON.stringify(GOOD(5)),
      JSON.stringify(GOOD(6)),
    ]
    writeFileSync(runlogPath(), lines.join('\n') + '\n')
    // GOOD(4) intentionally does NOT exist as a complete line
    const restored = restoreRuns()
    expect(restored).toBe(5) // 1,2,3,5,6 — the corrupt line alone is skipped
    // idempotent re-run: nothing new to import
    expect(restoreRuns()).toBe(0)
  })

  it('a log that is ONLY a corrupt line restores zero and does not throw', () => {
    const dir2 = mkdtempSync(join(tmpdir(), 'p2l-persist2-'))
    const prev = process.env.PAPER2LAB_DATA_DIR
    process.env.PAPER2LAB_DATA_DIR = dir2
    try {
      writeFileSync(runlogPath(), '{"runId": "broken')
      expect(restoreRuns()).toBe(0)
    } finally {
      if (prev === undefined) delete process.env.PAPER2LAB_DATA_DIR
      else process.env.PAPER2LAB_DATA_DIR = prev
      rmSync(dir2, { recursive: true, force: true })
    }
  })
})
