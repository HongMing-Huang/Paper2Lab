// paper→model L1 acceptance: buildPaperSpec extracts the comprehension spec
// DETERMINISTICALLY from REAL parsed papers (the committed docling fixtures
// of the four tectonic papers) — governing/initial equations, state roles
// with the paper's own initials, table observables, and result claims.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeDocling } from '../ingest/doclingSchema'
import { buildPaperSpec, governingSystem, initialsOf } from './paperSpec'

function realDoc(name: string) {
  return normalizeDocling(JSON.parse(readFileSync(join('src/ingest/fixtures', `${name}.docling.json`), 'utf8')))
}

describe('buildPaperSpec — real-paper comprehension (L1)', () => {
  it('lotka–volterra: 2 governing equations, paper initials, periodic claim', () => {
    const spec = buildPaperSpec(realDoc('ode-lotka-volterra'))
    const gov = spec.equations.filter((e) => e.role === 'governing')
    expect(gov.map((e) => e.state).sort()).toEqual(['x', 'y'])
    expect(initialsOf(spec)).toEqual({ x: 2, y: 0.5 }) // PAPER-stated, verbatim
    const sys = governingSystem(spec)
    expect(sys.states).toEqual(['x', 'y'])
    expect(sys.rhs.x).toContain('x')
    // claims carry the paper's own result language
    expect(spec.claims.length).toBeGreaterThan(0)
    expect(spec.provenance).toBe('deterministic')
  })

  it('damped oscillator: 2 governing equations with the paper initials', () => {
    const spec = buildPaperSpec(realDoc('ode-damped-oscillator'))
    const gov = spec.equations.filter((e) => e.role === 'governing')
    expect(gov.length).toBe(2)
    expect(initialsOf(spec)).toEqual({ x: 1.5, y: 0 })
  })

  it('sine-fit paper: no derivatives → definitions only + table observables', () => {
    const spec = buildPaperSpec(realDoc('fit-sine-fit'))
    expect(spec.equations.every((e) => e.role !== 'governing')).toBe(true)
    expect(spec.equations.some((e) => e.role === 'definition')).toBe(true)
    const observables = spec.quantities.filter((q) => q.role === 'observable').map((q) => q.name)
    // docling swallowed the bare "x" into the unit cell ("(s)") — the honest
    // deterministic extraction keeps y; x is classified independent below
    expect(observables).toEqual(['y'])
    // parameters a, b are recognized from the definition's free letters
    const params = spec.quantities.filter((q) => q.role === 'parameter').map((q) => q.name).sort()
    expect(params).toEqual(['a', 'b'])
    expect(spec.quantities.find((q) => q.role === 'independent')?.name).toBe('x')
  })

  it('spec → model.solve full chain (LV from the paper, real integration)', async () => {
    const spec = buildPaperSpec(realDoc('ode-lotka-volterra'))
    const sys = governingSystem(spec)
    const initials = initialsOf(spec)
    expect(sys.states.length).toBe(2)
    expect(Object.keys(initials)).toEqual(sys.states)
    // the SPEC itself is enough input to build & solve — nothing hand-written
    const { executeSkill } = await import('./executor')
    const { buildPlan } = await import('./playPlan')
    const out = await executeSkill(
      'model.solve',
      { states: sys.states, rhs: sys.rhs, initialState: initials, tSpan: [0, 20] },
      buildPlan({ skill: 'model.solve', goal: 'spec-driven solve' }),
    )
    if (out.status !== 'ok' || !out.run?.result) throw new Error((out as { message?: string }).message ?? out.status)
    const r = out.run.result as { series: Array<{ values: number[] }>; period0: number | null }
    // positive quadrant + closed orbit ⇒ periodic (the paper's claim)
    expect(r.series[0].values.every((v) => v > 0)).toBe(true)
    expect(r.period0).not.toBeNull()
  })
})
