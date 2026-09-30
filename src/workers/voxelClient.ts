// Promise wrapper around the voxel worker: one shared worker, latest-wins.
// Superseded requests are dropped by the runtime's generation guard; here we
// simply resolve every request id (old results are cheap to ignore).
import type { Tube3 } from '../kakeya/tubes'
import type { VoxelResult } from '../kakeya/voxels3d'

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, (result: VoxelResult) => void>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./voxel.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<{ id: number; result: VoxelResult }>) => {
    const resolve = pending.get(e.data.id)
    if (resolve) {
      pending.delete(e.data.id)
      resolve(e.data.result)
    }
  }
  return worker
}

export function computeVoxels(tubes: Tube3[], res: number, visRes: number): Promise<VoxelResult> {
  const id = nextId++
  return new Promise((resolve) => {
    pending.set(id, resolve)
    getWorker().postMessage({ id, tubes, res, visRes })
  })
}

export function isWorkerAvailable(): boolean {
  return typeof Worker !== 'undefined'
}

/** Fallback: main-thread compute (tests, very small grids). */
export async function computeVoxelsSync(tubes: Tube3[], res: number, visRes: number): Promise<VoxelResult> {
  const { computeVoxelCoverage } = await import('../kakeya/voxels3d')
  return computeVoxelCoverage(tubes, res, visRes)
}
