import { describe, expect, it } from 'vitest'
import { executeSpec, ENGINES, getExperimentRun, exportExperimentRuns, ExperimentExecutionError, registerImportedRun, type ExperimentRun } from './protocol'
import { importRuns } from './runRepository'

describe('Run results are JSON values', () => {
  const run = (compute: () => unknown, lineage = {}) =>
    executeSpec({ kind: 'formula.curve', params: {}, seed: 0 }, ENGINES.cortexJs, compute, lineage)
  const failure = async (compute: () => unknown, lineage = {}) => {
    try {
      await run(compute, lineage)
    } catch (error) {
      return error as ExperimentExecutionError
    }
    throw new Error('expected the run to fail')
  }
  class NotPlain { value = 1 }

  it.each<[string, unknown]>([
    ['NaN inside a typed array', { data: new Float64Array([1, NaN]) }],
    ['a finite typed array', { data: new Uint16Array([1, 2]) }],
    ['a nested typed array', { a: [{ b: new Float32Array(1) }] }],
    ['an ArrayBuffer', { data: new ArrayBuffer(8) }],
    ['a SharedArrayBuffer', { data: new SharedArrayBuffer(8) }],
    ['a DataView', { data: new DataView(new ArrayBuffer(8)) }],
    ['a Map', { data: new Map() }],
    ['a Set', { data: new Set() }],
    ['a Date', { data: new Date(0) }],
    ['a class instance', { data: new NotPlain() }],
    ['a function', { data: () => 1 }],
    ['a bigint', { data: 1n }],
    ['undefined inside an array', { data: [1, undefined] }],
    ['NaN', { data: NaN }],
    ['Infinity in an array', [Infinity]],
    ['no result at all', undefined],
  ])('rejects %s: error run, output_invalid, no result', async (_label, value) => {
    const error = await failure(() => value)
    expect(error).toBeInstanceOf(ExperimentExecutionError)
    expect(error.code).toBe('output_invalid')
    expect(error.run.status).toBe('error')
    expect(error.run.result).toBeUndefined()
    expect(getExperimentRun(error.run.runId)?.result).toBeUndefined()
  })

  it('stores its own copy: the producer can keep mutating what it returned', async () => {
    const produced = { points: [1, 2], meta: { peak: 3 } }
    const stored = await run(() => produced)
    produced.points[0] = 99
    produced.meta.peak = 99
    expect(stored.result).toEqual({ points: [1, 2], meta: { peak: 3 } })
    expect(Object.isFrozen(stored.result)).toBe(true)
    expect(Object.isFrozen(produced)).toBe(false)
  })

  it('drops undefined fields and keeps explicit nulls', async () => {
    const stored = await run(() => ({ a: undefined, b: null, c: [null] }))
    expect(stored.result).toStrictEqual({ b: null, c: [null] })
  })

  it('a thrown compute stays execution_failed', async () => {
    const error = await failure(() => { throw new Error('domain error') })
    expect(error.code).toBe('execution_failed')
    expect(error.run.errors).toEqual(['domain error'])
  })

  it('a contract validator can veto a finite, JSON-valid result', async () => {
    const error = await failure(() => ({ peak: 1 }), { validateOutput: () => 'missing field points' })
    expect(error.code).toBe('output_invalid')
    expect(error.run.result).toBeUndefined()
    expect(error.run.errors[0]).toMatch(/missing field points/)
  })

  it('the validator sees the stored copy, not the producer object', async () => {
    const produced = { a: undefined, b: 1 }
    let seen: unknown
    await run(() => produced, { validateOutput: (r: unknown) => { seen = r; return null } })
    expect(seen).toStrictEqual({ b: 1 })
    expect(seen).not.toBe(produced)
  })

  it('an imported resolved run is held to the same boundary', () => {
    const resolved = (runId: string, result: unknown): ExperimentRun => ({
      runId, spec: { kind: 'formula.curve', params: {}, seed: 0 }, status: 'resolved', result,
      engine: 'test', engineVersion: '0', durationMs: 0, evidence: 'CALCULATED', createdAt: 0, startedAt: 0, errors: [],
    })
    expect(() => registerImportedRun(resolved('import-binary', { data: new Uint16Array(2) }))).toThrow(/binary/i)
    expect(() => registerImportedRun(resolved('import-nan', { peak: NaN }))).toThrow(/non-finite/)
    expect(getExperimentRun('import-binary')).toBeUndefined()
    registerImportedRun(resolved('import-ok', { peak: 1 }))
    expect(getExperimentRun('import-ok')?.result).toEqual({ peak: 1 })
  })

  it.each<[string, Partial<ExperimentRun>]>([
    ['an error run carrying a result', { status: 'error', result: { y: 123.456 }, errors: ['boom'] }],
    ['a resolved run carrying errors', { status: 'resolved', result: { peak: 1 }, errors: ['late error'] }],
    ['an error run without a message', { status: 'error', result: undefined, errors: [] }],
    ['an illegal status', { status: 'finished' as ExperimentRun['status'], result: { peak: 1 }, errors: [] }],
  ])('import refuses %s — rejected output can never become chart evidence', (_label, patch) => {
    const bad: ExperimentRun = {
      runId: `import-bad-${Math.random().toString(36).slice(2, 7)}`,
      spec: { kind: 'kakeya.voxel', params: {}, seed: 0 },
      status: 'resolved', result: undefined,
      engine: 'test', engineVersion: '0', durationMs: 0, evidence: 'CALCULATED', createdAt: 0, startedAt: 0, errors: [],
      ...patch,
    }
    expect(() => registerImportedRun(bad)).toThrow(/status|error run|resolved/)
    expect(getExperimentRun(bad.runId)).toBeUndefined()
  })

  it('importRuns applies the same consistency gate bundle-wide', () => {
    const bundle = JSON.stringify([{
      runId: 'bundle-bad-1', spec: { kind: 'kakeya.voxel', params: {}, seed: 0 }, status: 'error',
      result: { occupiedVolume: 0.5 }, engine: 'cpp-precompute', engineVersion: 'kakeya-voxel-v3-cpp',
      durationMs: 1, evidence: 'CALCULATED', createdAt: 0, startedAt: 0, errors: ['partial write'],
    }])
    expect(() => importRuns(bundle)).toThrow(/error run carrying a result/)
  })

  it('importRuns is atomic: a bad entry leaves the GOOD entries unregistered and retryable', () => {
    const good = (runId: string): ExperimentRun => ({
      runId, spec: { kind: 'formula.curve', params: {}, seed: 0 }, status: 'resolved', result: { peak: 1 },
      engine: 't', engineVersion: '0', durationMs: 0, evidence: 'CALCULATED', createdAt: 0, startedAt: 0, errors: [],
    })
    const bad = { ...good('bundle-bad-2'), status: 'stale' as const, result: { peak: 2 } }
    expect(() => importRuns(JSON.stringify([good('bundle-good-2'), bad]))).toThrow(/'stale' while carrying a result/)
    expect(getExperimentRun('bundle-good-2')).toBeUndefined()
    // retry after fixing the bundle succeeds (ids were never burned)
    expect(importRuns(JSON.stringify([good('bundle-good-2')])).imported).toBe(1)
  })

  it('in-flight imports (stale/computing) with a result are refused', () => {
    const stale = (runId: string, status: 'stale' | 'computing'): ExperimentRun => ({
      runId, spec: { kind: 'formula.curve', params: {}, seed: 0 }, status, result: { peak: NaN },
      engine: 't', engineVersion: '0', durationMs: 0, evidence: 'CALCULATED', createdAt: 0, startedAt: 0, errors: [],
    })
    expect(() => registerImportedRun(stale('import-stale', 'stale'))).toThrow(/'stale' while carrying a result/)
    expect(() => registerImportedRun(stale('import-computing', 'computing'))).toThrow(/'computing' while carrying a result/)
  })

  it('a nested executeSpec failure keeps its classification (M2 regression)', async () => {
    // an inner run whose OUTPUT breaks the contract → the outer wrapper must
    // still report output_invalid, not relabel it execution_failed
    const inner = async () =>
      executeSpec({ kind: 'kakeya.voxel', params: {}, seed: 0 }, ENGINES.cortexJs, () => ({ data: new Uint16Array(2) }))
    const outer = executeSpec(
      { kind: 'kakeya.sweep', params: {}, seed: 0 },
      ENGINES.kakeyaWorker,
      async () => { await inner() },
    )
    const error = await (async () => { try { await outer; throw new Error('expected failure') } catch (e) { return e as ExperimentExecutionError } })()
    expect(error).toBeInstanceOf(ExperimentExecutionError)
    expect(error.code).toBe('output_invalid')
    expect(error.run.status).toBe('error')
    expect(error.run.result).toBeUndefined()
    // and a plain kernel throw inside a nested compute stays execution_failed
    const outer2 = executeSpec(
      { kind: 'kakeya.sweep', params: {}, seed: 0 },
      ENGINES.kakeyaWorker,
      async () => {
        await executeSpec({ kind: 'kakeya.voxel', params: {}, seed: 0 }, ENGINES.cortexJs, () => { throw new Error('domain error') })
      },
    )
    const error2 = await (async () => { try { await outer2; throw new Error('expected failure') } catch (e) { return e as ExperimentExecutionError } })()
    expect(error2.code).toBe('execution_failed')
  })

  it('a __proto__ key in a result object is refused (prototype pollution)', async () => {
    const evil: Record<string, unknown> = { peak: 1 }
    Object.defineProperty(evil, '__proto__ok', { value: 1, enumerable: true })
    const error = await failure(() => ({ ...evil, ['__proto__' as string]: { polluting: true } }) as unknown)
    expect(error).toBeInstanceOf(ExperimentExecutionError)
    expect(error.run.errors[0]).toMatch(/prototype key/)
  })
})

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
