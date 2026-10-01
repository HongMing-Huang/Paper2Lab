// Second-paper demo: Lotka–Volterra ODE through PythonScientificRuntime
// (Parameter → Pyodide → scipy.solve_ivp → Result → Chart, per AGENTS.md §3).
// Fully lazy: the Pyodide worker boots only when this cell first runs, so the
// Kakeya demo path is never slowed. Cells live on the SAME shared runtime
// (one Reactive Research Runtime for the whole desk — no per-paper state copy).
import { kakeya } from './kakeyaGraph'
import { getPythonRuntime } from '../workers/pythonClient'

export const pAlpha = kakeya.param('lv.alpha', 1.1) // prey growth
export const pBeta = kakeya.param('lv.beta', 0.4) // predation rate
export const pGamma = kakeya.param('lv.gamma', 0.4) // predator death
export const pDelta = kakeya.param('lv.delta', 0.1) // predator growth

export interface OdePoint {
  t: number
  v: number
  series: string
}

/** scipy.integrate.solve_ivp solution — CALCULATED, runtime: pyodide-worker */
export const solutionCell = kakeya.asyncDerive<OdePoint[]>(
  'lv.solution',
  [pAlpha, pBeta, pGamma, pDelta],
  async ([a, b, c, d]) => {
    const rhs = [
      `a, b, c, d = ${a}, ${b}, ${c}, ${d}`,
      'def f(t, y):',
      '    return [a*y[0] - b*y[0]*y[1], -c*y[1] + d*y[0]*y[1]]',
    ].join('\n')
    const out = (await getPythonRuntime().solveIVP({
      t0: 0,
      t1: 30,
      y0: [1.0, 0.5],
      rhs,
      steps: 240,
    })) as { t: number[]; y: number[][] }
    const points: OdePoint[] = []
    for (let i = 0; i < out.t.length; i++) {
      points.push({ t: out.t[i], v: out.y[0][i], series: '猎物 x（prey）' })
      points.push({ t: out.t[i], v: out.y[1][i], series: '捕食者 y（predator）' })
    }
    return points
  },
  { debounceMs: 300 },
)
