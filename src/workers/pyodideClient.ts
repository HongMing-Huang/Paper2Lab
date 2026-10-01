// Promise client for the optional Pyodide worker. Python snippets must end
// with a json.dumps(...) expression; the client parses it back to JS values.
let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./pyodide.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
    const p = pending.get(e.data.id)
    if (!p) return
    pending.delete(e.data.id)
    if (e.data.error) p.reject(new Error(e.data.error))
    else p.resolve(e.data.result)
  }
  worker.onerror = (e) => {
    for (const [, p] of pending) p.reject(new Error(String(e.message ?? 'pyodide worker failed')))
    pending.clear()
  }
  return worker
}

export function isPyodideWorkerAvailable(): boolean {
  return typeof Worker !== 'undefined'
}

/** run python returning json.dumps(...) output; 90s timeout */
export async function runPythonJson(python: string, timeoutMs = 90_000): Promise<unknown> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('pyodide timeout'))
    }, timeoutMs)
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer)
        try {
          resolve(typeof v === 'string' ? JSON.parse(v) : v)
        } catch {
          resolve(v)
        }
      },
      reject: (e) => {
        clearTimeout(timer)
        reject(e)
      },
    })
    getWorker().postMessage({ id, python })
  })
}
