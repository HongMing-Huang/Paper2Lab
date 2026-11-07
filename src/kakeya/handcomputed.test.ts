// Hand-computed geometry cases — every expected value below was enumerated BY
// HAND on paper before being written here (no loop-generated expectations).
// These pin the segment↔voxel-centre distance math that everything else
// (volume, multiplicity, sweeps, C++ port) is built on.
import { describe, expect, it } from 'vitest'
import { computeVoxelCoverage } from './voxels3d'
import type { Tube3 } from './tubes'

const tube = (dir: [number, number, number], center: [number, number, number], radius: number): Tube3 => ({
  dir: { x: dir[0], y: dir[1], z: dir[2] },
  center: { x: center[0], y: center[1], z: center[2] },
  radius,
  length: 1,
})

/** voxel centres of a res³ grid on [0,1]³, hand-checkable */
const centres = (res: number) => {
  const out: [number, number, number][] = []
  for (let i = 0; i < res; i++)
    for (let j = 0; j < res; j++)
      for (let k = 0; k < res; k++) out.push([(i + 0.5) / res, (j + 0.5) / res, (k + 0.5) / res])
  return out
}

describe('hand-computed geometry: single z-axis tube, res=4, δ=0.3, centre (0.5,0.5,0.5)', () => {
  // Grid centres are at 0.125 and 0.375 and 0.625 and 0.875 per axis.
  // The segment runs z∈[0,1] at (x,y)=(0.5,0.5). Distance from a centre to
  // the segment = distance to the LINE (projection never clamps inside cube).
  //   d((x,y)) = sqrt((x-0.5)² + (y-0.5)²); covered iff d ≤ 0.3.
  // Per-axis offsets from 0.5: 0.375 (|0.125-0.5|), 0.125, 0.125, 0.375.
  // Radial distances (x,y): min = sqrt(0.125²+0.125²)=0.1768 ✓ covered
  //   one-axis-far: sqrt(0.375²+0.125²)=0.3953 ✗ NOT covered
  //   both-far: sqrt(0.375²+0.375²)=0.5303 ✗
  // ⇒ covered columns (x,y) are exactly the 2×2 middle block; every z row
  //   counts ⇒ 2·2·4 = 16 voxels. occupiedVolume = 16/64 = 0.25.
  const r = computeVoxelCoverage([tube([0, 0, 1], [0.5, 0.5, 0.5], 0.3)], 4)
  const covered = centres(4).filter(([x, y]) => Math.hypot(x - 0.5, y - 0.5) <= 0.3)

  it('covers exactly the hand-enumerated 16 voxels (2×2 middle columns × 4 z-rows)', () => {
    expect(r.occupiedVolume).toBeCloseTo(16 / 64, 12)
    expect(covered.length).toBe(16) // sanity: the hand enumeration itself
  })

  it('multiplicity is 1 on those 16 voxels and 0 elsewhere (histogram [48,16])', () => {
    expect(r.histogram[0]).toBe(48)
    expect(r.histogram[1]).toBe(16)
    expect(r.maxMultiplicity).toBe(1)
    expect(r.avgMultiplicity).toBe(1)
  })
})

describe('hand-computed geometry: two crossing tubes, res=2, δ=0.2, both centred', () => {
  // Centres at 0.25/0.75 per axis. z-tube at (0.5,0.5): radial offset of any
  // centre = sqrt(0.25²+0.25²)=0.3536 > 0.2 ⇒ covers NOTHING.
  // A tube along the space diagonal (1,1,1)/√3 through the centre: distance
  // from (0.25,0.25,0.25) to the line = |p−(p·d)d|; p·d = 0.75/√3·... compute:
  // d=(1,1,1)/√3, p=(0.25,0.25,0.25): p·d = 0.75/√3 = 0.4330; pd =
  // (0.25,0.25,0.25); p−pd = 0 ⇒ distance 0 ≤ 0.2 ✓. p=(0.75,0.25,0.25):
  // p·d = 1.25/√3 = 0.7217; pd = (0.4167,0.4167,0.4167); p−pd =
  // (0.3333,−0.1667,−0.1667); |·| = sqrt(0.1111+0.0278+0.0278)=0.4082 ✗.
  // Symmetry: only the two corners ON the diagonal (0.25³ and 0.75³) are
  // covered ⇒ diagonal tube covers exactly 2 voxels of the 8.
  const diag = 1 / Math.sqrt(3)
  const r = computeVoxelCoverage([tube([diag, diag, diag], [0.5, 0.5, 0.5], 0.2)], 2)

  it('diagonal tube covers exactly the 2 on-diagonal voxels', () => {
    expect(r.occupiedVolume).toBeCloseTo(2 / 8, 12)
  })

  it('axis tube at δ=0.2 covers 0 voxels at res=2 (hand-derived)', () => {
    const rz = computeVoxelCoverage([tube([0, 0, 1], [0.5, 0.5, 0.5], 0.2)], 2)
    expect(rz.occupiedVolume).toBe(0)
  })
})

describe('protocol envelope invariants (units: same kernels, wrapped in ExperimentRun)', () => {
  it('envelope carries engine/duration/seed/evidence and matches raw kernel output', async () => {
    const { ENGINES, executeSpec } = await import('../experiments/protocol')
    const raw = computeVoxelCoverage([tube([0, 0, 1], [0.5, 0.5, 0.5], 0.3)], 4)
    const run = await executeSpec(
      { kind: 'kakeya.voxel', params: { deltaExp: -Math.log2(0.3) }, seed: 1, res: 4 },
      ENGINES.kakeyaWorker,
      () => computeVoxelCoverage([tube([0, 0, 1], [0.5, 0.5, 0.5], 0.3)], 4),
    )
    expect(run.evidence).toBe('CALCULATED')
    expect(run.engine).toBe(ENGINES.kakeyaWorker.engine)
    expect(run.runId).toMatch(/^kakeya-voxel-/)
    expect(run.result!.occupiedVolume).toBeCloseTo(raw.occupiedVolume, 12)
    expect(run.spec.res).toBe(4)
    expect(run.spec.seed).toBe(1)
    expect(run.durationMs).toBeGreaterThanOrEqual(0)
  })
})
