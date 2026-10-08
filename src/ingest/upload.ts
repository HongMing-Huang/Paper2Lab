// Upload client for the async ingestion protocol (server/main.py):
//   POST /api/ingest            → 202 {jobId, status:'queued'}
//   GET  /api/ingest/{jobId}    → {status: queued|running|done|timeout|error,
//                                 stage: warming|parsing|null,
//                                 elapsedMs, queueDepth, document?}
// Polls until the job settles and reports LIVE stage/elapsed/queue to the
// caller (#15 UX — a static spinner for 20-60s reads as "stuck"). Errors stay
// distinguishable: transport failure ≠ parse failure ≠ timeout ≠ lost job.
import { normalizeDocling, type IngestedDoc } from './doclingSchema'

const POLL_INTERVAL_MS = 1000
const POLL_TIMEOUT_MS = 10 * 60 * 1000

export interface IngestProgress {
  status: string
  /** warming (model load) | parsing | null (not yet running) */
  stage: string | null
  elapsedMs: number
  queueDepth: number
}

export async function ingestPdf(
  file: File,
  opts: { onProgress?: (p: IngestProgress) => void; attempts?: number } = {},
): Promise<IngestedDoc> {
  const attempts = opts.attempts ?? 3
  const body = new FormData()
  body.append('file', file, file.name)
  let lastErr: unknown = null

  for (let i = 0; i < attempts; i++) {
    let jobId: string | null = null
    try {
      const res = await fetch('/api/ingest', { method: 'POST', body })
      if (res.status === 202) {
        const j = (await res.json()) as { jobId: string }
        jobId = j.jobId
        // poll OUTSIDE the retry loop: a poll transport failure must NOT
        // re-upload the whole PDF (the old code retried the POST on a dead
        // backend mid-parse, restarting the job up to 3 times)
        return await pollJob(j.jobId, opts.onProgress)
      }
      // 4xx/5xx from the gate itself (415/413/422) — do not blind-retry those
      const detail = await res.text().catch(() => '')
      throw new Error(`ingest failed (${res.status}): ${detail.slice(0, 300)}`)
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('ingest failed')) throw err
      lastErr = err
      void jobId
      // transport-level failure on the POST (backend cold start) — backoff
      await new Promise((r) => setTimeout(r, 3500))
    }
  }
  throw new Error(
    lastErr instanceof Error && lastErr.message.startsWith('ingest failed')
      ? lastErr.message
      : 'Docling 服务未启动 — 请先运行: server/.venv/bin/uvicorn server.main:app --port 8787',
  )
}

async function pollJob(jobId: string, onProgress?: (p: IngestProgress) => void): Promise<IngestedDoc> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let consecutiveTransportFails = 0
  while (Date.now() < deadline) {
    let res: Response
    try {
      res = await fetch(`/api/ingest/${encodeURIComponent(jobId)}`)
      consecutiveTransportFails = 0
    } catch {
      // backend gone mid-parse (restarted / reaped): a few grace retries for a
      // restart window, then surface — never a silent infinite spinner
      consecutiveTransportFails++
      if (consecutiveTransportFails > 5) {
        throw new Error('ingest failed (backend): 解析期间后端不可达（可能已重启）— 请重试')
      }
      await new Promise((r) => setTimeout(r, 2000))
      continue
    }
    if (res.status === 404) {
      throw new Error('ingest failed (lost): 解析任务已丢失（后端已重启）— 请重新上传')
    }
    if (!res.ok) throw new Error(`ingest failed (${res.status}): job query failed`)
    const body = (await res.json()) as {
      status: string
      stage?: string | null
      elapsedMs?: number
      queueDepth?: number
      error?: string
      document?: unknown
    }
    onProgress?.({
      status: body.status,
      stage: body.stage ?? null,
      elapsedMs: body.elapsedMs ?? 0,
      queueDepth: body.queueDepth ?? 0,
    })
    if (body.status === 'done' && body.document) return normalizeDocling(body.document)
    if (body.status === 'error') throw new Error(`ingest failed (parse): ${body.error ?? 'unknown parser error'}`)
    if (body.status === 'timeout') throw new Error(`ingest failed (timeout): ${body.error ?? '解析超时，已被终止'}`)
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  throw new Error(`ingest failed (timeout): docling did not finish job ${jobId}`)
}
