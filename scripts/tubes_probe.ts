// Headless probe for the tubes level (#21): measures honest volumes across
// the legal interpolation range so the frozen budget can be set from real
// numbers instead of guesswork. Run: npx tsx scripts/tubes_probe.ts
import { runChallenge } from '../src/challenges/kernel'
import { computeVoxelCoverage } from '../src/kakeya/voxels3d'
import { fibonacciDirections } from '../src/kakeya/directions'
import { makeTubes, segmentOf } from '../src/kakeya/tubes'
import type { TubesSpec, TubesResult } from '../src/challenges/levels'

const T: TubesSpec = { kind: 'tubes', offsets: [0, 0, 0, 0], nTubes: 32, deltaExp: 4, res: 24, budget: 0.19 }
const delta = 2 ** -T.deltaExp
const dirs = fibonacciDirections(T.nTubes)

// global packing reference (hero-demo semantics)
for (const p of [0, 0.25, 0.5, 0.75, 1]) {
  const tubes = makeTubes(dirs, delta, p, 20250224)
  const v = computeVoxelCoverage(tubes, T.res, 0).occupiedVolume
  console.log(`packing ${p.toFixed(2)} → ${v.toFixed(6)}`)
}

// legality check helper: any segment outside [0,1]^3?
const countViol = (tubes: ReturnType<typeof makeTubes>) => {
  let n = 0
  const eps = 1e-9
  for (const t of tubes) {
    const { a, b } = segmentOf(t)
    for (const q of [a, b]) if (q.x < -eps || q.x > 1 + eps || q.y < -eps || q.y > 1 + eps || q.z < -eps || q.z > 1 + eps) n++
  }
  return n
}

// per-cluster packing probe: cluster i tubes interpolate toward (0.5,0.5,0.5)
const base = makeTubes(dirs, delta, 0, 20250224)
const per = Math.ceil(base.length / 4)
const perCluster = (offsets: number[]) =>
  base.map((t, i) => {
    const c = Math.min(3, Math.floor(i / per))
    const o = offsets[c]
    return {
      ...t,
      center: { x: t.center.x + o * (0.5 - t.center.x), y: t.center.y + o * (0.5 - t.center.y), z: t.center.z + o * (0.5 - t.center.z) },
    }
  })
for (const offsets of [[0, 0, 0, 0], [1, 1, 1, 1], [0.5, 0.5, 0.5, 0.5], [1, 0, 1, 0], [1, 1, 0, 0], [0, 1, 1, 1], [0.75, 1, 0.75, 1]]) {
  const tubes = perCluster(offsets)
  const v = computeVoxelCoverage(tubes, T.res, 0).occupiedVolume
  console.log(`clusters ${JSON.stringify(offsets)} → v ${v.toFixed(6)}  violations ${countViol(tubes)}`)
}

// current kernel probe (diagonal legal range) for comparison
const show = async (label: string, offsets: number[]) => {
  const r = (await runChallenge({ ...T, offsets })) as TubesResult
  console.log(label, JSON.stringify({ v: +r.occupiedVolume.toFixed(6), violations: r.violations }))
}
await show('diag all-0 ', [0, 0, 0, 0])
await show('diag all-1 ', [1, 1, 1, 1])
