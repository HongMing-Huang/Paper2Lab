import { describe, expect, it } from 'vitest'
import { analyzeFormula } from '../formula/analyze'
import { getSkill } from './registry'
import { buildFormulaPlayPlan, buildKakeyaPlayPlan } from './playPlan'

const anchor = {
  docId: 'doc-test',
  page: 1,
  bbox: { x: 0.3, y: 0.4, w: 0.4, h: 0.06 },
  latex: 'y = a\\sin(bx)',
}

describe('PlayPlan (experiment contract)', () => {
  it('formula plan: variables classified, limits and non-claims pinned', () => {
    const a = analyzeFormula('y = a\\sin(bx)')
    const plan = buildFormulaPlayPlan(a, anchor, 'Test Paper', getSkill('formula.plot')!)
    expect(plan.skill).toBe('formula.plot')
    expect(plan.renderer).toBe('jsxgraph')
    const roles = Object.fromEntries(plan.variables.map((v) => [v.name, v.role]))
    expect(roles.a).toBe('parameter')
    expect(roles.b).toBe('parameter')
    expect(roles.x).toBe('independent')
    expect(roles.y).toBe('output')
    expect(plan.metrics).toContain('peak')
    expect(plan.nonClaims.join()).toContain('不得声称证明')
    expect(plan.inputs).toHaveProperty('expression')
    expect(plan.planId).toMatch(/^plan-/)
  })

  it('kakeya plan: finite-scale evidence basis, three frozen inputs', () => {
    const plan = buildKakeyaPlayPlan(
      { deltaExp: 4, nTubes: 96, packing: 0 },
      'Wang–Zahl',
      getSkill('kakeya.measure')!,
    )
    expect(plan.skill).toBe('kakeya.measure')
    expect(plan.renderer).toBe('r3f')
    expect(plan.metrics).toEqual(['occupiedCells', 'unionVolume', 'multiplicity'])
    expect(plan.inputs).toEqual({ deltaExp: 4, nTubes: 96, packing: 0, res: 48 })
    expect(plan.evidenceBasis).toContain('CALCULATED')
  })
})
