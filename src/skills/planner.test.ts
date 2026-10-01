import { describe, expect, it } from 'vitest'
import { planExperiment } from './planner'
import { listSkills } from './types'
import './index'

const cur = { nTubes: 96, deltaExp: 4, packing: 0 }

/** planner always returns a plan (fallback = run an experiment, never text) */
const plan = (q: string) => planExperiment(q, cur)!

describe('planner (Scientific Skills Agent)', () => {
  it('halving directions yields the canonical 5-action flow', () => {
    const p = plan('如果方向数减少一半呢？')
    expect(p.title).toContain('96 → 48')
    expect(p.actions.map((a) => a.skill)).toEqual([
      'fork_experiment',
      'change_parameter',
      'run_scale_sweep',
      'compare_experiments',
      'explain_result',
    ])
    expect(p.actions[1].args).toMatchObject({ param: 'kakeya.nTubes', value: 48 })
  })

  it('doubling directions clamps to the slider max', () => {
    expect(plan('方向数加倍').actions[1].args).toMatchObject({ value: 192 })
  })

  it('δ halving increments the exponent', () => {
    expect(plan('把 δ 减半').actions[1].args).toMatchObject({ param: 'kakeya.deltaExp', value: 5 })
  })

  it('sticky question → packing=1 fork+compare plan', () => {
    const p = plan('sticky 全部过中心')
    expect(p.actions.some((a) => a.skill === 'change_parameter' && a.args.param === 'kakeya.packing')).toBe(true)
  })

  it('proof question → open_proof only (no experiment fabrication)', () => {
    expect(plan('这个定理的证明在哪').actions.map((a) => a.skill)).toEqual(['open_proof'])
  })

  it('unknown questions still get an experiment (never text-only)', () => {
    const p = plan('随便说点什么')
    expect(p.actions.length).toBeGreaterThan(1)
    expect(p.actions.some((a) => a.skill === 'change_parameter')).toBe(true)
  })

  it('every planned skill id is actually registered', () => {
    const ids = new Set(listSkills().map((s) => s.id))
    for (const p of ['方向减半', 'sticky', '证明', 'perron', '?'].map(plan)) {
      for (const a of p.actions) expect(ids.has(a.skill)).toBe(true)
    }
  })
})

describe('objective-named primitive skills', () => {
  it('registers generate_directions / generate_tubes / interpolate_packing', () => {
    const ids = new Set(listSkills().map((s) => s.id))
    for (const id of ['generate_directions', 'generate_tubes', 'interpolate_packing']) {
      expect(ids.has(id)).toBe(true)
    }
  })

  it('generate_directions reports deterministic separation', async () => {
    const { runSkill } = await import('./types')
    const out = await runSkill<{ minSepDeg: number }>('generate_directions', { n: 96 })
    expect(out.minSepDeg).toBeGreaterThan(8)
  })

  it('interpolate_packing classifies regime', async () => {
    const { runSkill } = await import('./types')
    const out = await runSkill<{ regime: string }>('interpolate_packing', { packing: 0.9 })
    expect(out.regime).toBe('sticky')
  })
})
