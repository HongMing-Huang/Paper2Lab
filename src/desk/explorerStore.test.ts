import { describe, expect, it } from 'vitest'
import { ExplorerStore, CURVE_SAMPLES, PREVIEW_SAMPLES } from './explorerStore'
import { analyzeFormula } from '../formula/analyze'
import { buildExplorerSpec } from '../formula/spec'
import { getExperimentRun } from '../experiments/protocol'

function fixture() {
  return buildExplorerSpec(analyzeFormula('y = a x'), { docId: 'test', anchorId: 'eq1', page: 2, bbox: { x: 0, y: 0, w: 1, h: 1 }, latex: 'y = a x' })
}

describe('reactive formula run contracts', () => {
  it('waits for changed inputs instead of returning the old run and preserves the parent', async () => {
    const store = new ExplorerStore()
    const { spec, compiled } = fixture()
    store.create('base', spec, compiled)
    const base = await store.waitForRun('base')
    store.fork('base', 'child')
    const first = await store.waitForRun('child')
    store.setParams('child', { a: 2 })
    expect(store.get('child')?.status).toBe('stale')
    const child = await store.waitForRun('child')
    expect(child.runId).not.toBe(first.runId)
    expect(child.spec.params.a).toBe(2)
    expect(child.result!.peak).toBeCloseTo(base.result!.peak * 2)
    expect(child.parentRunId).toBe(base.runId)
    expect(getExperimentRun(base.runId)).toBe(base)
    expect(child.spec.model).toHaveProperty('samples', 361)
    expect(child.spec.source).toHaveProperty('page', 2)
    store.dispose('base'); store.dispose('child')
  })
  it('rejects unknown/nonfinite/out-of-range parameters before any mutation', async () => {
    const store = new ExplorerStore()
    const { spec, compiled } = fixture()
    store.create('test', spec, compiled)
    await store.waitForRun('test')
    expect(() => store.setParams('test', { a: 2, imaginary: 3 })).toThrow()
    expect(store.get('test')?.params.a).toBe(1)
    expect(() => store.setParams('test', { a: Infinity })).toThrow()
    expect(() => store.setParams('test', { a: 999 })).toThrow()
    store.dispose('test')
  })
  it('drag preview/commit contract (#23): preview uses the same kernel at 61 samples; empty-patch commit re-runs exact', async () => {
    const store = new ExplorerStore()
    const { spec, compiled } = fixture()
    store.create('drag', spec, compiled)
    const exact0 = await store.waitForRun('drag')
    expect(exact0.spec.model).toHaveProperty('samples', CURVE_SAMPLES)

    // pointer MOVE: preview — cheap, local, marked preview, no exact recompute
    store.setParams('drag', { a: 2 }, { preview: true })
    const ex = store.get('drag')!
    expect(ex.dragging).toBe(true)
    expect(ex.previewRun).not.toBeNull()
    expect(ex.previewRun!.spec.kind).toBe('formula.preview')
    expect(ex.previewRun!.spec.model).toHaveProperty('samples', PREVIEW_SAMPLES)
    expect(ex.previewRun!.spec.params.a).toBe(2)
    // same kernel ⇒ y = 2x peaks at 2·|range edge| — proportional to the exact run
    expect(ex.previewRun!.result!.peak).toBeCloseTo((exact0.result ?? { peak: 1 }).peak * 2, 5)
    // the exact run is UNCHANGED during the drag (still the old params)
    expect(store.get('drag')!.run?.spec.params.a).toBe(1)

    // pointer UP: empty-patch commit — exact path at full sampling
    store.setParams('drag', {})
    const committed = await store.waitForRun('drag')
    expect(committed.spec.kind).toBe('formula.curve')
    expect(committed.spec.model).toHaveProperty('samples', CURVE_SAMPLES)
    expect(committed.spec.params.a).toBe(2)
    expect(store.get('drag')!.dragging).toBe(false)
    expect(store.get('drag')!.previewRun).toBeNull()
    store.dispose('drag')
  })
})
