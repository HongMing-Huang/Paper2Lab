import { describe, expect, it } from 'vitest'
import { planFormulaActions, planFormulaQuestion, validateFormulaActions } from './formulaPlan'
import { routeAdapter } from './adapterRouter'
import { detectOde } from './paperBinding'
import { normalizeDocling } from '../ingest/doclingSchema'

const doc = normalizeDocling({
  docId: 'd1',
  title: 'Harmonic Distortion Notes',
  pages: [{ page: 1, width: 612, height: 792 }],
  items: [
    { id: 'a', kind: 'text', page: 1, bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.05 }, text: 'plain text only' },
    { id: 'b', kind: 'formula', page: 1, bbox: { x: 0.3, y: 0.4, w: 0.4, h: 0.05 }, latex: 'y = a\\sin(bx)' },
  ],
})

const kakeyaDoc = normalizeDocling({
  docId: 'd2',
  title: 'Wang–Zahl: Kakeya sets in R3',
  pages: [{ page: 1, width: 612, height: 792 }],
  items: [
    { id: 'a', kind: 'text', page: 1, bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.05 }, text: 'Kakeya set and Besicovitch tubes' },
  ],
})

describe('routeAdapter (deterministic, #22 three-state machine)', () => {
  it('routes the harmonic paper to the formula adapter with a paper binding', () => {
    const d = routeAdapter(doc)
    expect(d.status).toBe('ok')
    if (d.status !== 'ok') return
    expect(d.adapter).toBe('formula')
    expect(d.keyFormula?.latex).toBe('y = a\\sin(bx)')
    expect(d.binding.kind).toBe('formula')
    expect(d.binding.anchors).toContain('b')
    expect(d.binding.objects.map((o) => o.manipulates[0]).sort()).toEqual(['a', 'b'])
    expect(d.binding.engine).toEqual({ skill: 'formula.plot', view: 'jsxgraph' })
  })
  it('routes Kakeya papers to the dedicated 3D adapter whose objects are tube clusters', () => {
    const d = routeAdapter(kakeyaDoc)
    expect(d.status).toBe('ok')
    if (d.status !== 'ok') return
    expect(d.adapter).toBe('kakeya')
    expect(d.binding.engine.view).toBe('kakeya-3d')
    expect(d.binding.objects[0].type).toBe('cluster')
    expect(d.binding.conditions.some((c) => c.kind === 'constraint' && c.description.includes('[0,1]³'))).toBe(true)
  })
  it('a paper with measured data gets the FIT binding (residual is an observable)', () => {
    const fitDoc = normalizeDocling({
      docId: 'd4',
      title: 'Damped Oscillator Measurements',
      pages: [{ page: 1, width: 612, height: 792 }],
      items: [
        { id: 'a', kind: 'text', page: 1, bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.05 }, text: 'we fit the model to measured data' },
        { id: 'b', kind: 'formula', page: 1, bbox: { x: 0.3, y: 0.4, w: 0.4, h: 0.05 }, latex: 'y = a e^{-bx}' },
      ],
    })
    const d = routeAdapter(fitDoc)
    expect(d.status).toBe('ok')
    if (d.status !== 'ok') return
    expect(d.binding.kind).toBe('fit')
    expect(d.binding.observables.some((o) => o.name.includes('残差'))).toBe(true)
    expect(d.binding.engine.view).toBe('jsxgraph-fit')
  })
  it('an ODE paper WITH initial conditions binds the phase-plane experiment to the paper values', () => {
    const odeDoc = normalizeDocling({
      docId: 'd5',
      title: 'Predator-prey dynamics',
      pages: [{ page: 1, width: 612, height: 792 }],
      items: [
        { id: 'a', kind: 'text', page: 1, bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.05 }, text: 'population dynamics with x(0) = 2 and y(0) = 0.5' },
        { id: 'b', kind: 'formula', page: 1, bbox: { x: 0.3, y: 0.4, w: 0.4, h: 0.05 }, latex: '\\dot{x} = x - xy' },
        { id: 'c', kind: 'formula', page: 1, bbox: { x: 0.3, y: 0.5, w: 0.4, h: 0.05 }, latex: '\\dot{y} = xy - y' },
      ],
    })
    const d = routeAdapter(odeDoc)
    expect(d.status).toBe('ok')
    if (d.status !== 'ok') return
    expect(d.adapter).toBe('ode')
    expect(d.keyFormula).toBeNull() // never re-skin an ODE paper as a formula demo
    const initial = d.binding.conditions.find((c) => c.kind === 'initial') as { values: Record<string, number> }
    expect(initial.values).toEqual({ x: 2, y: 0.5 })
    expect(d.binding.objects[0].type).toBe('initial-state')
    expect(d.binding.engine).toEqual({ skill: 'ode.solve', view: 'phase-plane-jsxgraph' })
    expect(d.binding.equations.map((e) => e.anchorId)).toEqual(['b', 'c'])
  })
  it('an ODE paper WITHOUT initial conditions → needs-info with concrete questions, not an invented demo', () => {
    const odeNoIc = normalizeDocling({
      docId: 'd6',
      title: 'Stability of the Lotka-Volterra system',
      pages: [{ page: 1, width: 612, height: 792 }],
      items: [
        { id: 'a', kind: 'text', page: 1, bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.05 }, text: 'we study stability of the equilibrium' },
        { id: 'b', kind: 'formula', page: 1, bbox: { x: 0.3, y: 0.4, w: 0.4, h: 0.05 }, latex: '\\frac{dx}{dt} = x(1-y)' },
      ],
    })
    const d = routeAdapter(odeNoIc)
    expect(d.status).toBe('needs-info')
    if (d.status !== 'needs-info') return
    expect(d.adapter).toBe('ode')
    expect(d.questions.length).toBeGreaterThan(0)
    expect(d.questions[0]).toMatch(/初值/)
  })
  it('a bare text paper is explicitly out-of-scope — no formula explorer is conjured', () => {
    const bare = normalizeDocling({
      docId: 'd3',
      title: 'Words',
      pages: [{ page: 1, width: 612, height: 792 }],
      items: [
        { id: 'a', kind: 'text', page: 1, bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.05 }, text: 'no math here' },
      ],
    })
    const d = routeAdapter(bare)
    expect(d.status).toBe('out-of-scope')
    if (d.status !== 'out-of-scope') return
    expect(d.adapter).toBe('none')
    expect(d.keyFormula).toBeNull()
    expect(d.reason).toMatch(/不套固定 Demo/)
  })
})

