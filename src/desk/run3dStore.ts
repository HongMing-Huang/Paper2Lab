// Per-experiment 3D state (#51 P0-D): every p2l-3d paper owns ITS params,
// ITS kakeya.runs (geometry + metrics) and ITS drag lifecycle. The old host
// subscribed the GLOBAL tubesRunCell/voxelCell and wrote the global packing
// param — two 3D papers (e.g. a fork with different packing) rendered the
// same run and dragged each other's experiment (#51 verified breakpoint 4).
// Preview during drag is presentation-only (affine pull-to-centre, like the
// challenge offsets); the EXACT number always comes from this experiment's
// own kakeya.generate run on pointer-up.
import { executeSkill } from '../skills/executor'
import { buildPlan } from '../skills/playPlan'
import { getExperimentRun, type ExperimentRun } from '../experiments/protocol'
import type { Tube3 } from '../kakeya/tubes'

export interface Run3DExperiment {
  shapeId: string
  params: { deltaExp: number; nTubes: number; packing: number }
  /** this experiment's kakeya.geometry run (tube family) */
  runId: string | null
  /** this experiment's kakeya.measure run (|⋃T| metrics) */
  metricRunId: string | null
  status: 'idle' | 'computing' | 'resolved' | 'error'
  /** drag-time visual packing (presentation-only, NEVER an evidence number) */
  previewPacking: number | null
  error?: string
}

type Listener = () => void

const experiments = new Map<string, Run3DExperiment>()
const listeners = new Set<Listener>()

function emit() {
  for (const l of listeners) l()
}

export function subscribeRun3D(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function getRun3D(shapeId: string): Run3DExperiment | undefined {
  return experiments.get(shapeId)
}

export function listRun3D(): Run3DExperiment[] {
  return [...experiments.values()]
}

/**
 * Seed a NEW 3D experiment paper. `seed` usually snapshots the CURRENT hero
 * params/run at creation time (the user sees what they had), but from then
 * on the experiment is independent — forks drag and recompute separately.
 */
export function initRun3D(
  shapeId: string,
  seed: { params: Run3DExperiment['params']; runId?: string | null },
): Run3DExperiment {
  const exp: Run3DExperiment = {
    shapeId,
    params: { ...seed.params },
    runId: seed.runId ?? null,
    metricRunId: null,
    status: seed.runId ? 'resolved' : 'idle',
    previewPacking: null,
  }
  experiments.set(shapeId, exp)
  emit()
  return exp
}

export function setPreviewPacking(shapeId: string, packing: number): void {
  const exp = experiments.get(shapeId)
  if (!exp) return
  exp.previewPacking = Math.min(1, Math.max(0, packing))
  emit()
}

export function endPreview(shapeId: string): void {
  const exp = experiments.get(shapeId)
  if (!exp) return
  exp.previewPacking = null
  emit()
}

/**
 * Commit THIS experiment's packing: re-runs kakeya.generate AND
 * kakeya.measure with the experiment's own params (same seed/res via the
 * unified executor) — the run lands in the shared run log under this
 * experiment's identity, never touching the hero demo's global params.
 */
export async function commitPacking(shapeId: string, packing: number): Promise<void> {
  const exp = experiments.get(shapeId)
  if (!exp) return
  exp.params.packing = Math.min(1, Math.max(0, packing))
  exp.previewPacking = null
  exp.status = 'computing'
  exp.error = undefined
  emit()
  try {
    const p = exp.params
    const goal = `3D 实验纸 ${shapeId} 的 packing 反写（per-experiment）`
    const geo = await executeSkill(
      'kakeya.generate',
      { deltaExp: p.deltaExp, nTubes: p.nTubes, packing: p.packing },
      buildPlan({ skill: 'kakeya.generate', goal }),
    )
    if (geo.status !== 'ok' || !geo.run) throw new Error(geo.status === 'error' ? geo.message : `generate ${geo.status}`)
    exp.runId = geo.run.runId
    const measure = await executeSkill(
      'kakeya.measure',
      { deltaExp: p.deltaExp, nTubes: p.nTubes, packing: p.packing },
      buildPlan({ skill: 'kakeya.measure', goal }),
    )
    if (measure.status === 'ok' && measure.run) exp.metricRunId = measure.run.runId
    exp.status = 'resolved'
  } catch (err) {
    exp.status = 'error'
    exp.error = err instanceof Error ? err.message : String(err)
  }
  emit()
}

/** this experiment's tubes — ONLY from its own run (CALCULATED evidence) */
export function tubesOf(exp: Run3DExperiment | undefined): Tube3[] {
  if (!exp?.runId) return []
  const run = getExperimentRun(exp.runId) as ExperimentRun<Tube3[]> | undefined
  return (run?.result as unknown as Tube3[] | undefined) ?? []
}

/** this experiment's metrics — only from its own measure run */
export function metricsOf(exp: Run3DExperiment | undefined): { occupiedVolume: number; maxMultiplicity: number } | null {
  if (!exp?.metricRunId) return null
  const run = getExperimentRun(exp.metricRunId) as
    | ExperimentRun<{ occupiedVolume: number; maxMultiplicity: number }>
    | undefined
  const r = run?.result
  return r && Number.isFinite(r.occupiedVolume) ? { occupiedVolume: r.occupiedVolume, maxMultiplicity: r.maxMultiplicity } : null
}

/** presentation-only drag preview: affine pull of each tube toward the unit
 * cube centre (same constructive semantics as the challenge offsets — convex
 * combination keeps every centre inside [0,1]³) — labelled preview; the
 * exact geometry comes from the committed run */
export function previewTubes(base: Tube3[], packing: number): Tube3[] {
  if (packing <= 0) return base
  return base.map((t) => ({
    ...t,
    center: {
      x: t.center.x + (0.5 - t.center.x) * packing,
      y: t.center.y + (0.5 - t.center.y) * packing,
      z: t.center.z + (0.5 - t.center.z) * packing,
    },
  }))
}
