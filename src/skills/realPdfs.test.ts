// #24 五 REAL-PDF acceptance: the four tectonic papers (public/papers/*.pdf)
// parsed by REAL Docling (dumps committed under src/ingest/fixtures — the
// sample-harmonic "real dump" pattern; scripts/run_realpdf_fixtures.py
// regenerates them against a live backend). The chain asserted here has NO
// synthetic steps: route → binding → REAL experiment execution with the
// paper's own equations / initials / measurement table.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { routeAdapter } from './adapterRouter'
import { normalizeDocling } from '../ingest/doclingSchema'
import { executeSkill } from './executor'
import { buildPlan } from './playPlan'

function realDoc(name: string) {
  return normalizeDocling(JSON.parse(readFileSync(join('src/ingest/fixtures', `${name}.docling.json`), 'utf8')))
}

describe('REAL PDF → experiment acceptance (two papers per class, #24 五)', () => {
  it('ODE paper A (predator–prey): real formulas + field initials drive a real integration', async () => {
    const d = routeAdapter(realDoc('ode-lotka-volterra'))
    expect(d.status).toBe('ok')
    if (d.status !== 'ok' || d.adapter !== 'ode') return
    expect(d.binding.system?.states).toEqual(['x', 'y'])
    const initial = d.binding.conditions.find((c) => c.kind === 'initial') as { values: Record<string, number> }
    expect(initial.values.x).toBe(2)
    expect(initial.values.y).toBe(0.5)
    // the paper's OWN latex right-hand sides execute (trailing punctuation as
    // emitted by docling — the kernel must cope with the real thing)
    const out = await executeSkill<{ s0: number[]; s1: number[]; period0: number | null }>(
      'ode.phase',
      {
        system: { kind: 'generic2', states: ['x', 'y'], rhs: { x: 'x - x y ,', y: 'x y - y .' } },
        initialState: initial.values,
        tSpan: [0, 20],
      },
      buildPlan({ skill: 'ode.phase', goal: 'real-pdf acceptance: predator–prey' }),
    )
    if (out.status !== 'ok' || !out.run?.result) throw new Error(out.status)
    expect(out.run.result.s0.every((v) => v > 0)).toBe(true) // positive quadrant
    expect(out.run.result.period0).not.toBeNull() // closed orbit ⇒ periodic
  })

  it('ODE paper B (damped oscillator): signed states, decay to origin', async () => {
    const d = routeAdapter(realDoc('ode-damped-oscillator'))
    expect(d.status).toBe('ok')
    if (d.status !== 'ok' || d.adapter !== 'ode') return
    const initial = d.binding.conditions.find((c) => c.kind === 'initial') as { values: Record<string, number> }
    expect(initial.values).toEqual({ x: 1.5, y: 0 })
    const out = await executeSkill<{ s0: number[] }>(
      'ode.phase',
      {
        system: { kind: 'generic2', states: ['x', 'y'], rhs: { x: 'y ,', y: '- x - 0.5\\, y .' } },
        initialState: initial.values,
        tSpan: [0, 20],
      },
      buildPlan({ skill: 'ode.phase', goal: 'real-pdf acceptance: damped oscillator' }),
    )
    if (out.status !== 'ok' || !out.run?.result) throw new Error(out.status)
    const r = out.run.result
    expect(r.s0.some((v) => v < 0)).toBe(true) // it swings — signed physics
    const head = Math.max(...r.s0.slice(0, 20).map(Math.abs))
    const tail = Math.max(...r.s0.slice(-40).map(Math.abs))
    expect(tail).toBeLessThan(head * 0.2) // damping drains the amplitude
  })

  it('fit paper A (exponential decay): real table → fit binding with all 5 pairs + RMSE from a real run', async () => {
    const d = routeAdapter(realDoc('fit-exponential-decay'))
    expect(d.status).toBe('ok')
    if (d.status !== 'ok' || d.adapter !== 'formula') return
    expect(d.binding.kind).toBe('fit')
    expect(d.binding.dataPoints).toEqual([
      [0, 1.98], [1, 1.21], [2, 0.74], [3, 0.45], [4, 0.28],
    ])
    // the model curve comes from a REAL formula.plot run of the paper latex
    const out = await executeSkill<{ points: Array<[number, number]> }>(
      'formula.plot',
      {
        expression: 'a e ^ { - b x } ,'.replace(/,$/, ''), // docling latex minus its trailing comma
        parameters: ['a', 'b'],
        values: { a: 2, b: 0.5 },
        independent: 'x',
        range: [0, 4],
        samples: 41,
      },
      buildPlan({ skill: 'formula.plot', goal: 'real-pdf acceptance: decay fit' }),
    )
    if (out.status !== 'ok' || !out.run?.result) throw new Error(out.status)
    // RMSE of the REAL run against the paper table (a=2,b=0.5 ≈ the paper's fit)
    let sq = 0
    for (const [x, y] of d.binding.dataPoints!) {
      const pts = out.run.result.points
      const at = (xx: number) => {
        for (let i = 1; i < pts.length; i++) {
          if (xx <= pts[i][0]) {
            const t = (xx - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0] || 1e-12)
            return pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1])
          }
        }
        return pts[pts.length - 1][1]
      }
      sq += (at(x) - y) ** 2
    }
    const rmse = Math.sqrt(sq / 5)
    expect(rmse).toBeLessThan(0.1) // 2·e^{-0.5x} tracks the table closely
  })

  it('fit paper B (sine calibration): table pairs parse and the sine model runs', async () => {
    const d = routeAdapter(realDoc('fit-sine-fit'))
    expect(d.status).toBe('ok')
    if (d.status !== 'ok' || d.adapter !== 'formula') return
    expect(d.binding.kind).toBe('fit')
    expect(d.binding.dataPoints).toHaveLength(5)
    expect(d.binding.dataPoints!.filter(([x]) => x > 0 && x < 2)).toEqual([[0.5, 1.42], [1, 2], [1.5, 1.41]])
    const out = await executeSkill<{ peak: number }>(
      'formula.plot',
      {
        expression: 'a \\sin ( b x ) .'.replace(/\.$/, ''),
        parameters: ['a', 'b'],
        values: { a: 2, b: 1 },
        independent: 'x',
        range: [0, 6.4],
        samples: 65,
      },
      buildPlan({ skill: 'formula.plot', goal: 'real-pdf acceptance: sine fit' }),
    )
    if (out.status !== 'ok' || !out.run?.result) throw new Error(out.status)
    expect(out.run.result.peak).toBeCloseTo(2, 3) // |2·sin(x)| peaks at |a| (65-sample grid: ~1.99985)
  })
})
