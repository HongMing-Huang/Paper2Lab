// #24 three interaction classes — the ODE class end to end: PAPER fixtures
// (Docling-shaped) → router binding → odeSystemOf → ode.phase skill with the
// paper's own LaTeX right-hand sides. Two papers with different conditions:
// a predator–prey paper (positive quadrant, periodic) and a damped-oscillator
// paper (signed states, decaying amplitude). Fit class: data pairs → binding.
import { describe, expect, it } from 'vitest'
import { routeAdapter } from './adapterRouter'
import { odeSystemOf, parseDataPairs } from './paperBinding'
import { executeSkill } from './executor'
import { normalizeDocling } from '../ingest/doclingSchema'
import { buildPlan } from './playPlan'

const PREY_DOC = normalizeDocling({
  docId: 'prey',
  title: 'Predator-prey dynamics of a fishery',
  pages: [{ page: 1, width: 612, height: 792 }],
  items: [
    { id: 't1', kind: 'text', page: 1, bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.05 }, text: 'population dynamics with x(0) = 2 and y(0) = 0.5' },
    { id: 'f1', kind: 'formula', page: 1, bbox: { x: 0.3, y: 0.4, w: 0.4, h: 0.05 }, latex: '\\dot{x} = x - x y' },
    { id: 'f2', kind: 'formula', page: 1, bbox: { x: 0.3, y: 0.5, w: 0.4, h: 0.05 }, latex: '\\dot{y} = x y - y' },
  ],
})

const DAMPED_DOC = normalizeDocling({
  docId: 'damped',
  title: 'A damped oscillator benchmark',
  pages: [{ page: 1, width: 612, height: 792 }],
  items: [
    { id: 't1', kind: 'text', page: 1, bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.05 }, text: 'the oscillator starts at x(0) = 1.5, y(0) = 0' },
    { id: 'f1', kind: 'formula', page: 1, bbox: { x: 0.3, y: 0.4, w: 0.4, h: 0.05 }, latex: '\\dot{x} = y' },
    { id: 'f2', kind: 'formula', page: 1, bbox: { x: 0.3, y: 0.5, w: 0.4, h: 0.05 }, latex: '\\dot{y} = -x - 0.5 y' },
  ],
})

const FIT_DOC = normalizeDocling({
  docId: 'fitdoc',
  title: 'Signal attenuation measurements',
  pages: [{ page: 1, width: 612, height: 792 }],
  items: [
    { id: 't1', kind: 'text', page: 1, bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.05 }, text: 'we fit the model to the measured data below' },
    { id: 'f1', kind: 'formula', page: 1, bbox: { x: 0.3, y: 0.4, w: 0.4, h: 0.05 }, latex: 'y = a e^{-b x}' },
    { id: 'tab', kind: 'table', page: 1, bbox: { x: 0.2, y: 0.6, w: 0.6, h: 0.2 }, text: 'x y\n0.0 1.98\n1.0 1.21\n2.0 0.74\n3.0 0.45\nlegend row: unit m' },
  ],
})

describe('odeSystemOf — paper equations → 2-state system', () => {
  it('extracts states and anchored equations from \\dot forms', () => {
    const sys = odeSystemOf(PREY_DOC)!
    expect(sys.states).toEqual(['x', 'y'])
    expect(sys.equations.map((e) => e.anchorId)).toEqual(['f1', 'f2'])
    expect(sys.equations[0].latex).toBe('\\dot{x} = x - x y')
  })
  it('extracts \\frac{d·}{dt} forms too (second paper, different notation)', () => {
    const doc = normalizeDocling({
      docId: 'frac',
      title: 't',
      pages: [{ page: 1, width: 612, height: 792 }],
      items: [
        { id: 'a', kind: 'formula', page: 1, bbox: { x: 0.3, y: 0.4, w: 0.4, h: 0.05 }, latex: '\\frac{dx}{dt} = y' },
        { id: 'b', kind: 'formula', page: 1, bbox: { x: 0.3, y: 0.5, w: 0.4, h: 0.05 }, latex: '\\frac{dy}{dt} = -x' },
      ],
    })
    const sys = odeSystemOf(doc)!
    expect(sys.states).toEqual(['x', 'y'])
  })
  it('fewer than two state equations → null (router asks, never invents)', () => {
    const doc = normalizeDocling({
      docId: 'one',
      title: 't',
      pages: [{ page: 1, width: 612, height: 792 }],
      items: [
        { id: 't', kind: 'text', page: 1, bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.05 }, text: 'stability of the equilibrium' },
        { id: 'a', kind: 'formula', page: 1, bbox: { x: 0.3, y: 0.4, w: 0.4, h: 0.05 }, latex: '\\dot{x} = -x' },
      ],
    })
    expect(odeSystemOf(doc)).toBeNull()
    const d = routeAdapter(doc)
    expect(d.status).toBe('needs-info')
  })
})

