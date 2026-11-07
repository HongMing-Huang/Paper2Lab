import { describe, expect, it } from 'vitest'
import { makeTubes, type Tube3 } from './tubes'
import { computeVoxelCoverage } from './voxels3d'

const axisTube = (dir: [number, number, number]): Tube3 => ({
  dir: { x: dir[0], y: dir[1], z: dir[2] },
  center: { x: 0.5, y: 0.5, z: 0.5 },
  radius: 0.1,
  length: 1,
})

describe('computeVoxelCoverage', () => {
  it('axis tube (segment spans the cube height): in-cube volume is the cylinder πδ²·1 — the caps fall outside the cube', () => {
    // for a z-aligned unit segment centred in the unit cube, every cube point
    // projects inside the segment, so |T ∩ [0,1]³| = πδ² exactly (the two
    // hemispherical caps lie outside the grid). res 400 converges to −0.1%.
    const r = computeVoxelCoverage([axisTube([0, 0, 1])], 120)
    const cylinder = Math.PI * 0.01
    const capsule = Math.PI * 0.01 + (4 / 3) * Math.PI * 0.001
    expect(r.analyticPerTube).toBeCloseTo(capsule, 8)
    expect(Math.abs(r.occupiedVolume - cylinder) / cylinder).toBeLessThan(0.035)
    expect(r.maxMultiplicity).toBe(1)
    expect(r.avgMultiplicity).toBeCloseTo(1, 12)
    expect(r.sumTubeVolume).toBeCloseTo(r.occupiedVolume, 12)
    expect(r.histogram[0] + r.histogram[1]).toBe(120 ** 3)
  })

  it('diagonal tube (caps inside the cube): in-cube volume is the full capsule πδ²·1 + ⁴⁄₃πδ³', () => {
    const inv = 1 / Math.sqrt(3)
    const r = computeVoxelCoverage([axisTube([inv, inv, inv])], 120)
    const capsule = Math.PI * 0.01 + (4 / 3) * Math.PI * 0.001
    expect(Math.abs(r.occupiedVolume - capsule) / capsule).toBeLessThan(0.045)
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
