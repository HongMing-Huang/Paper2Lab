// Optional Pyodide runtime: CDN-loaded (official bundler recommendation —
// npm-bundled pyodide breaks loadPackage('numpy') under Vite; verified by
// studying the cloned eqs/pyodide-vite repo, see AGENTS.md §2.7).
// Lazily boots on first message; failures surface as { error } so the skill
// can degrade to `available: false` instead of crashing the desk.
const PYODIDE_VERSION = '0.27.7'
const BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

let ready: Promise<PyodideInterface> | null = null

interface PyodideInterface {
  loadPackagesFromImports(code: string): Promise<void>
  runPythonAsync(code: string): Promise<unknown>
}

function boot(): Promise<PyodideInterface> {
  ready ??= (async () => {
    const mod = (await import(/* @vite-ignore */ `${BASE}pyodide.mjs`)) as {
      loadPyodide: (opts: { indexURL: string }) => Promise<PyodideInterface>
    }
    return mod.loadPyodide({ indexURL: BASE })
  })()
  return ready
}

self.onmessage = async (e: MessageEvent<{ id: number; python: string }>) => {
  const { id, python } = e.data
  try {
    const py = await boot()
    await py.loadPackagesFromImports(python)
    const result = await py.runPythonAsync(python)
    ;(self as unknown as Worker).postMessage({ id, result })
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: String((err as Error)?.message ?? err) })
  }
}
