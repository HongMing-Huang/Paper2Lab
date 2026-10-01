// PythonScientificRuntime — generic Pyodide-backed runtime for the NEXT
// papers (ODE / statistics / optimization). Interface-first (AGENTS.md §3):
// never used by the Kakeya demo path. Loads numpy/scipy lazily from CDN.
import * as Comlink from 'comlink'

const PYODIDE_VERSION = '0.27.7'
const BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

interface PyodideInterface {
  loadPackage(names: string | string[]): Promise<void>
  runPythonAsync(code: string): Promise<unknown>
}

let ready: Promise<PyodideInterface> | null = null

function boot(): Promise<PyodideInterface> {
  ready ??= (async () => {
    const mod = (await import(/* @vite-ignore */ `${BASE}pyodide.mjs`)) as {
      loadPyodide: (opts: { indexURL: string }) => Promise<PyodideInterface>
    }
    const py = await mod.loadPyodide({ indexURL: BASE })
    await py.loadPackage(['numpy'])
    return py
  })()
  return ready
}

export interface PythonCapabilities {
  available: boolean
  numpy: boolean
  scipy: boolean
  version: string
  reason?: string
}

const api = {
  /** probe the runtime: loads pyodide + numpy (scipy probed lazily) */
  async ensureRuntime(): Promise<PythonCapabilities> {
    try {
      const py = await boot()
      await py.runPythonAsync('import numpy as np')
      let scipy = false
      try {
        await py.loadPackage('scipy')
        await py.runPythonAsync('import scipy')
        scipy = true
      } catch {
        scipy = false
      }
      const version = String(await py.runPythonAsync('import sys; sys.version.split()[0]'))
      return { available: true, numpy: true, scipy, version }
    } catch (err) {
      return {
        available: false,
        numpy: false,
        scipy: false,
        version: '',
        reason: String((err as Error)?.message ?? err).slice(0, 160),
      }
    }
  },

  /** run python that ends with a json.dumps(...) expression */
  async runPythonJson(python: string): Promise<unknown> {
    const py = await boot()
    const out = await py.runPythonAsync(python)
    return typeof out === 'string' ? JSON.parse(out) : out
  },

  /**
   * future-paper interface sketch: ODE via scipy.integrate.solve_ivp.
   * funJson: { t0, t1, y0: number[], rhs: "def f(t, y): ..." python source }
   */
  async solveIVP(req: { t0: number; t1: number; y0: number[]; rhs: string; steps?: number }): Promise<unknown> {
    const py = await boot()
    await py.loadPackage('scipy')
    await py.runPythonAsync(req.rhs)
    const code = [
      'import numpy as np, json',
      'from scipy.integrate import solve_ivp',
      `sol = solve_ivp(f, (${req.t0}, ${req.t1}), ${JSON.stringify(req.y0)}, t_eval=np.linspace(${req.t0}, ${req.t1}, ${req.steps ?? 200}), rtol=1e-8, atol=1e-10)`,
      'json.dumps({"t": sol.t.tolist(), "y": sol.y.tolist()})',
    ].join('\n')
    const out = await py.runPythonAsync(code)
    return typeof out === 'string' ? JSON.parse(out) : out
  },
}

export type PythonWorkerApi = typeof api

Comlink.expose(api)
