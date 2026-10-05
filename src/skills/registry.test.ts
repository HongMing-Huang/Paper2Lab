import { describe, expect, it } from 'vitest'
import { SKILL_REGISTRY, getSkill, validateSkillInput } from './registry'

describe('Scientific Skill Registry', () => {
  it('declares exactly the 0.1 skill set', () => {
    const names = SKILL_REGISTRY.map((s) => s.name).sort()
    expect(names).toEqual(
      [
        'experiment.compare',
        'experiment.fork',
        'formula.evaluate',
        'formula.plot',
        'geometry.2d',
        'mujoco.simulate',
        'kakeya.generate',
        'kakeya.measure',
        'kakeya.sweep',
        'ode.solve',
        'paper.trace-source',
      ].sort(),
    )
  })

  it('every skill fully declares its contract (FAROS WorkflowNode shape)', () => {
    for (const s of SKILL_REGISTRY) {
      expect(s.description.length, s.name).toBeGreaterThan(10)
      expect(s.inputSchema).toHaveProperty('type', 'object')
      expect(s.outputSchema).toHaveProperty('type')
      expect(['cortex-js', 'observable-cells', 'kakeya-worker', 'pyodide', 'wasm', 'canvas']).toContain(s.runtime)
      expect(['jsxgraph', 'r3f', 'plot', 'none', 'canvas']).toContain(s.renderer)
      expect(typeof s.deterministic).toBe('boolean')
      expect(s.version).toMatch(/@/)
      expect(['CALCULATED', 'AI_INFERENCE', 'PAPER']).toContain(s.evidence)
    }
  })

  it('numeric skills pin an ExperimentRun kind', () => {
    for (const name of ['formula.plot', 'formula.evaluate', 'kakeya.measure', 'kakeya.sweep', 'kakeya.generate']) {
      expect(getSkill(name)?.runKind, name).toBeTruthy()
    }
  })

  it('validateSkillInput enforces schema presence', () => {
    expect(
      validateSkillInput('formula.plot', {
        expression: ['Add', 1, 2],
        parameters: ['a'],
        independent: 'x',
        range: [-5, 5],
      }).ok,
    ).toBe(true)
    expect(validateSkillInput('formula.plot', { parameters: ['a'] }).ok).toBe(false)
    expect(validateSkillInput('not.a.skill', {}).ok).toBe(false)
    expect(validateSkillInput('paper.trace-source', { anchorId: 'p1-i7' }).ok).toBe(true)
  })
})

it('rejects schema type, enum, and range-length violations', () => {
  expect(validateSkillInput('kakeya.measure', { deltaExp: 4, nTubes: 4.5, packing: NaN }).ok).toBe(false)
  expect(validateSkillInput('kakeya.sweep', { param: 'fake', values: [1] }).ok).toBe(false)
  expect(validateSkillInput('formula.plot', { expression: ['Sin', 'x'], parameters: ['a'], independent: 'x', range: [0] }).ok).toBe(false)
})
