// The Wang–Zahl experiment's reactive cell graph — the single wiring point
// where params (one source of truth each) drive every derived object.
// UI components only read cells via useCell; nobody updates peers by hand.
import { Runtime } from '../runtime/cell'
import { fibonacciDirections, minAngularSeparation, type Vec3 } from '../kakeya/directions'
import { makeTubes, type Tube3 } from '../kakeya/tubes'
import { perronTree, type PerronResult } from '../kakeya/perron'
import { computeVoxelCoverage, type VoxelMetrics, type VoxelResult } from '../kakeya/voxels3d'
import { isWorkerAvailable, measureFamily, measureVoxelCover } from '../workers/voxelClient'

export const VIS_RES = 16 // 3D occupancy grid resolution (divides all voxelRes choices)
export const PREVIEW_RES = 32 // drag-time synchronous preview grid (AGENTS.md §2)

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

// drag-time preview: synchronous low-res measurement so numbers move with the
// pointer (exact result below settles after pointer-up via the Worker)
export const voxelPreviewCell = kakeya.derive<VoxelMetrics>(
  'kakeya.voxelPreview',
  [tubesCell],
  ([tubes]) => {
    const { visGrid: _v, ...metrics } = computeVoxelCoverage(tubes as Tube3[], PREVIEW_RES, 0)
    return metrics
  },
)

// exact (CALCULATED) measurement — Comlink RPC into the Web Worker
export const voxelCell = kakeya.asyncDerive<VoxelResult>(
  'kakeya.voxel',
  [tubesCell, pVoxelRes],
  ([tubes, res]) =>
    (isWorkerAvailable() ? measureVoxelCover : computeVoxelsSyncFallback)(
      tubes as Tube3[],
      res as number,
      VIS_RES,
    ),
  { debounceMs: 140 },
)

async function computeVoxelsSyncFallback(tubes: Tube3[], res: number, visRes: number): Promise<VoxelResult> {
  return computeVoxelCoverage(tubes, res, visRes)
}

export const perronCell = kakeya.derive<PerronResult>(
  'perron.tree',
  [pPerronK, pPerronAlpha],
  ([k, alpha]) => perronTree(k as number, alpha as number, 800),
)

// ---- |⋃T| sweep vs N at current δ/packing (live, coarse grid) --------------
import type { CurvePoint } from '../kakeya/metrics'

export const SWEEP_NS = [16, 32, 64, 96, 128, 192]

export const sweepCell = kakeya.asyncDerive<CurvePoint[]>(
  'kakeya.sweep',
  [deltaCell, pPacking],
  async ([delta, packing]) => {
    const points: CurvePoint[] = []
    for (const n of SWEEP_NS) {
      const r = await measureFamily(delta as number, n, packing as number, 40)
      points.push({ x: n, y: r.occupiedVolume, series: 'live（本页计算）' })
    }
    return points
  },
  { debounceMs: 260 },
)

// fine-scale tube family for Microscope Mode (same params, δ→δ/4) — derived,
// never a copy of state (AGENTS.md §1)
export const fineTubesCell = kakeya.derive<Tube3[]>(
  'kakeya.fineTubes',
  [dirsCell, pPacking],
  ([dirs, packing]) => makeTubes(dirs as Vec3[], 2 ** -6, packing as number, 20250224 + 1),
)

// ρ intermediate scale (δ/2) — the microscope's 1 → ρ → δ continuum (AGENTS §1)
export const midTubesCell = kakeya.derive<Tube3[]>(
  'kakeya.midTubes',
  [dirsCell, pPacking],
  ([dirs, packing]) => {
    const deltaExp = (kakeya.get('kakeya.deltaExp').value as number) ?? 4
    return makeTubes(dirs as Vec3[], 2 ** -(deltaExp + 1), packing as number, 20250224 + 2)
  },
)

// ---- desk coordination params (event-bus style; nonce objects) -------------
export interface FocusRequest {
  nodeId: string
  nonce: number
}
export const pFocusNode = kakeya.param<FocusRequest | null>('desk.focusNode', null)

export interface PaperAnchorRequest {
  page: number
  needle: string
  nonce: number
}
export const pPaperAnchor = kakeya.param<PaperAnchorRequest | null>('paper.anchor', null)

/** ask the desk to focus a node (optionally after setting a paper anchor) */
export function focusPaperAnchor(page: number, needle: string) {
  kakeya.setParam(pPaperAnchor.id, { page, needle, nonce: Date.now() })
  kakeya.setParam(pFocusNode.id, { nodeId: 'paper-main', nonce: Date.now() })
}
