import { describe, expect, it } from 'vitest'
import { executeSpec, ENGINES, getExperimentRun, exportExperimentRuns, ExperimentExecutionError } from './protocol'

describe('immutable experiment history', () => {
  it('retains model, source, parent, and original inputs after the caller changes them', async () => {
    const spec = { kind: 'formula.curve' as const, params: { a: 1 }, seed: 0, model: { expression: ['Multiply', 'a', 'x'] }, source: { docId: 'paper' } }
    const run = await executeSpec(spec, ENGINES.cortexJs, () => ({ peak: 1 }), { parentRunId: 'parent' })
    spec.params.a = 4
    expect(getExperimentRun(run.runId)?.spec.params.a).toBe(1)
    expect(run.parentRunId).toBe('parent')
    expect(Object.isFrozen(run.result)).toBe(true)
    expect(JSON.parse(exportExperimentRuns([run.runId]))[0].spec.model).toEqual(spec.model)
  })
  it('records a failed run without pretending it resolved', async () => {
    try {
      await executeSpec({ kind: 'formula.curve', params: {}, seed: 0 }, ENGINES.cortexJs, () => { throw new Error('domain error') })
      throw new Error('Expected compute failure')
    } catch (error) {
      expect(error).toBeInstanceOf(ExperimentExecutionError)
      const run = (error as ExperimentExecutionError).run
      expect(getExperimentRun(run.runId)?.status).toBe('error')
      expect(run.result).toBeUndefined()
      expect(run.errors).toEqual(['domain error'])
    }
  })
})
