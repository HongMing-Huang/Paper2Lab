// J1.2a regression (review M-1): the engine process a worker spawns must not
// outlive that worker. This drives the SHIPPED bundle (scripts/engine_once.mjs,
// the artifact resolveEngineCommand prefers) — a guard that exists only in the
// TS source and not in the bundle fails here.
import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { processAlive, resolveEngineCommand } from './engine.ts'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ORPHAN_PARENT = resolve(REPO_ROOT, 'server', 'node', 'testdata', 'orphan-parent.mjs')
// a real ~10 s Kakeya measurement: long enough that only the guard can stop it early
const LONG_REQUEST = '{"skill":"kakeya.measure","input":{"deltaExp":-3,"nTubes":400,"packing":0.5,"res":220},"plan":{"planId":"plan-j12a-orphan","goal":"orphan guard","skill":"kakeya.measure","inputs":{}}}'

describe('J1.2a — engine orphan guard', () => {
  test('an engine whose owning worker dies exits by itself', { timeout: 30_000 }, async () => {
    expect(resolveEngineCommand(REPO_ROOT).artifact.mode).toBe('bundle')
    const started = spawnSync(process.execPath, [ORPHAN_PARENT], { cwd: REPO_ROOT, encoding: 'utf8', input: LONG_REQUEST })
    expect(started.status).toBe(0)
    const pid = Number(started.stdout.trim())
    expect(pid).toBeGreaterThan(0)
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline && processAlive(pid)) await new Promise((r) => setTimeout(r, 100))
    // gone within seconds — far before the ~10 s compute could have finished
    expect(processAlive(pid)).toBe(false)
  })
})