describe('routing two ODE papers with different conditions (#24)', () => {
  it('predator–prey paper → ok/ode with the paper system and initials', () => {
    const d = routeAdapter(PREY_DOC)
    expect(d.status).toBe('ok')
    if (d.status !== 'ok') return
    expect(d.adapter).toBe('ode')
    expect(d.binding.system?.states).toEqual(['x', 'y'])
    const initial = d.binding.conditions.find((c) => c.kind === 'initial') as { values: Record<string, number> }
    expect(initial.values).toEqual({ x: 2, y: 0.5 })
    expect(d.binding.engine).toEqual({ skill: 'ode.phase', view: 'phase-plane-jsxgraph' })
  })
  it('damped-oscillator paper → ok/ode (signed states are physics, not populations)', () => {
    const d = routeAdapter(DAMPED_DOC)
    expect(d.status).toBe('ok')
    if (d.status !== 'ok') return
    expect(d.adapter).toBe('ode')
    expect(d.binding.system?.states).toEqual(['x', 'y'])
  })
})

describe('ode.phase — the paper LaTeX actually executes (#24)', () => {
  const PLAN = buildPlan({ skill: 'ode.phase', goal: 'test contract plan' })
  it('predator–prey paper system integrates to a periodic orbit', async () => {
    const sys = odeSystemOf(PREY_DOC)!
    const out = await executeSkill<{ t: number[]; s0: number[]; s1: number[]; period0: number | null }>(
      'ode.phase',
      {
        system: { kind: 'generic2', states: sys.states, rhs: { x: 'x - x y', y: 'x y - y' } },
        initialState: { x: 2, y: 0.5 },
        tSpan: [0, 20],
      },
      PLAN,
    )
    if (out.status !== 'ok' || !out.run?.result) throw new Error(out.status)
    const r = out.run.result
    expect(out.run.spec.kind).toBe('ode.phase2')
    expect(out.run.evidence).toBe('CALCULATED')
    expect(r.t.length).toBeGreaterThan(200)
    expect(r.s0.every((v) => Number.isFinite(v) && v > 0)).toBe(true)
    expect(r.period0).not.toBeNull() // closed orbit → periodic crossings
    // dynamics sanity at t≈0: ẋ = x(1−y) = 2·0.5 = 1 > 0 (rising)
    expect(r.s0[1]).toBeGreaterThan(r.s0[0])
  })
  it('damped oscillator (negative states allowed) decays toward the origin', async () => {
    const out = await executeSkill<{ t: number[]; s0: number[]; s1: number[] }>(
      'ode.phase',
      {
        system: { kind: 'generic2', states: ['x', 'y'], rhs: { x: 'y', y: '-x - 0.5 y' } },
        initialState: { x: 1.5, y: 0 },
        tSpan: [0, 20],
      },
      PLAN,
    )
    if (out.status !== 'ok' || !out.run?.result) throw new Error(out.status)
    const r = out.run.result
    expect(r.s0.some((v) => v < 0)).toBe(true) // it swings — signed states work
    const head = Math.max(...r.s0.slice(0, 20).map(Math.abs))
    const tail = Math.max(...r.s0.slice(-40).map(Math.abs))
    expect(tail).toBeLessThan(head * 0.2) // damping drains the amplitude
  })
  it('rejects non-generic systems and missing initials explicitly', async () => {
    const bad = await executeSkill('ode.phase', { system: { kind: 'lv2' }, initialState: {}, tSpan: [0, 1] }, PLAN)
    expect(bad.status).toBe('error')
    const noInit = await executeSkill(
      'ode.phase',
      { system: { kind: 'generic2', states: ['x', 'y'], rhs: { x: 'y', y: '-x' } }, initialState: { x: 1 }, tSpan: [0, 1] },
      PLAN,
    )
    expect(noInit.status).toBe('error')
  })
})

describe('fit class — paper data pairs (#24)', () => {
  it('parseDataPairs reads numeric pairs from table items (and skips non-numeric lines)', () => {
    const pairs = parseDataPairs(FIT_DOC)
    expect(pairs).toEqual([
      [0, 1.98],
      [1, 1.21],
      [2, 0.74],
      [3, 0.45],
    ])
  })
  it('the fit binding carries the paper data — the second fit paper routes too', () => {
    const d = routeAdapter(FIT_DOC)
    expect(d.status).toBe('ok')
    if (d.status !== 'ok' || d.adapter !== 'formula') return
    expect(d.binding.kind).toBe('fit')
    expect(d.binding.dataPoints).toHaveLength(4)
    // a second fit paper: same class, DIFFERENT conditions (sine + its table)
    const d2 = routeAdapter(
      normalizeDocling({
        docId: 'fit2',
        title: 'Tuning fork envelope',
        pages: [{ page: 1, width: 612, height: 792 }],
        items: [
          { id: 't', kind: 'text', page: 1, bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.05 }, text: 'residual against the measured data' },
          { id: 'f', kind: 'formula', page: 1, bbox: { x: 0.3, y: 0.4, w: 0.4, h: 0.05 }, latex: 'y = a\\sin(b x)' },
          { id: 'tab', kind: 'table', page: 1, bbox: { x: 0.2, y: 0.6, w: 0.6, h: 0.2 }, text: '1 2\n3 4' },
        ],
      }),
    )
    expect(d2.status).toBe('ok')
    if (d2.status !== 'ok' || d2.adapter !== 'formula') return
    expect(d2.binding.kind).toBe('fit')
    expect(d2.binding.dataPoints).toEqual([[1, 2], [3, 4]])
  })
})
