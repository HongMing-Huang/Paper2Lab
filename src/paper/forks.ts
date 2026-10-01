// Experiment forks: a fork freezes the current parameters together with the
// committed CALCULATED outputs and runtime cell versions — a reproducible
// record of one branch of the experiment. Restore re-applies parameters
// through the reactive runtime (never hand-synced UI state).
import type { Node } from '@xyflow/react'
import { kakeya } from './kakeyaGraph'

export interface ForkMetrics {
  delta: number
  nTubes: number
  packing: number
  res: number
  occupiedVolume: number
  sumTubeVolume: number
  maxMultiplicity: number
  avgMultiplicity: number
}

export interface ForkSnapshot {
  id: string
  label: string
  createdAt: number
  params: Record<string, number>
  metrics: ForkMetrics | null
  perron: { k: number; alpha: number; computedArea: number; boundArea: number; triangleArea: number } | null
  cellVersions: Record<string, number>
  /** traceability: the ExperimentRun this fork's metrics came from (AGENTS §2.8) */
  runId?: string
  engine?: string
  durationMs?: number
  /** true when the snapshot was produced by direct skill computation rather than read off the live desk */
  synthetic?: boolean
}

const PARAM_IDS = ['kakeya.deltaExp', 'kakeya.nTubes', 'kakeya.packing', 'kakeya.voxelRes', 'perron.k', 'perron.alpha']

let forks: ForkSnapshot[] = []
const listeners = new Set<() => void>()

function notify() {
  for (const cb of listeners) cb()
}

export const forkStore = {
  subscribe(cb: () => void): () => void {
    listeners.add(cb)
    return () => {
      listeners.delete(cb)
    }
  },
  get(): readonly ForkSnapshot[] {
    return forks
  },
  add(f: ForkSnapshot) {
    forks = [...forks, f]
    notify()
    return f
  },
  remove(id: string) {
    forks = forks.filter((f) => f.id !== id)
    notify()
  },
}

function cellValue<T>(id: string): T | undefined {
  const snap = kakeya.get(id)
  return snap.hasValue ? (snap.value as T) : undefined
}

/** capture the live experiment as a fork */
export function snapshotCurrentFork(label: string): ForkSnapshot {
  const params: Record<string, number> = {}
  for (const p of PARAM_IDS) params[p] = cellValue<number>(p) ?? 0
  const versions: Record<string, number> = {}
  for (const c of kakeya.describe()) versions[c.id] = c.version

  const voxRun = cellValue<import('../experiments/protocol').ExperimentRun<import('../kakeya/voxels3d').VoxelResult>>('kakeya.voxel')
  const vox = voxRun?.result
  const delta = cellValue<number>('kakeya.delta') ?? 0
  const metrics: ForkMetrics | null = vox
    ? {
        delta,
        nTubes: params['kakeya.nTubes'],
        packing: params['kakeya.packing'],
        res: vox.res,
        occupiedVolume: vox.occupiedVolume,
        sumTubeVolume: vox.sumTubeVolume,
        maxMultiplicity: vox.maxMultiplicity,
        avgMultiplicity: vox.avgMultiplicity,
      }
    : null

  const perronRun = cellValue<import('../experiments/protocol').ExperimentRun<import('../kakeya/perron').PerronResult>>('perron.tree')
  const perronCell = perronRun?.result
  const perron = perronCell
    ? {
        k: perronCell.k,
        alpha: perronCell.alpha,
        computedArea: perronCell.computedArea,
        boundArea: perronCell.boundArea,
        triangleArea: perronCell.triangleArea,
      }
    : null

  return {
    id: `fork-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
    label,
    createdAt: Date.now(),
    params,
    metrics,
    perron,
    cellVersions: versions,
    runId: voxRun?.runId,
    engine: voxRun ? `${voxRun.engine}@${voxRun.engineVersion}` : undefined,
    durationMs: voxRun?.durationMs,
  }
}

/** re-apply a fork's parameters through the reactive runtime */
export function restoreFork(f: ForkSnapshot) {
  for (const [id, value] of Object.entries(f.params)) kakeya.setParam(id, value)
}

// ---- desk event bus: nodes request canvas actions without prop drilling ----

export interface DeskAction {
  type: 'add-node' | 'focus-node' | 'expand-lab' | 'expand-library' | 'run-plan' | 'open-ode'
  node?: Node
  nodeId?: string
  plan?: unknown
}

const actionListeners = new Set<(a: DeskAction) => void>()

export const deskBus = {
  subscribe(cb: (a: DeskAction) => void): () => void {
    actionListeners.add(cb)
    return () => {
      actionListeners.delete(cb)
    }
  },
  emit(a: DeskAction) {
    for (const cb of actionListeners) cb(a)
  },
}

export function requestAddNode(node: Node) {
  deskBus.emit({ type: 'add-node', node })
}
