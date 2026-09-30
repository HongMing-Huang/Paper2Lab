// The Wang–Zahl experiment's reactive cell graph — the single wiring point
// where params (one source of truth each) drive every derived object.
// UI components only read cells via useCell; nobody updates peers by hand.
import { Runtime } from '../runtime/cell'
import { fibonacciDirections, minAngularSeparation, type Vec3 } from '../kakeya/directions'
import { makeTubes, type Tube3 } from '../kakeya/tubes'
import { perronTree, type PerronResult } from '../kakeya/perron'
import type { VoxelResult } from '../kakeya/voxels3d'
import { computeVoxels, computeVoxelsSync, isWorkerAvailable } from '../workers/voxelClient'

export const VIS_RES = 16 // 3D occupancy grid resolution (divides all voxelRes choices)

export const kakeya = new Runtime()

// ---- params (single sources of truth) --------------------------------------
export const pDeltaExp = kakeya.param('kakeya.deltaExp', 4) // δ = 2^-exp ∈ [1/8 … 1/45]
export const pNTubes = kakeya.param('kakeya.nTubes', 96)
export const pPacking = kakeya.param('kakeya.packing', 0) // 0 separated … 1 sticky
export const pVoxelRes = kakeya.param('kakeya.voxelRes', 48)
export const pPerronK = kakeya.param('perron.k', 3)
export const pPerronAlpha = kakeya.param('perron.alpha', 0.8)
export const pNeedleOn = kakeya.param('needle.animating', 1)

// ---- derived objects --------------------------------------------------------
export const deltaCell = kakeya.derive<number>('kakeya.delta', [pDeltaExp], ([e]) => 2 ** -(e as number))

export const dirsCell = kakeya.derive<Vec3[]>('kakeya.dirs', [pNTubes], ([n]) => fibonacciDirections(n as number))

export const minSepCell = kakeya.derive<number>(
  'kakeya.minSep',
  [dirsCell],
  ([dirs]) => minAngularSeparation(dirs as Vec3[]),
)

export const tubesCell = kakeya.derive<Tube3[]>(
  'kakeya.tubes',
  [dirsCell, deltaCell, pPacking],
  ([dirs, delta, packing]) => makeTubes(dirs as Vec3[], delta as number, packing as number),
)

// heavy finite-scale compute — Web Worker, stale-while-recompute
export const voxelCell = kakeya.asyncDerive<VoxelResult>(
  'kakeya.voxel',
  [tubesCell, pVoxelRes],
  ([tubes, res]) =>
    (isWorkerAvailable() ? computeVoxels : computeVoxelsSync)(
      tubes as Tube3[],
      res as number,
      VIS_RES,
    ),
  { debounceMs: 140 },
)

export const perronCell = kakeya.derive<PerronResult>(
  'perron.tree',
  [pPerronK, pPerronAlpha],
  ([k, alpha]) => perronTree(k as number, alpha as number, 800),
)
