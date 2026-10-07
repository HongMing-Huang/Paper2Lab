// ODE phase store contract (#24): paper system → exact run; drag preview
// through the same kernels; release commits a NEW run and records history;
// latest release wins.
import { describe, expect, it } from 'vitest'
import { OdePhaseStore, previewTrajectory, compileRhsFn } from './odePhaseStore'

function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const check = () => {
      if (cond()) return resolve()
      if (Date.now() - t0 > timeoutMs) return reject(new Error('waitFor timeout'))
      setTimeout(check, 25)
    }
    check()
  })
}

const STORE = new OdePhaseStore()

describe('odePhaseStore (#24)', () => {
  it('creates from a paper system, computes the exact run, previews during drag, records history on release', async () => {
    STORE.create('ode-1', {
      states: ['x', 'y'],
      rhs: ['x - x y', 'x y - y'],
      initial: [2, 0.5],
    })
    await waitFor(() => STORE.get('ode-1')?.status === 'resolved')
    const run1 = STORE.get('ode-1')!.run!
    expect(run1.spec.kind).toBe('ode.phase2')
    expect(run1.result!.s0.length).toBeGreaterThan(200)
    expect(STORE.get('ode-1')!.history).toHaveLength(1)

    // drag MOVE: preview through the SAME compiled kernels — no new run
    STORE.setPreviewInitial('ode-1', 0.8, 0.6)
    const during = STORE.get('ode-1')!
    expect(during.preview).not.toBeNull()
    expect(during.preview!.s0.length).toBeGreaterThan(50) // coarse grid
    expect(during.status).toBe('stale')
    expect(during.run).toBe(run1) // exact evidence untouched by the drag

    // release: a NEW exact run for the new initial point + history entry
    await STORE.release('ode-1')
    await waitFor(() => STORE.get('ode-1')?.status === 'resolved' && STORE.get('ode-1')!.run !== run1)
    const exAfter = STORE.get('ode-1')!
    expect(exAfter.run!.spec.params.x).toBeCloseTo(0.8, 5)
    expect(exAfter.run!.spec.params.y).toBeCloseTo(0.6, 5)
    expect(exAfter.history).toHaveLength(2)
    expect(exAfter.history[1].runId).toBe(exAfter.run!.runId) // Data → Experiment
    expect(exAfter.preview).toBeNull()
  })

  it('latest release wins: a superseded commit never lands', async () => {
    STORE.create('ode-2', { states: ['x', 'y'], rhs: ['y', '-x - 0.5 y'], initial: [1.5, 0] })
    await waitFor(() => STORE.get('ode-2')?.status === 'resolved')
    const run1 = STORE.get('ode-2')!.run!
    // two rapid releases — only the LAST may commit
    void STORE.release('ode-2', 1.0, 0)
    void STORE.release('ode-2', -0.5, 0.25)
    await waitFor(() => STORE.get('ode-2')?.status === 'resolved' && STORE.get('ode-2')!.run !== run1, 8000)
    const ex = STORE.get('ode-2')!
    expect(ex.run!.spec.params.x).toBeCloseTo(-0.5, 5) // the later initial
    expect(ex.history).toHaveLength(2) // run1 + the single winning commit
  })

  it('preview + kernels are pure functions of the paper system (deterministic)', () => {
    const f0 = compileRhsFn('x - x y', ['x', 'y'])!
    const f1 = compileRhsFn('x y - y', ['x', 'y'])!
    expect(f0(2, 0.5)).toBeCloseTo(1, 10) // x(1−y) = 2·0.5
    const a = previewTrajectory(f0, f1, [2, 0.5], [0, 20])
    const b = previewTrajectory(f0, f1, [2, 0.5], [0, 20])
    expect(a.s0).toEqual(b.s0)
  })
})
