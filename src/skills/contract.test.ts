// Lane A — the scientific contract (total-control-owned files):
//   1. degenerate inputs (res=0) are REJECTED at the schema, never producing
//      a CALCULATED run with NaN metrics
//   2. the finite-value gate turns any NaN/Infinity result into an ERROR run
//      (with the failing path in the message) instead of evidence
//   3. forks inherit the parent's provenance source and parentRunId
//   4. REPLAY GATE: every registered numeric skill round-trips — the run a
//      skill produces must be replayable to the same numbers
import { describe, expect, it } from 'vitest'
import '../physics/registerMujocoRunner'
import { executeSkill, replayRun } from './executor'
import { schemaError } from './registry'

const plan = { planId: 'plan-contract' }

describe('Lane A: input ranges', () => {
  it('res=0 is rejected by the schema (not a NaN CALCULATED run)', async () => {
    const err = schemaError(
      { type: 'object', required: ['res'], properties: { res: { type: 'integer', minimum: 1 } } },
      { res: 0 },
      'input',
    )
    expect(err).toMatch(/below minimum/)

    const out = await executeSkill('kakeya.measure', { deltaExp: 4, packing: 0, res: 0, nTubes: 32 }, plan)
    expect(out.status).toBe('error')
    if (out.status === 'error') expect(out.message).toMatch(/res/)
  })

  it('out-of-range samples/steps are rejected before any compute', async () => {
    const plot = await executeSkill('formula.plot', {
      expression: ['Sin', 'x'], parameters: ['x'], values: { x: 0 }, independent: 'x', range: [-1, 1], samples: 1,
    }, plan)
    expect(plot.status).toBe('error')
    const mj = await executeSkill('mujoco.simulate', { scene: 'simple.xml', steps: 0 }, plan)
    expect(mj.status).toBe('error')
  })
})

describe('Lane A: finite-value gate', () => {
  it('a compute that yields NaN records an ERROR run, never CALCULATED evidence', async () => {
    // formula.evaluate is the easiest NaN producer: log(-1) is NaN in JS
    const out = await executeSkill('formula.evaluate', {
      expression: ['Ln', -1], bindings: {},
    }, plan)
    expect(out.status).toBe('error')
    if (out.status === 'error') expect(out.message).toMatch(/non-finite|NaN|finite/i)
    const failedRun = (out as { run?: { status: string; evidence: string } }).run
    if (failedRun) {
      expect(failedRun.status).toBe('error') // recorded as error, never evidence
    }
  })
})

describe('Lane A: fork source inheritance', () => {
  it('fork keeps parentRunId AND the parent spec.source anchor', async () => {
    const anchor = { anchorId: 'anchor-7', latex: 'y=a\\sin(bx)', page: 2 }
    const base = await executeSkill('formula.plot', {
      expression: ['Multiply', 'a', ['Sin', 'x']], parameters: ['a', 'x'], values: { a: 1, x: 0 },
      independent: 'x', range: [-7, 7], samples: 81,
    }, { ...plan, source: anchor })
    expect(base.status).toBe('ok')
    if (base.status !== 'ok' || !base.run) return
    expect(base.run.spec.source).toEqual(anchor)

    const fork = await executeSkill('experiment.fork', {
      sourceRunId: base.run.runId,
      parameterChanges: { a: 3 },
    }, plan)
    expect(fork.status).toBe('ok')
    if (fork.status !== 'ok' || !fork.run) return
    expect(fork.run.parentRunId).toBe(base.run.runId)
    expect(fork.run.spec.source).toEqual(anchor) // ← the inheritance fix
    // kakeya forks inherit too
    const kb = await executeSkill('kakeya.measure', { deltaExp: 4, packing: 0, res: 16, nTubes: 16 }, { ...plan, source: { anchorId: 'k1' } })
    if (kb.status === 'ok' && kb.run) {
      const kf = await executeSkill('experiment.fork', { sourceRunId: kb.run.runId, parameterChanges: { packing: 1 } }, plan)
      if (kf.status === 'ok' && kf.run) expect(kf.run.spec.source).toEqual({ anchorId: 'k1' })
    }
  })
})

describe('Lane A: replay gate — every numeric kind round-trips', () => {
  const CASES: Array<[string, string, Record<string, unknown>]> = [
    ['formula.value', 'formula.evaluate', { expression: ['Sin', 'x'], bindings: { x: 1 } }],
    ['formula.curve', 'formula.plot', {
      expression: ['Multiply', 'a', ['Sin', 'x']], parameters: ['a', 'x'], values: { a: 2, x: 0 },
      independent: 'x', range: [-5, 5], samples: 41,
    }],
    ['kakeya.geometry', 'kakeya.generate', { deltaExp: 4, packing: 0.3, nTubes: 24 }],
    ['kakeya.voxel', 'kakeya.measure', { deltaExp: 4, packing: 0.5, res: 18, nTubes: 16 }],
    ['kakeya.sweep', 'kakeya.sweep', { param: 'nTubes', values: [8, 16], nTubes: 8, deltaExp: 4, packing: 0, res: 14 }],
    ['perron.tree', 'geometry.2d', { construction: 'perron-tree', params: { k: 3, alpha: 0.8 } }],
    ['lv.ode', 'ode.solve', {
      system: { kind: 'lv2', params: { alpha: 1.1, beta: 0.4, gamma: 0.4, delta: 0.1 } },
      initialValues: { prey: 1, predator: 0.5 },
      tSpan: [0, 4],
    }],
    ['mujoco.sim', 'mujoco.simulate', { scene: 'simple.xml', steps: 60, sampleEvery: 30 }],
  ]

  it.each(CASES)('%s replays to identical metrics', async (kind, skill, input) => {
    const first = await executeSkill(skill, input, plan)
    expect(first.status, `${skill} first run`).toBe('ok')
    if (first.status !== 'ok' || !first.run) return
    expect(first.run.spec.kind).toBe(kind)

    const replay = await replayRun(first.run.runId)
    expect(replay.status, `${kind} replay`).toBe('ok')
    if (replay.status !== 'ok' || !replay.run) return
    expect(replay.run.runId).not.toBe(first.run.runId)
    // numbers must match exactly; per-execution child runIds (sweep points
    // trace their own child runs) are identity, not metrics — strip them
    const strip = (r: unknown): string =>
      JSON.stringify(r, (k, v) => (k === 'runId' ? undefined : v))
    expect(strip(replay.run.result)).toBe(strip(first.run.result))
  }, 120_000)

  it('imported precomputed runs replay through the kakeya measure kernel', async () => {
    // cpp-precomputed rows have stable model inputs — replay must reproduce
    const bundle = (await import('../data/kakeya-precomputed-runs.json')).default as {
      runs: Array<{ runId: string; result: { occupiedVolume: number } }>
    }
    const { importRuns } = await import('../experiments/runRepository')
    importRuns(JSON.stringify(bundle.runs.filter((r) => r.runId === 'kakeya-cpp-d4-p0-n64')))
    const row = bundle.runs.find((r) => r.runId === 'kakeya-cpp-d4-p0-n64')!
    const replay = await replayRun(row.runId)
    expect(replay.status).toBe('ok')
    if (replay.status !== 'ok' || !replay.run) return
    const mine = (replay.run.result as { occupiedVolume: number }).occupiedVolume
    expect(Math.abs(mine - row.result.occupiedVolume) / row.result.occupiedVolume).toBeLessThan(1e-6)
  })
})
