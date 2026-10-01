import { describe, expect, it } from 'vitest'
import { analyzeFormula } from './analyze'
import { compileFormula } from './compile'
import { buildExplorerSpec } from './spec'
import type { SourceAnchor } from './spec'

const anchor: SourceAnchor = {
  docId: 'test',
  page: 1,
  bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.05 },
  latex: 'y = a\\sin(bx)',
}

describe('analyzeFormula', () => {
  it('classifies y = a sin(bx): params a,b · independent x · output y', () => {
    const a = analyzeFormula('y = a\\sin(bx)')
    expect(a.ok).toBe(true)
    expect(a.independent).toBe('x')
    expect(a.output).toBe('y')
    expect(a.params.map((p) => p.name)).toEqual(['a', 'b'])
  })

  it('classifies u(t) = e^{-t} cos(ω t): independent t, one Greek param, trig domain', () => {
    const a = analyzeFormula('u(t) = e^{-t}\\cos(\\omega t)')
    expect(a.ok).toBe(true)
    expect(a.independent).toBe('t')
    expect(a.output).toBe('u')
    expect(a.params).toHaveLength(1)
    expect(a.domain[1]).toBeGreaterThan(6) // 2π-friendly window
  })

  it('handles bare expressions (no equal sign): x²+3x+1', () => {
    const a = analyzeFormula('x^2 + 3x + 1')
    expect(a.ok).toBe(true)
    expect(a.independent).toBe('x')
    expect(a.output).toBeNull()
    expect(a.params).toEqual([])
    expect(a.domain).toEqual([-5, 5])
  })

  it('rejects broken LaTeX without throwing', () => {
    const a = analyzeFormula('\\frac{1 +')
    expect(a.ok).toBe(false)
    expect(a.error).toBeTruthy()
  })

  it('rejects formulas with no plottable independent variable', () => {
    // a and b are both ambiguous — no x/t present and more than one free var
    const a = analyzeFormula('c = a + b')
    expect(a.ok).toBe(false)
  })
})

describe('compileFormula (Cortex → JavaScript)', () => {
  it('compiles y = a sin(bx) and computes 2·sin(4.5) exactly at a=2,b=3,x=1.5', () => {
    const a = analyzeFormula('y = a\\sin(bx)')
    expect(a.ok).toBe(true)
    const c = compileFormula(a.rhs)
    expect(c).not.toBeNull()
    expect(c!.success).toBe(true)
    expect(c!.run({ a: 2, b: 3, x: 1.5 })).toBeCloseTo(2 * Math.sin(4.5), 12)
    // sine range check at the classic point: a=1,b=1,x=π/2 → sin(π/2)=1
    expect(c!.run({ a: 1, b: 1, x: Math.PI / 2 })).toBeCloseTo(1, 12)
  })

  it('compiled source references the free symbols (evidence the code is real)', () => {
    const a = analyzeFormula('y = a\\sin(bx)')
    const c = compileFormula(a.rhs)!
    expect(c.code.length).toBeGreaterThan(0)
    expect(c.freeSymbols).toContain('a')
    expect(c.freeSymbols).toContain('x')
  })

  it('compiles the damped oscillation formula and matches e^{-t}cos(ωt)', () => {
    const a = analyzeFormula('u(t) = e^{-t}\\cos(\\omega t)')
    const c = compileFormula(a.rhs)!
    const omegaName = a.params[0].name
    const t = 0.7
    const w = 2.5
    expect(c.run({ t, [omegaName]: w })).toBeCloseTo(Math.exp(-t) * Math.cos(w * t), 10)
  })
})

describe('buildExplorerSpec', () => {
  it('emits the declarative formula-module config (type/expression/params/renderer)', () => {
    const a = analyzeFormula('y = a\\sin(bx)')
    const { spec, compiled } = buildExplorerSpec(a, anchor)
    expect(spec.type).toBe('formula')
    expect(spec.renderer).toBe('jsxgraph')
    expect(spec.parameters.map((p) => p.name)).toEqual(['a', 'b'])
    expect(spec.independent.name).toBe('x')
    expect(spec.anchor.docId).toBe('test')
    expect(compiled).not.toBeNull()
  })
})

describe('raw Docling output', () => {
  it('parses the real fixture formulas verbatim (spacing + trailing period)', async () => {
    const fixture = (await import('../ingest/fixtures/sample-harmonic.docling.json')).default
    const formulas = fixture.items.filter((i: { kind: string }) => i.kind === 'formula')
    expect(formulas.length).toBeGreaterThanOrEqual(2)
    const sine = analyzeFormula(formulas[0].latex as string)
    expect(sine.ok).toBe(true)
    expect(sine.independent).toBe('x')
    expect(sine.params.map((p) => p.name)).toEqual(['a', 'b'])
    const c = compileFormula(sine.rhs)
    expect(c!.run({ a: 2, b: 3, x: 1.5 })).toBeCloseTo(2 * Math.sin(4.5), 12)
    const damped = analyzeFormula(formulas[1].latex as string)
    expect(damped.ok).toBe(true)
    expect(damped.independent).toBe('t')
  })
})
