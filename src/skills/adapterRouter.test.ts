import { describe, expect, it } from 'vitest'
import { planFormulaActions, planFormulaQuestion, validateFormulaActions } from './formulaPlan'
import { routeAdapter } from './adapterRouter'
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

describe('routeAdapter (deterministic)', () => {
  it('routes the harmonic paper to the formula adapter with the sine formula', () => {
    const d = routeAdapter(doc)
    expect(d.adapter).toBe('formula')
    expect(d.keyFormula?.latex).toBe('y = a\\sin(bx)')
  })
  it('routes Kakeya papers to the dedicated 3D adapter', () => {
    expect(routeAdapter(kakeyaDoc).adapter).toBe('kakeya')
  })
  it('returns keyFormula null when nothing is plottable', () => {
    const bare = normalizeDocling({
      docId: 'd3',
      title: 'Words',
      pages: [{ page: 1, width: 612, height: 792 }],
      items: [
        { id: 'a', kind: 'text', page: 1, bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.05 }, text: 'no math here' },
      ],
    })
    expect(routeAdapter(bare).keyFormula).toBeNull()
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
