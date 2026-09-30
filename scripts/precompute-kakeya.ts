// Offline precompute for larger finite-scale Kakeya experiments.
// Reproducible: same kernels as the browser (src/kakeya/*), fixed seed & grid.
// Run: node scripts/precompute-kakeya.ts   (Node >= 23 native TS strip-types)
// Output: src/data/kakeya-precomputed.json (summary metrics only)
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fibonacciDirections, minAngularSeparation } from '../src/kakeya/directions.ts'
import { makeTubes } from '../src/kakeya/tubes.ts'
import { computeVoxelCoverage } from '../src/kakeya/voxels3d.ts'

const SEED = 20250224
const SWEEP_NS = [32, 64, 128, 256]
const CONFIGS: Array<{ deltaExp: number; packing: number; res: number }> = [
  { deltaExp: 4, packing: 0, res: 96 },
  { deltaExp: 4, packing: 0.5, res: 96 },
  { deltaExp: 4, packing: 1, res: 96 },
  { deltaExp: 5, packing: 0, res: 128 },
  { deltaExp: 5, packing: 0.5, res: 128 },
  { deltaExp: 5, packing: 1, res: 128 },
]

const rows: Array<Record<string, number>> = []
for (const cfg of CONFIGS) {
  const delta = 2 ** -cfg.deltaExp
  for (const n of SWEEP_NS) {
    const dirs = fibonacciDirections(n)
    const tubes = makeTubes(dirs, delta, cfg.packing, SEED)
    const r = computeVoxelCoverage(tubes, cfg.res, 0)
    rows.push({
      deltaExp: cfg.deltaExp,
      delta,
      packing: cfg.packing,
      res: cfg.res,
      n,
      minSepRad: minAngularSeparation(dirs),
      occupiedVolume: r.occupiedVolume,
      sumTubeVolume: r.sumTubeVolume,
      maxMultiplicity: r.maxMultiplicity,
      avgMultiplicity: r.avgMultiplicity,
    })
    console.log(
      `δ=2^-${cfg.deltaExp} packing=${cfg.packing} res=${cfg.res} N=${n}` +
        ` |⋃T|=${r.occupiedVolume.toFixed(5)} Σ|T|=${r.sumTubeVolume.toFixed(5)}` +
        ` maxM=${r.maxMultiplicity} avgM=${r.avgMultiplicity.toFixed(3)}`,
    )
  }
}

const out = {
  generatedAt: new Date().toISOString(),
  script: 'scripts/precompute-kakeya.ts',
  seed: SEED,
  kernel: 'src/kakeya/voxels3d.ts#computeVoxelCoverage',
  series: rows,
}
const here = dirname(fileURLToPath(import.meta.url))
const dest = resolve(here, '../src/data/kakeya-precomputed.json')
mkdirSync(dirname(dest), { recursive: true })
writeFileSync(dest, JSON.stringify(out, null, 2) + '\n')
console.log(`\nwrote ${rows.length} rows -> src/data/kakeya-precomputed.json`)
