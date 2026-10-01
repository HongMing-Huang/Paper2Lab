// Upload client: POST the PDF to the Docling backend, normalize the response.
// Dev wiring: vite proxies /api → http://127.0.0.1:8787 (server/main.py).
import { normalizeDocling, type IngestedDoc } from './doclingSchema'

export async function ingestPdf(file: File, attempts = 3): Promise<IngestedDoc> {
  const body = new FormData()
  body.append('file', file, file.name)
  let lastErr: unknown = null
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch('/api/ingest', { method: 'POST', body })
      if (res.ok) return normalizeDocling(await res.json())
      const detail = await res.text().catch(() => '')
      throw new Error(`ingest failed (${res.status}): ${detail.slice(0, 300)}`)
    } catch (err) {
      lastErr = err
      // backend cold-start / restart window — retry with backoff
      await new Promise((r) => setTimeout(r, 3500))
    }
  }
  throw new Error(
    lastErr instanceof Error && lastErr.message.startsWith('ingest failed')
      ? lastErr.message
      : 'Docling 服务未启动 — 请先运行: server/.venv/bin/uvicorn server.main:app --port 8787',
  )
}
