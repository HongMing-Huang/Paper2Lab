// Upload client for the async ingestion protocol (server/main.py):
//   POST /api/ingest            → 202 {jobId, status:'running'}
//   GET  /api/ingest/{jobId}    → {status: running|done|error, document?}
// Polls until the job settles; surfaced errors stay distinguishable
// (transport failure ≠ parse failure ≠ timeout).
import { normalizeDocling, type IngestedDoc } from './doclingSchema'

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 10 * 60 * 1000

export async function ingestPdf(file: File, attempts = 3): Promise<IngestedDoc> {
  const body = new FormData()
  body.append('file', file, file.name)
  let lastErr: unknown = null

  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch('/api/ingest', { method: 'POST', body })
      if (res.status === 202) {
        const { jobId } = (await res.json()) as { jobId: string }
        return await pollJob(jobId)
      }
      // 4xx/5xx from the gate itself (415/413/422) — do not blind-retry those
      const detail = await res.text().catch(() => '')
      throw new Error(`ingest failed (${res.status}): ${detail.slice(0, 300)}`)
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('ingest failed')) throw err
      lastErr = err
      // transport-level failure (backend cold start / restart window) — backoff
      await new Promise((r) => setTimeout(r, 3500))
    }
  }
  throw new Error(
    lastErr instanceof Error && lastErr.message.startsWith('ingest failed')
      ? lastErr.message
      : 'Docling 服务未启动 — 请先运行: server/.venv/bin/uvicorn server.main:app --port 8787',
  )
}

async function pollJob(jobId: string): Promise<IngestedDoc> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    const res = await fetch(`/api/ingest/${jobId}`)
    if (!res.ok) throw new Error(`ingest failed (${res.status}): job query failed`)
    const body = (await res.json()) as {
      status: 'running' | 'done' | 'error' | string
      error?: string
      document?: unknown
    }
    if (body.status === 'done' && body.document) return normalizeDocling(body.document)
    if (body.status === 'error') throw new Error(`ingest failed (parse): ${body.error ?? 'unknown parser error'}`)
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  throw new Error(`ingest failed (timeout): docling did not finish job ${jobId}`)
}
