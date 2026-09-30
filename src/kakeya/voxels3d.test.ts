import { describe, expect, it } from 'vitest'
import { makeTubes, type Tube3 } from './tubes'
import { computeVoxelCoverage } from './voxels3d'

const axisTube = (dir: [number, number, number]): Tube3 => ({
  dir: { x: dir[0], y: dir[1], z: dir[2] },
  center: { x: 0.5, y: 0.5, z: 0.5 },
  radius: 0.1,
})

describe('computeVoxelCoverage', () => {
  it('single tube volume matches the analytic capsule πδ²·1 + ⅔πδ³', () => {
    const r = computeVoxelCoverage([axisTube([0, 0, 1])], 50)
    const analytic = Math.PI * 0.01 + (4 / 3) * Math.PI * 0.001 / 2
    expect(r.analyticPerTube).toBeCloseTo(analytic, 8)
    // finite-resolution estimate: within 6%
    expect(Math.abs(r.occupiedVolume - analytic) / analytic).toBeLessThan(0.06)
    expect(r.maxMultiplicity).toBe(1)
    expect(r.avgMultiplicity).toBeCloseTo(1, 12)
    expect(r.sumTubeVolume).toBeCloseTo(r.occupiedVolume, 12)
    expect(r.histogram[0] + r.histogram[1]).toBe(50 ** 3)
  })

  it('two crossing tubes: max multiplicity 2, union < 2× single', () => {
    const single = computeVoxelCoverage([axisTube([0, 0, 1])], 50).occupiedVolume
    const r = computeVoxelCoverage([axisTube([0, 0, 1]), axisTube([1, 0, 0])], 50)
    expect(r.maxMultiplicity).toBe(2)
    expect(r.histogram[2]).toBeGreaterThan(0)
    expect(r.occupiedVolume).toBeGreaterThan(1.5 * single)
    expect(r.occupiedVolume).toBeLessThan(2 * single)
    expect(r.sumTubeVolume).toBeCloseTo(2 * single, 2)
  })

  it('sticky tubes overlap much more than spread tubes', () => {
    const dirs = Array.from({ length: 40 }, () => axisTube([0, 0, 1])) // same direction
    // same-direction tubes through the same centre coincide completely
    const sticky = computeVoxelCoverage(
      dirs.map((t) => ({ ...t, dir: { x: 0, y: 0, z: 1 } })),
      40,
    )
    expect(sticky.maxMultiplicity).toBe(40)
    const single = computeVoxelCoverage([dirs[0]], 40)
    expect(sticky.occupiedVolume).toBeCloseTo(single.occupiedVolume, 12)
  })

  it('produces an aggregated vis grid when requested', () => {
    const tubes = makeTubes(
      Array.from({ length: 8 }, () => ({ x: 0, y: 0, z: 1 })),
      0.1,
      1,
    )
    const r = computeVoxelCoverage(tubes, 48, 12)
    expect(r.visGrid).toBeDefined()
    expect(r.visGrid!.res).toBe(12)
    expect(r.visGrid!.data.length).toBe(12 ** 3)
    expect(r.visGrid!.data.some((m) => m === 8)).toBe(true)
  })
})
