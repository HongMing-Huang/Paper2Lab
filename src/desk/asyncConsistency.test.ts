// Stage B async-consistency gate: rapid parameter changes must only ever
// commit the run matching the CURRENT parameters; stale runs are discarded.
// Runs the real explorer store (Observable Runtime + unified executor).
import { describe, expect, it } from 'vitest'
import { compileFormula } from '../formula/compile'
import { analyzeFormula } from '../formula/analyze'
import type { FormulaExplorerSpec } from '../formula/spec'
import { ExplorerStore } from './explorerStore'

const anchor = {
  docId: 'doc-async-test',
  page: 1,
  bbox: { x: 0.3, y: 0.4, w: 0.4, h: 0.06 },
  latex: 'y = a\\sin(bx)',
}

function makeSpec(): FormulaExplorerSpec {
  const a = analyzeFormula(anchor.latex)
  return {
    type: 'formula',
    expression: a.mathjson,
    rhs: a.rhs,
    parameters: a.params,
    independent: { name: 'x', range: [-7, 7] },
    output: 'y',
    renderer: 'jsxgraph',
    anchor: { ...anchor, latex: anchor.latex },
  }
}

describe('async consistency (real explorer store + executor)', () => {
  it('rapid setParams bursts commit only the run matching the final parameters', async () => {
    const store = new ExplorerStore()
    const spec = makeSpec()
    const compiled = compileFormula(spec.rhs)!
    const ex = store.create('ex-async', spec, compiled)
    expect(ex.status).toBe('computing')
    await store.waitForRun('ex-async')

    // fire a burst of parameter changes without awaiting in between
    const burst = [1.2, 1.6, 2.0, 2.4, 3.0]
    for (const v of burst) {
      void store.setParams('ex-async', { a: v })
    }
    const final = await store.waitForRun('ex-async')
    // the committed run must match the LAST parameters exactly
    expect(final.spec.params.a).toBe(3.0)
    expect(final.spec.params.b).toBe(1)
    // peak = |a| (within sampling tolerance) — proving it recomputed with a=3
    expect(final.result!.peak).toBeCloseTo(3, 3)
    // the store's current run is the final one, never an intermediate
    const current = store.get('ex-async')!
    expect(current.run?.runId).toBe(final.runId)
    expect(current.status).toBe('resolved')
  })

  it('a waiter started before a param change never resolves with the new run', async () => {
    const store = new ExplorerStore()
    const spec = makeSpec()
    const compiled = compileFormula(spec.rhs)!
    store.create('ex-mid', spec, compiled)
    // waiter anchors to the CURRENT params (a=1) at call time
    const initial = store.waitForRun('ex-mid')
    // flip the parameters mid-flight; a second waiter anchors to a=2.5
    const switched = (async () => {
      await Promise.resolve()
      void store.setParams('ex-mid', { a: 2.5 })
      return store.waitForRun('ex-mid')
    })()
    const first = await initial.catch(() => null) // reject-on-change is also correct
    const second = await switched
    // whatever the first waiter got, it must NEVER be the a=2.5 run
    if (first) expect(first.spec.params.a).toBe(1)
    expect(second.spec.params.a).toBe(2.5)
    expect(second.result!.peak).toBeCloseTo(2.5, 3)
    // store's committed run is the newest one
    expect(store.get('ex-mid')!.run?.spec.params.a).toBe(2.5)
  })

  it('fork keeps parent run untouched and stamps parentRunId on the child', async () => {
    const store = new ExplorerStore()
    const spec = makeSpec()
    const compiled = compileFormula(spec.rhs)!
    store.create('ex-parent', spec, compiled)
    const parentRun = await store.waitForRun('ex-parent')
    const parentPeak = parentRun.result!.peak

    store.fork('ex-parent', 'ex-child')
    void store.setParams('ex-child', { a: 4 })
    const childRun = await store.waitForRun('ex-child')
    expect(childRun.parentRunId).toBe(parentRun.runId)
    expect(childRun.result!.peak).toBeCloseTo(4, 3)
    // parent explorer unchanged
    const parent = store.get('ex-parent')!
    expect(parent.params.a).toBe(1)
    expect(parent.run!.result!.peak).toBeCloseTo(parentPeak, 12)
  })

  it('out-of-range parameters are rejected before mutation', async () => {
    const store = new ExplorerStore()
    const spec = makeSpec()
    const compiled = compileFormula(spec.rhs)!
    store.create('ex-range', spec, compiled)
    await store.waitForRun('ex-range')
    expect(() => store.setParams('ex-range', { a: 999 })).toThrow(/Invalid parameter/)
    expect(store.get('ex-range')!.params.a).toBe(1)
  })
})
