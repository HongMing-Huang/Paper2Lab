// paper→model L2 acceptance on a REAL three-state paper: the SIR tectonic
// paper (public/papers/ode-sir-three-state.pdf, real Docling fixture). The
// chain has NO synthetic steps: parse(d fixture) → route → buildPaperSpec →
// model.build/model.solve with the paper's OWN equations/initials/parameters
// → physics assertions (conservation, outbreak threshold).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeDocling } from '../ingest/doclingSchema'
import { routeAdapter } from './adapterRouter'
import { buildPaperSpec, governingSystem, initialsOf, nominalParams } from './paperSpec'
import { executeSkill } from './executor'
import { buildPlan } from './playPlan'

function sirDoc() {
  return normalizeDocling(JSON.parse(readFileSync(join('src/ingest/fixtures', 'ode-sir-three-state.docling.json'), 'utf8')))
}

describe('three-state SIR paper → model (real paper, real engine)', () => {
  it('routes to the ode adapter with 3 governing equations', () => {
    const d = routeAdapter(sirDoc())
    expect(d.status).toBe('ok')
    expect(d.adapter).toBe('ode')
    const spec = buildPaperSpec(sirDoc())
    const gov = spec.equations.filter((e) => e.role === 'governing')
    expect(gov.map((e) => e.state).sort()).toEqual(['I', 'R', 'S']) // 3 states — beyond ode.phase's 2
    expect(initialsOf(spec)).toEqual({ S: 0.99, I: 0.01, R: 0 })
    // β, γ are labeled parameters from the rhs free letters
    expect(spec.quantities.filter((q) => q.role === 'parameter').map((q) => q.name).sort()).toEqual(['beta', 'gamma'])
  })

  it('builds and solves the 3-state model — conservation + outbreak', async () => {
    const spec = buildPaperSpec(sirDoc())
    const sys = governingSystem(spec)
    expect(sys.states.sort()).toEqual(['I', 'R', 'S'])
    // nominal β, γ read from the paper's own prose sentence — zero
    // hand-written numbers anywhere in this chain
    const params = nominalParams(sirDoc(), spec.quantities.filter((q) => q.role === 'parameter').map((q) => q.name))
    expect(params).toEqual({ beta: 0.4, gamma: 0.1 })

    const build = await executeSkill(
      'model.build',
      { states: sys.states, rhs: sys.rhs, params: params, initialState: initialsOf(spec) },
      buildPlan({ skill: 'model.build', goal: 'SIR paper build' }),
    )
    if (build.status !== 'ok' || !build.run?.result) throw new Error((build as { message?: string }).message ?? build.status)
    expect(build.run.spec.kind).toBe('model.compiled')
    const built = build.run.result as { nStates: number; freeParams: string[] }
    expect(built.nStates).toBe(3)
    expect(built.freeParams).toEqual([]) // β, γ both bound — nothing unbound at solve time

    const solved = await executeSkill(
      'model.solve',
      { states: sys.states, rhs: sys.rhs, params: params, initialState: initialsOf(spec), tSpan: [0, 80] },
      buildPlan({ skill: 'model.solve', goal: 'SIR paper solve' }),
    )
    if (solved.status !== 'ok' || !solved.run?.result) throw new Error((solved as { message?: string }).message ?? solved.status)
    const r = solved.run.result as {
      t: number[]
      series: Array<{ state: string; values: number[] }>
      perState: Array<{ state: string; min: number; max: number }>
    }
    const byState = Object.fromEntries(r.series.map((s) => [s.state, s.values]))
    const n = r.t.length

    // the paper's own claim: S + I + R stays constant (RK4 accuracy)
    const drift = Math.max(
      ...r.t.map((_, i) => Math.abs(byState.S![i]! + byState.I![i]! + byState.R![i]! - 1)),
    )
    expect(drift).toBeLessThan(1e-9)

    // threshold βS0/γ = 3.96 > 1 ⇒ outbreak: I grows well past its initial 1%
    const iPeak = Math.max(...byState.I!)
    expect(iPeak).toBeGreaterThan(0.2)

    // burnout: the susceptible pool ends far below its initial value
    expect(byState.S![n - 1]!).toBeLessThan(0.2)
    expect(byState.S![n - 1]!).toBeGreaterThan(0) // never negative — fractions
  })

  it('fork changes a parameter, not the paper initials (β ↓ below threshold kills the outbreak)', async () => {
    const spec = buildPaperSpec(sirDoc())
    const sys = governingSystem(spec)
    const params = nominalParams(sirDoc(), spec.quantities.filter((q) => q.role === 'parameter').map((q) => q.name))
    const out = await executeSkill(
      'model.solve',
      { states: sys.states, rhs: sys.rhs, params: params, initialState: initialsOf(spec), tSpan: [0, 80] },
      buildPlan({ skill: 'model.solve', goal: 'SIR baseline' }),
    )
    if (out.status !== 'ok' || !out.run) throw new Error(out.status)
    // fork: β 0.4 → 0.05 (βS0/γ = 0.495 < 1 — below threshold, no outbreak)
    const fork = await executeSkill('experiment.fork', { sourceRunId: out.run.runId, parameterChanges: { beta: 0.05 } }, buildPlan({ skill: 'model.solve', goal: 'SIR below-threshold fork' }))
    if (fork.status !== 'ok' || !fork.run?.result) throw new Error((fork as { message?: string }).message ?? fork.status)
    const fr = fork.run.result as { series: Array<{ state: string; values: number[] }> }
    const i = fr.series.find((s) => s.state === 'I')!
    const iPeak = Math.max(...i.values)
    expect(iPeak).toBeLessThan(0.02) // no outbreak below the threshold
    expect(fork.run.parentRunId).toBe(out.run.runId) // lineage kept
  })
})
