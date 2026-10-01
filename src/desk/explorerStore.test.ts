import { describe, expect, it } from 'vitest'
import { ExplorerStore } from './explorerStore'
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
})
