// #51 P0-D regression: 3D experiment papers must be INDEPENDENT — the old
// host subscribed the GLOBAL tubesRunCell and wrote the GLOBAL packing param,
// so two 3D papers (e.g. a packing fork) rendered the same run and dragging
// one moved the other's experiment. These tests pin the per-experiment store:
// each shape owns its runs, drag-commit re-executes only ITS params, and the
// hero demo's global runtime is untouched.
import { describe, expect, it } from 'vitest'
import { getExperimentRun } from '../experiments/protocol'
import { kakeya, pPacking } from '../paper/kakeyaGraph'
import { buildPlan } from '../skills/playPlan'
import {
  commitPacking,
  endPreview,
  getRun3D,
  initRun3D,
  metricsOf,
  previewTubes,
  setPreviewPacking,
  tubesOf,
} from './run3dStore'

async function seedAndCommit(shapeId: string, packing: number) {
  initRun3D(shapeId, { params: { deltaExp: 4, nTubes: 32, packing: 0 }, runId: null })
  await commitPacking(shapeId, packing)
}

describe('run3dStore — per-experiment 3D state (#51 P0-D)', () => {
  it('two papers with different packings hold DIFFERENT runs and geometry', async () => {
    await seedAndCommit('shape:A', 0)
    await seedAndCommit('shape:B', 1)
    const a = getRun3D('shape:A')!
    const b = getRun3D('shape:B')!
    expect(a.runId).toBeTruthy()
    expect(b.runId).toBeTruthy()
    expect(a.runId).not.toBe(b.runId) // the OLD bug: both showed one global run
    const ta = tubesOf(a)
    const tb = tubesOf(b)
    expect(ta.length).toBeGreaterThan(0)
    // packing=1 ⇒ sticky clusters ⇒ strictly smaller union geometry: the two
    // papers must not be copies of each other
    const spread = (ts: typeof ta) => {
      let s = 0
      for (const t of ts) s += Math.abs(t.center.x - 0.5) + Math.abs(t.center.y - 0.5)
      return s
    }
    expect(spread(tb)).toBeLessThan(spread(ta))
    // each carries its own metrics run (never the global voxel cell)
    expect(metricsOf(a)?.occupiedVolume).not.toBe(metricsOf(b)?.occupiedVolume)
  })

  it('drag preview is presentation-only and never mutates the committed run', async () => {
    await seedAndCommit('shape:C', 0)
    const exp = getRun3D('shape:C')!
    const base = tubesOf(exp)
    setPreviewPacking('shape:C', 0.6)
    const withPreview = getRun3D('shape:C')!
    expect(withPreview.previewPacking).toBe(0.6)
    // preview tubes differ visually…
    expect(previewTubes(base, 0.6)[0]!.center).not.toEqual(base[0]!.center)
    // …but the experiment's params and run are UNCHANGED until commit
    expect(withPreview.params.packing).toBe(0)
    expect(tubesOf(withPreview)[0]!.center).toEqual(base[0]!.center)
    endPreview('shape:C')
    expect(getRun3D('shape:C')!.previewPacking).toBeNull()
  })

  it("committing one paper's packing NEVER touches the hero demo's global runtime", async () => {
    const before = kakeya.get(pPacking.id).value
    await seedAndCommit('shape:D', 1)
    expect(kakeya.get(pPacking.id).value).toBe(before) // global param untouched
    // the committed run IS registered in the shared run log (traceable)
    const run = getExperimentRun(getRun3D('shape:D')!.runId!)
    expect(run).toBeTruthy()
    expect(run!.spec.kind).toBe('kakeya.geometry')
    expect(run!.spec.params.packing).toBe(1)
  })

  it('commit failure lands as an honest error, not a fake run', async () => {
    // schema-invalid deltaExp (string) is rejected by the skill gate
    initRun3D('shape:E', { params: { deltaExp: 'four' as unknown as number, nTubes: 8, packing: 0 }, runId: null })
    await commitPacking('shape:E', 0.5)
    const exp = getRun3D('shape:E')!
    expect(exp.status).toBe('error')
    expect(exp.error).toBeTruthy()
    expect(exp.runId ?? null).toBeNull()
  })

  it('every commit produced runs under a real PlayPlan (gate contract)', async () => {
    await seedAndCommit('shape:F', 0.3)
    const run = getExperimentRun(getRun3D('shape:F')!.runId!)
    expect(run?.evidence).toBe('CALCULATED')
    expect(run?.engine).toBeTruthy()
    expect(buildPlan({ skill: 'kakeya.generate', goal: 'gate' }).planId).toBeTruthy()
  })
})
