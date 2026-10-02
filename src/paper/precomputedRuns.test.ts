// High-scale precompute chain (backend engine ← C++ rows → ExperimentRun
// bundle → atomic idempotent import → real runIds on datapoints).
import { describe, expect, it } from 'vitest'
import { getExperimentRun } from '../experiments/protocol'
import bundle from '../data/kakeya-precomputed-runs.json'
import { executeSkill } from '../skills/executor'
import { kakeya } from './kakeyaGraph'
import { ensurePrecomputedRuns, precomputedPointsCell, pPrecomputedNonce } from './precomputedRuns'

const plan = { planId: 'plan-precomputed' }

describe('C++ precomputed bundle', () => {
  it('bundle shape: 45 sealed rows with checksum + res up to 320', () => {
    const b = bundle as { meta: { rowCount: number; checksumFnv1a: string; algorithmVersion: string }; runs: Array<{ runId: string; spec: { res: number }; engine: string }> }
    expect(b.meta.rowCount).toBeGreaterThanOrEqual(45)
    expect(b.meta.checksumFnv1a).toMatch(/^[0-9a-f]{16}$/)
    expect(b.meta.algorithmVersion).toBe('kakeya-voxel-v3-cpp')
    const maxRes = Math.max(...b.runs.map((r) => r.spec.res))
    expect(maxRes).toBeGreaterThanOrEqual(320) // high-scale tier present
    expect(new Set(b.runs.map((r) => r.runId)).size).toBe(b.runs.length) // unique stable ids
    expect(b.runs.every((r) => r.engine === 'cpp-precompute')).toBe(true)
  })

  it('ensurePrecomputedRuns imports atomically, idempotently (offline fallback)', async () => {
    const first = await ensurePrecomputedRuns()
    expect(first.imported).toBeGreaterThanOrEqual(45)
    expect(first.imported + first.skipped).toBe((bundle as { runs: unknown[] }).runs.length)
    // every imported run is now traceable
    expect(getExperimentRun('kakeya-cpp-d8-p0-n256')).toBeDefined()
    expect(getExperimentRun('kakeya-cpp-d8-p0-n256')?.engine).toBe('cpp-precompute')
    // second load: nothing new, nothing thrown (atomic preflight accepts all-known)
    const second = await ensurePrecomputedRuns()
    expect(second.imported).toBe(0)
  })

  it('points cell emits REAL runIds for the current δ/packing', () => {
    kakeya.setParam('kakeya.deltaExp', 4)
    kakeya.setParam(pPrecomputedNonce.id, Date.now()) // recompute after import
    const points = kakeya.get(precomputedPointsCell.id).value as Array<{ x: number; y: number; runId: string }>
    expect(points.length).toBe(3) // N ∈ {64,128,256} at δ=2⁻⁴, packing 0
    expect(points.map((p) => p.x)).toEqual([64, 128, 256])
    for (const p of points) expect(getExperimentRun(p.runId)).toBeDefined() // traceable
    // δ slider beyond the old clamp still resolves (high-scale rows exist)
    kakeya.setParam('kakeya.deltaExp', 8)
    kakeya.setParam(pPrecomputedNonce.id, Date.now())
    const deep = kakeya.get(precomputedPointsCell.id).value as Array<{ runId: string }>
    expect(deep.length).toBe(3)
    expect(deep[0].runId).toContain('d8')
  })
})

describe('cross-engine consistency: node executor vs C++ rows', () => {
  it('kakeya.measure reproduces the C++ row (δ=2⁻⁴, packing 0, res 96, N 64)', async () => {
    const out = await executeSkill('kakeya.measure', { deltaExp: 4, packing: 0, res: 96, nTubes: 64 }, plan)
    expect(out.status).toBe('ok')
    if (out.status !== 'ok' || !out.run) return
    const cppRow = (bundle as { runs: Array<{ runId: string; result: { occupiedVolume: number } }> }).runs.find(
      (r) => r.runId === 'kakeya-cpp-d4-p0-n64',
    )
    expect(cppRow).toBeDefined()
    const mine = (out.run.result as { occupiedVolume: number }).occupiedVolume
    const rel = Math.abs(mine - cppRow!.result.occupiedVolume) / cppRow!.result.occupiedVolume
    expect(rel).toBeLessThan(1e-6) // deterministic port: same kernels/seed
  })
})