describe('PaperBinding builders (#22)', () => {
  it('detectOde extracts initials via x(0)= / y_0= / (t=0) forms', () => {
    const doc = normalizeDocling({
      docId: 'd7',
      title: 't',
      pages: [{ page: 1, width: 612, height: 792 }],
      items: [
        { id: 'a', kind: 'text', page: 1, bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.05 }, text: 'y_0 = 1.5 and x(t = 0) = -2' },
        { id: 'b', kind: 'formula', page: 1, bbox: { x: 0.3, y: 0.4, w: 0.4, h: 0.05 }, latex: '\\dot{y} = -y' },
      ],
    })
    const det = detectOde(doc)
    expect(det.isOde).toBe(true)
    expect(det.hasInitial).toBe(true)
    expect(det.initials).toEqual({ y: 1.5, x: -2 })
  })
  it('a dynamics keyword alone (no equations) is NOT an ODE paper', () => {
    const doc = normalizeDocling({
      docId: 'd8',
      title: '摆',
      pages: [{ page: 1, width: 612, height: 792 }],
      items: [
        { id: 'a', kind: 'text', page: 1, bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.05 }, text: '我们讨论摆的历史' },
      ],
    })
    expect(detectOde(doc).isOde).toBe(false)
  })
})

describe('planFormulaQuestion (NL → structured ops)', () => {
  const params = ['a', 'b']
  it('“如果 a 增大一倍会怎样？” → fork · scale a ×2 · rerun · compare', () => {
    expect(planFormulaQuestion('如果 a 增大一倍会怎样？', params)).toEqual([
      { op: 'fork' },
      { op: 'scale', param: 'a', value: 2 },
      { op: 'rerun' },
      { op: 'compare' },
    ])
  })
  it('halving and explicit set values map too', () => {
    expect(planFormulaQuestion('把 b 减少一半', params)).toEqual([
      { op: 'fork' },
      { op: 'scale', param: 'b', value: 0.5 },
      { op: 'rerun' },
      { op: 'compare' },
    ])
    expect(planFormulaQuestion('a 设为 3.5', params)).toEqual([
      { op: 'fork' },
      { op: 'set', param: 'a', value: 3.5 },
      { op: 'rerun' },
      { op: 'compare' },
    ])
  })
  it('returns null for chit-chat instead of inventing actions', () => {
    expect(planFormulaQuestion('这篇论文讲了什么？', params)).toBeNull()
  })
})

describe('validateFormulaActions (LLM gate)', () => {
  const params = ['a', 'b']
  it('accepts whitelisted ops and clamps scale factors', () => {
    const v = validateFormulaActions([{ op: 'scale', param: 'a', value: 99 }], params)
    expect(v).toEqual([{ op: 'scale', param: 'a', value: 10 }])
  })
  it('rejects unknown params, unknown ops, and non-object lists', () => {
    expect(validateFormulaActions([{ op: 'set', param: 'zzz', value: 1 }], params)).toBeNull()
    expect(validateFormulaActions([{ op: 'delete_everything' }], params)).toBeNull()
    expect(validateFormulaActions('nope', params)).toBeNull()
  })
  it('planFormulaActions falls back to the deterministic planner on LLM failure', async () => {
    const out = await planFormulaActions('如果 a 增大一倍会怎样？', params, async () => {
      throw new Error('llm down')
    })
    expect(out?.[0].op).toBe('fork')
  })
})
