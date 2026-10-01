// Finite-scale voxel coverage in a dedicated Web Worker, exposed via Comlink
// RPC (AGENTS.md §3: Kakeya path = TypeScript + Worker for lowest latency).
import * as Comlink from 'comlink'
import { computeVoxelCoverage } from '../kakeya/voxels3d'
import { fibonacciDirections } from '../kakeya/directions'
import { makeTubes } from '../kakeya/tubes'
import type { Tube3 } from '../kakeya/tubes'
import type { VoxelResult } from '../kakeya/voxels3d'

/** the worker-side scientific API (typed via `typeof api`) */
const api = {
  /** full finite-scale measurement of a tube family against a res³ grid */
  measureVoxelCover(tubes: Tube3[], res: number, visRes: number): VoxelResult {
    return computeVoxelCoverage(tubes, res, visRes)
  },
  /** convenience: directions + tubes + measurement in one round-trip (sweep) */
  measureFamily(
    delta: number,
    nTubes: number,
    packing: number,
    res: number,
  ): { occupiedVolume: number; sumTubeVolume: number; maxMultiplicity: number; avgMultiplicity: number } {
    const tubes = makeTubes(fibonacciDirections(nTubes), delta, packing)
    const r = computeVoxelCoverage(tubes, res, 0)
    return {
      occupiedVolume: r.occupiedVolume,
      sumTubeVolume: r.sumTubeVolume,
      maxMultiplicity: r.maxMultiplicity,
      avgMultiplicity: r.avgMultiplicity,
    }
  },
}

export type VoxelWorkerApi = typeof api

Comlink.expose(api)
