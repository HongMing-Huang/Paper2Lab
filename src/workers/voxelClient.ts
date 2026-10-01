// Comlink client for the voxel worker: one shared worker, typed Remote API.
// Falls back to main-thread compute where Workers are unavailable (tests/node).
import * as Comlink from 'comlink'
import type { Tube3 } from '../kakeya/tubes'
import type { VoxelResult } from '../kakeya/voxels3d'
import type { VoxelWorkerApi } from './voxel.worker'

let remote: Comlink.Remote<VoxelWorkerApi> | null = null

function getRemote(): Comlink.Remote<VoxelWorkerApi> {
  if (remote) return remote
  const worker = new Worker(new URL('./voxel.worker.ts', import.meta.url), { type: 'module' })
  remote = Comlink.wrap<VoxelWorkerApi>(worker)
  return remote
}

export function isWorkerAvailable(): boolean {
  return typeof Worker !== 'undefined'
}

/** exact (high-resolution) measurement — Comlink RPC into the worker */
export async function measureVoxelCover(tubes: Tube3[], res: number, visRes: number): Promise<VoxelResult> {
  if (!isWorkerAvailable()) {
    const { computeVoxelCoverage } = await import('../kakeya/voxels3d')
    return computeVoxelCoverage(tubes, res, visRes)
  }
  return getRemote().measureVoxelCover(tubes, res, visRes)
}

export async function measureFamily(
  delta: number,
  nTubes: number,
  packing: number,
  res: number,
): Promise<{ occupiedVolume: number; sumTubeVolume: number; maxMultiplicity: number; avgMultiplicity: number }> {
  if (!isWorkerAvailable()) {
    const { computeVoxelCoverage } = await import('../kakeya/voxels3d')
    const { fibonacciDirections } = await import('../kakeya/directions')
    const { makeTubes } = await import('../kakeya/tubes')
    const r = computeVoxelCoverage(makeTubes(fibonacciDirections(nTubes), delta, packing), res, 0)
    return {
      occupiedVolume: r.occupiedVolume,
      sumTubeVolume: r.sumTubeVolume,
      maxMultiplicity: r.maxMultiplicity,
      avgMultiplicity: r.avgMultiplicity,
    }
  }
  return getRemote().measureFamily(delta, nTubes, packing, res)
}

// legacy aliases (v2 call sites)
export const computeVoxels = measureVoxelCover
export async function computeVoxelsSync(tubes: Tube3[], res: number, visRes: number): Promise<VoxelResult> {
  const { computeVoxelCoverage } = await import('../kakeya/voxels3d')
  return computeVoxelCoverage(tubes, res, visRes)
}
