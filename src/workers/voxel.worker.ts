// Finite-scale voxel coverage in a Web Worker so the desk stays at 60fps.
import { computeVoxelCoverage } from '../kakeya/voxels3d'
import type { Tube3 } from '../kakeya/tubes'

interface VoxelRequest {
  id: number
  tubes: Tube3[]
  res: number
  visRes: number
}

self.onmessage = (e: MessageEvent<VoxelRequest>) => {
  const { id, tubes, res, visRes } = e.data
  const result = computeVoxelCoverage(tubes, res, visRes)
  const transfer: Transferable[] = []
  if (result.visGrid) transfer.push(result.visGrid.data.buffer)
  ;(self as unknown as Worker).postMessage({ id, result }, transfer)
}
