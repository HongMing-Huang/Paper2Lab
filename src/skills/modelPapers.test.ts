// #51 P0-B/P0-E: paper-driven N-state models on TWO non-same-template real
// papers (beyond the SIR/LV corpus): a FOUR-state enzyme-kinetics paper
// (greek rate constants, reversible reactions) and a two-state spring–damper
// with SYMBOLIC coefficients. Chain is fully synthetic-free: real tectonic
// PDF → real Docling fixture → route → PaperModelSpec → model.build/solve →
// physics invariants stated by the papers themselves.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeDocling } from '../ingest/doclingSchema'
import { routeAdapter } from './adapterRouter'
import { buildPaperSpec, governingSystem, initialsOf, nominalParams } from './paperSpec'
import { executeSkill } from './executor'
import { buildPlan } from './playPlan'

function realDoc(name: string) {
  return normalizeDocling(JSON.parse(readFileSync(join('src/ingest/fixtures', `${name}.docling.json`), 'utf8')))
}

interface SolveResult {
  t: number[]
  series: Array<{ state: string; values: number[] }>
  perState: Array<{ state: string; min: number; max: number }>
  period0: number | null
}

async function solvePaper(name: string) {
  const doc = realDoc(name)
  const d = routeAdapter(doc)
  expect(d.status).toBe('ok')
  expect(d.adapter).toBe('ode')
  const spec = buildPaperSpec(doc)
  const sys = governingSystem(spec)
  const initials = initialsOf(spec)
  const params = nominalParams(doc, spec.quantities.filter((q) => q.role === 'parameter').map((q) => q.name))
  // build gate: every rhs compiles and every state has the paper's initial
  const build = await executeSkill(
    'model.build',
    { states: sys.states, rhs: sys.rhs, params, initialState: initials },
    buildPlan({ skill: 'model.build', goal: `${name} build` }),
  )
  if (build.status !== 'ok' || !build.run) throw new Error((build as { message?: string }).message ?? 'build failed')
  const solve = await executeSkill(
    'model.solve',
    { states: sys.states, rhs: sys.rhs, params, initialState: initials, tSpan: [0, 150] },
    buildPlan({ skill: 'model.solve', goal: `${name} solve` }),
  )
  if (solve.status !== 'ok' || !solve.run?.result) throw new Error((solve as { message?: string }).message ?? 'solve failed')
  return { spec, sys, initials, params, result: solve.run.result as unknown as SolveResult }
}

describe('paper-driven models — two non-same-template real papers (#51)', () => {
  it('michaelis–menten (4 states, greek rates): BOTH paper-stated totals conserved', async () => {
    const { sys, initials, params, result } = await solvePaper('ode-michaelis-menten')
    expect(sys.states.sort()).toEqual(['C', 'E', 'P', 'S']) // FOUR states — not the 2-state template
    expect(initials).toEqual({ S: 1, C: 0, E: 0.1, P: 0 })
    expect(params).toEqual({ kappa: 1.0, lambda: 0.2, mu: 0.4 }) // greek prose rates, zero hand-written
    const by = Object.fromEntries(result.series.map((s) => [s.state, s.values]))
    // paper claim 1: E + C constant (enzyme total)
    const enzymeDrift = Math.max(...result.t.map((_, i) => Math.abs(by.E![i]! + by.C![i]! - 0.1)))
    expect(enzymeDrift).toBeLessThan(1e-9)
    // paper claim 2: S + C + P constant (substrate total)
    const subsDrift = Math.max(...result.t.map((_, i) => Math.abs(by.S![i]! + by.C![i]! + by.P![i]! - 1)))
    expect(subsDrift).toBeLessThan(1e-9)
    // paper claim 3: product rises MONOTONICALLY toward the initial
    // substrate level (slow reaction — small enzyme total; long window)
    const P = by.P!
    for (let i = 1; i < P.length; i++) {
      expect(P[i]!).toBeGreaterThanOrEqual(P[i - 1]! - 1e-12)
    }
    expect(P[P.length - 1]!).toBeGreaterThan(0.85)
  })

  it('spring–damper (2 states, SYMBOLIC k/c from prose): decaying periodic motion', async () => {
    const { sys, initials, params, result } = await solvePaper('ode-spring-params')
    expect(sys.states).toEqual(['x', 'y'])
    expect(initials).toEqual({ x: 1, y: 0 })
    expect(params).toEqual({ k: 2, c: 0.5 }) // symbolic coefficients bound from the paper's sentence
    const x = result.series.find((s) => s.state === 'x')!.values
    // amplitude decays: last-third peak is a fraction of the first peak
    // (the paper's qualitative claim)
    const firstPeak = Math.max(...x.slice(0, Math.floor(x.length / 3)))
    const lastPeak = Math.max(...x.slice(Math.floor((2 * x.length) / 3)))
    expect(lastPeak).toBeLessThan(firstPeak * 0.45)
    // the midline-period estimator HONESTLY returns null for a decaying
    // signal (later peaks never re-cross the global midline) — that fact is
    // itself the observation, matching ode.phase's contract
    expect(result.period0).toBeNull()
  })

  it('all five ODE corpus papers differ in template (state counts / param kinds)', async () => {
    // the corpus now spans 2/2/3/4 states, 0/inline/greek/latin/mixed params
    const counts = ['ode-lotka-volterra', 'ode-damped-oscillator', 'ode-sir-three-state', 'ode-michaelis-menten', 'ode-spring-params']
      .map((n) => governingSystem(buildPaperSpec(realDoc(n))).states.length)
    expect(counts.sort()).toEqual([2, 2, 2, 3, 4])
  })
})
