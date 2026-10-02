import { afterEach, describe, expect, it } from 'vitest'
import { explorerStore } from '../desk/explorerStore'
import { analyzeFormula } from '../formula/analyze'
import { buildExplorerSpec } from '../formula/spec'
import { executeFormulaSteps } from './formulaExecutor'

function create(id: string) {
  const { spec, compiled } = buildExplorerSpec(analyzeFormula('y = a x'), { docId: 'test', page: 1, bbox: { x: 0, y: 0, w: 1, h: 1 }, latex: 'y = a x' })
  explorerStore.create(id, spec, compiled)
}
afterEach(() => explorerStore.ids().forEach((id) => explorerStore.dispose(id)))
describe('registered formula execution', () => {
  it('forks the supplied experiment and compares real settled runs', async () => {
    create('first'); create('selected')
    explorerStore.setParams('selected', { a: 2 })
    const result = await executeFormulaSteps('selected', [
      { op: 'experiment.fork' }, { op: 'formula.scale', param: 'a', value: 2 },
      { op: 'formula.plot' }, { op: 'experiment.compare' },
    ], { fork: (id) => { explorerStore.fork(id, 'child'); return 'child' }, compare: () => {} })
    expect(explorerStore.get('first')?.params.a).toBe(1)
    expect(explorerStore.get('selected')?.params.a).toBe(2)
    expect(explorerStore.get('child')?.params.a).toBe(4)
    expect(result.runs[0].parentRunId).toBe(explorerStore.get('selected')?.run?.runId)
    // comparison now comes from the Run Repository's explicit two-run diff
    const cmp = result.comparison as { runA: string; runB: string; rows: Array<{ key: string; a: number | null; b: number | null; delta: number | null }> }
    expect(cmp.runA).toBe(explorerStore.get('selected')?.run?.runId)
    expect(cmp.runB).toBe(explorerStore.get('child')?.run?.runId)
    const peakRow = cmp.rows.find((r) => r.key === 'peak')!
    expect(peakRow.delta).toBeCloseTo((peakRow.b ?? 0) - (peakRow.a ?? 0), 12)
    // y = a·x on [-7,7]: doubling a doubles the |y| integral
    expect(peakRow.b! / peakRow.a!).toBeCloseTo(2, 6)
  })
  it('rejects a malformed plan before creating its first fork', async () => {
    create('base')
    let forked = false
    await expect(executeFormulaSteps('base', [{ op: 'experiment.fork' }, { op: 'formula.set', param: 'a', value: NaN }], {
      fork: () => { forked = true; return 'child' }, compare: () => {},
    })).rejects.toThrow()
    expect(forked).toBe(false)
  })
})
