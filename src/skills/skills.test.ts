import { describe, expect, it } from 'vitest'
import { getEvidenceLog, getSkill, listSkills, registerSkill, runSkill, validateInput } from './types'
import './index' // registers all skills
import { computeVoxelCoverage, type VoxelMetrics } from '../kakeya/voxels3d'
import { makeTubes } from '../kakeya/tubes'
import { fibonacciDirections } from '../kakeya/directions'

function healthyMetrics(): VoxelMetrics {
  const tubes = makeTubes(fibonacciDirections(16), 0.125, 0)
  const r = computeVoxelCoverage(tubes, 32)
  const { visGrid: _v, ...m } = r
  return m
}

describe('skills registry', () => {
  it('registers all seven families', () => {
    const families = new Set(listSkills().map((s) => s.family))
    for (const f of ['inspect', 'simulate', 'measure', 'compare', 'infer', 'trace', 'verify']) {
      expect(families.has(f as never)).toBe(true)
    }
    expect(listSkills().length).toBeGreaterThanOrEqual(9)
  })

  it('rejects duplicate registration and unknown skills', () => {
    expect(() => registerSkill(getSkill('inspect.configuration'))).toThrow(/already registered/)
    expect(() => getSkill('nope.nope')).toThrow(/unknown skill/)
  })

  it('validates required fields and primitive types', () => {
    const s = getSkill('inspect.configuration')
    expect(validateInput(s, {})).toMatch(/missing required/)
    expect(validateInput(s, { delta: 'x', nTubes: 4, packing: 0 })).toMatch(/must be number/)
    expect(validateInput(s, { delta: 0.1, nTubes: 4, packing: 0 })).toBeNull()
  })

  it('stamps every run into the evidence log with cell versions', async () => {
    const before = getEvidenceLog().length
    const out = await runSkill<{ minSepDeg: number }>('inspect.configuration', {
      delta: 0.125,
      nTubes: 32,
      packing: 0,
    })
    expect(out.minSepDeg).toBeGreaterThan(0)
    const rec = getEvidenceLog()[getEvidenceLog().length - 1]
    expect(rec.skillId).toBe('inspect.configuration')
    expect(rec.cellVersions['kakeya.dirs']).toBeGreaterThan(0)
    expect(getEvidenceLog().length).toBe(before + 1)
  })

  it('runSkill rejects invalid input', async () => {
    await expect(runSkill('inspect.configuration', { delta: 1 })).rejects.toThrow(/missing required/)
  })
})

describe('inspect.configuration', () => {
  it('classifies regime and δ-separation', async () => {
    const out = await runSkill<{ regime: string; deltaSeparated: boolean }>('inspect.configuration', {
      delta: 0.0625,
      nTubes: 96,
      packing: 0.9,
    })
    expect(out.regime).toBe('sticky')
    expect(out.deltaSeparated).toBe(true)
  })
})

describe('compare.configurations', () => {
  it('computes per-metric deltas between two snapshots', async () => {
    const a = { label: 'A', delta: 0.125, nTubes: 16, packing: 0, occupiedVolume: 0.2, sumTubeVolume: 0.4, maxMultiplicity: 2, avgMultiplicity: 1.1 }
    const b = { label: 'B', delta: 0.125, nTubes: 16, packing: 1, occupiedVolume: 0.15, sumTubeVolume: 0.4, maxMultiplicity: 16, avgMultiplicity: 1.3 }
    const out = await runSkill<{ rows: Array<{ metric: string; a: number; b: number; delta: number }> }>(
      'compare.configurations',
      { a, b },
    )
    const maxRow = out.rows.find((r) => r.metric.includes('max multiplicity'))!
    expect(maxRow.delta).toBe(14)
    const unionRow = out.rows.find((r) => r.metric.includes('⋃T'))!
    expect(unionRow.delta).toBeCloseTo(-0.05, 10)
  })
})

describe('infer.observation', () => {
  it('is AI_INFERENCE and quotes only given numbers', async () => {
    const out = await runSkill<{ reading: string; disclaimer: string }>('infer.observation', {
      occupiedVolume: 0.5,
      sumTubeVolume: 1.2,
      maxMultiplicity: 96,
      avgMultiplicity: 2.2,
      packing: 1,
      delta: 0.0625,
    })
    expect(getSkill('infer.observation').evidence_type).toBe('AI_INFERENCE')
    expect(out.reading).toContain('96')
    expect(out.disclaimer).toContain('AI_INFERENCE')
  })
})

describe('trace.evidence', () => {
  it('produces param → cell → skill → paper chain for the voxel target', async () => {
    const out = await runSkill<{ chain: Array<{ kind: string; id: string }> }>('trace.evidence', {
      target: 'kakeya.voxel',
    })
    const kinds = out.chain.map((c) => c.kind)
    expect(kinds).toContain('param')
    expect(kinds).toContain('cell')
    expect(kinds).toContain('skill')
    expect(kinds).toContain('paper')
    expect(out.chain.find((c) => c.id === 'kakeya.voxel')).toBeDefined()
  })
})

describe('verify.invariants', () => {
  it('passes on healthy kernel metrics', async () => {
    const m = healthyMetrics()
    const out = await runSkill<{ checks: Array<{ pass: boolean }>; allPass: boolean }>('verify.invariants', {
      metrics: m,
      packing: 0,
      nTubes: 16,
    })
    expect(out.allPass).toBe(true)
  })

  it('catches fabricated violations (Σ|T| < |⋃T| is impossible)', async () => {
    const m = healthyMetrics()
    const bad = { ...m, sumTubeVolume: m.occupiedVolume * 0.5 }
    const out = await runSkill<{ allPass: boolean; checks: Array<{ name: string; pass: boolean }> }>(
      'verify.invariants',
      { metrics: bad, packing: 0, nTubes: 16 },
    )
    expect(out.allPass).toBe(false)
    expect(out.checks.find((c) => c.name.includes('次可加性'))!.pass).toBe(false)
  })

  it('sticky exactness: packing=1 requires max m = N', async () => {
    const tubes = makeTubes(fibonacciDirections(24), 0.125, 1)
    const { visGrid: _v, ...m } = computeVoxelCoverage(tubes, 32)
    const out = await runSkill<{ allPass: boolean }>('verify.invariants', { metrics: m, packing: 1, nTubes: 24 })
    expect(out.allPass).toBe(true) // max m must equal 24 exactly
  })
})

describe('verify.pyodide_numpy', () => {
  it('degrades gracefully where Workers are unavailable (node test env)', async () => {
    const out = await runSkill<{ available: boolean; reason?: string }>('verify.pyodide_numpy', { delta: 0.125 })
    expect(out.available).toBe(false)
    expect(out.reason).toBeTruthy()
  })
})
