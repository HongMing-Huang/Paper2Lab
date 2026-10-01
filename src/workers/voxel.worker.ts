// Scientific Worker — the Kakeya engine, exposed via Comlink RPC.
// All six objective-named primitives live HERE (single engine of truth):
// generateDirections / generateTubes / measureVoxelCover / measureMultiplicity
// / measureUnionVolume / runScaleSweep. Kernels stay pure in src/kakeya/.
import * as Comlink from 'comlink'
import { computeVoxelCoverage } from '../kakeya/voxels3d'
import { fibonacciDirections } from '../kakeya/directions'
import { makeTubes } from '../kakeya/tubes'
import type { Tube3 } from '../kakeya/tubes'
import type { VoxelResult } from '../kakeya/voxels3d'

/** the worker-side scientific API (typed via `typeof api`) */
const api = {
  generateDirections(n: number) {
    return fibonacciDirections(n)
  },

  generateTubes(delta: number, n: number, packing: number, seed = 20250224) {
    return makeTubes(fibonacciDirections(n), delta, packing, seed)
  },

  /** full finite-scale measurement of a tube family against a res³ grid */
  measureVoxelCover(tubes: Tube3[], res: number, visRes: number): VoxelResult {
    return computeVoxelCoverage(tubes, res, visRes)
  },

  /** per-voxel coverage counts: histogram[m] = #voxels covered exactly m times */
  measureMultiplicity(tubes: Tube3[], res: number) {
    const r = computeVoxelCoverage(tubes, res, 0)
    return { histogram: r.histogram, maxMultiplicity: r.maxMultiplicity, avgMultiplicity: r.avgMultiplicity }
  },

  /** union volume = occupied voxels × voxel volume (h³ for the unit cube) */
  measureUnionVolume(tubes: Tube3[], res: number) {
    const r = computeVoxelCoverage(tubes, res, 0)
    return { occupiedVolume: r.occupiedVolume, res }
  },

  /** |⋃T|–N scaling sweep (one Comlink round-trip per point) */
  runScaleSweep(
    delta: number,
    packing: number,
    ns: number[],
    res: number,
  ): Array<{ n: number; occupiedVolume: number; maxMultiplicity: number; avgMultiplicity: number }> {
    const out: Array<{ n: number; occupiedVolume: number; maxMultiplicity: number; avgMultiplicity: number }> = []
    for (const n of ns) {
      const tubes = makeTubes(fibonacciDirections(n), delta, packing)
      const r = computeVoxelCoverage(tubes, res, 0)
      out.push({ n, occupiedVolume: r.occupiedVolume, maxMultiplicity: r.maxMultiplicity, avgMultiplicity: r.avgMultiplicity })
    }
    return out
  },
}

export type VoxelWorkerApi = typeof api

Comlink.expose(api)
