// High-scale precompute chain (backend engine ← C++ rows → ExperimentRun
// bundle → atomic idempotent import → real runIds on datapoints).
import { describe, expect, it } from 'vitest'
import { getExperimentRun } from '../experiments/protocol'
import bundle from '../data/kakeya-precomputed-runs.json'
import { executeSkill } from '../skills/executor'
import { kakeya } from './kakeyaGraph'
import { ensurePrecomputedRuns, precomputedPointsCell, pPrecomputedNonce } from './precomputedRuns'
import { buildPlan } from '../skills/playPlan'

const plan = buildPlan({ skill: 'kakeya.measure', goal: 'precomputedRuns.test.ts 计划' })

describe('C++ precomputed bundle', () => {
  it('bundle shape: 63 sealed rows with checksum + res up to 1024 (billion-voxel tier)', () => {
    const b = bundle as { meta: { rowCount: number; checksumFnv1a: string; algorithmVersion: string }; runs: Array<{ runId: string; spec: { res: number; params: { deltaExp: number; packing: number; nTubes: number } }; engine: string }> }
    expect(b.meta.rowCount).toBeGreaterThanOrEqual(63)
    expect(b.meta.checksumFnv1a).toMatch(/^[0-9a-f]{16}$/)
    expect(b.meta.algorithmVersion).toBe('kakeya-voxel-v3-cpp')
    const maxRes = Math.max(...b.runs.map((r) => r.spec.res))
    expect(maxRes).toBeGreaterThanOrEqual(1024) // 1024³ ≈ 1.07×10⁹ voxels
    expect(new Set(b.runs.map((r) => r.runId)).size).toBe(b.runs.length) // unique stable ids
    expect(b.runs.every((r) => r.engine === 'cpp-precompute')).toBe(true)
    // the extreme tier exists at all three packings × N values
    const d10 = b.runs.filter((r) => r.spec.params.deltaExp === 10)
    expect(d10.length).toBe(9)
  })

  it('extreme-tier physics sanity: packing=1 ⇒ maxM=N exactly; Σ|T| tracks N·πδ²', () => {
    const b = bundle as { runs: Array<{ spec: { params: { deltaExp: number; packing: number; nTubes: number } }; result: { maxMultiplicity: number; sumTubeVolume: number; occupiedVolume: number } }> }
    for (const r of b.runs.filter((x) => x.spec.params.deltaExp === 10 && x.spec.params.packing === 1)) {
      expect(r.result.maxMultiplicity).toBe(r.spec.params.nTubes) // all tubes through one centre
    }
    const est = 256 * Math.PI * (2 ** -10) ** 2 // N·πδ² (unit-ish mean length)
    const got = b.runs.find((x) => x.spec.params.deltaExp === 10 && x.spec.params.packing === 0 && x.spec.params.nTubes === 256)!.result.sumTubeVolume
    expect(got).toBeGreaterThan(est * 0.8)
    expect(got).toBeLessThan(est * 1.4)
    // thin-tube regime: union grows ~linearly with N (almost no overlap)
    const p0 = b.runs.filter((x) => x.spec.params.deltaExp === 10 && x.spec.params.packing === 0).sort((a, z) => a.spec.params.nTubes - z.spec.params.nTubes)
    expect(p0[2].result.occupiedVolume / p0[0].result.occupiedVolume).toBeGreaterThan(3.5) // 4× tubes ≈ 4× union
  })

  it('ensurePrecomputedRuns imports atomically, idempotently (offline fallback)', async () => {
    const first = await ensurePrecomputedRuns()
    expect(first.imported).toBeGreaterThanOrEqual(63)
    expect(first.imported + first.skipped).toBe((bundle as { runs: unknown[] }).runs.length)
    // every imported run is now traceable
    expect(getExperimentRun('kakeya-cpp-d10-p0-n256')).toBeDefined()
    expect(getExperimentRun('kakeya-cpp-d10-p0-n256')?.engine).toBe('cpp-precompute')
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
    // δ slider into the billion-voxel tier selects the extreme rows
    kakeya.setParam('kakeya.deltaExp', 10)
    kakeya.setParam(pPrecomputedNonce.id, Date.now())
    const deep = kakeya.get(precomputedPointsCell.id).value as Array<{ runId: string; y: number }>
    expect(deep.length).toBe(3)
    expect(deep[0].runId).toContain('d10')
    expect(deep.every((p) => p.y > 0 && p.y < 0.01)).toBe(true) // thin-tube regime
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
