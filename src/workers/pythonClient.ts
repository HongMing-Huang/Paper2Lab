// Comlink client for PythonScientificRuntime. Not on the Kakeya path —
// imported lazily only when a python-based skill/paper needs it.
import * as Comlink from 'comlink'
import type { PythonCapabilities, PythonWorkerApi } from './python.worker'

let remote: Comlink.Remote<PythonWorkerApi> | null = null

function getRemote(): Comlink.Remote<PythonWorkerApi> {
  if (remote) return remote
  const worker = new Worker(new URL('./python.worker.ts', import.meta.url), { type: 'module' })
  remote = Comlink.wrap<PythonWorkerApi>(worker)
  return remote
}

export async function ensurePythonRuntime(): Promise<PythonCapabilities> {
  if (typeof Worker === 'undefined') {
    return { available: false, numpy: false, scipy: false, version: '', reason: 'no Worker in this environment' }
  }
  return getRemote().ensureRuntime()
}

export function getPythonRuntime(): Comlink.Remote<PythonWorkerApi> {
  return getRemote()
}
