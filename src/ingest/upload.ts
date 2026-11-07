// Upload client for the async ingestion protocol (server/main.py):
//   POST /api/ingest            → 202 {jobId, status:'queued'}
//   GET  /api/ingest/{jobId}    → {status: queued|running|done|timeout|error,
//                                 stage: warming|parsing|null,
//                                 elapsedMs, queueDepth, document?}
// Polls until the job settles and reports LIVE stage/elapsed/queue to the
// caller (#15 UX — a static spinner for 20-60s reads as "stuck"). Errors stay
// distinguishable: transport failure ≠ parse failure ≠ timeout ≠ lost job.
import { normalizeDocling, type IngestedDoc } from './doclingSchema'
import { authHeaders } from './apiAuth'

const POLL_INTERVAL_MS = 1000
const POLL_TIMEOUT_MS = 10 * 60 * 1000
/** abort signals let a caller STOP polling when its view unmounts (a zombie
 *  poller would otherwise supersede-fight the user's next same-page parse) */

/** per-tab identity (survives refresh, cleared per new tab): lets a retried
 * upload SUPERSEDE this tab's stale job server-side (#15 latest-wins) and
 * lets the page reattach to the in-flight job after a refresh */
export function ingestClientId(): string {
  try {
    let id = sessionStorage.getItem('p2l-ingest-client')
    if (!id) {
      id = `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      sessionStorage.setItem('p2l-ingest-client', id)
    }
    return id
  } catch {
    return 'c-ephemeral'
  }
}

/** remember the latest job so a refresh can REATTACH to it (latest task
 * follows the user) instead of silently starting from scratch */
export function rememberLastJob(jobId: string, filename: string): void {
  try {
    sessionStorage.setItem('p2l-last-ingest', JSON.stringify({ jobId, filename }))
  } catch { /* private mode */ }
}
export function clearLastJob(): void {
  try {
    sessionStorage.removeItem('p2l-last-ingest')
  } catch { /* private mode */ }
}
export function lastJob(): { jobId: string; filename: string } | null {
  try {
    const raw = sessionStorage.getItem('p2l-last-ingest')
    return raw ? (JSON.parse(raw) as { jobId: string; filename: string }) : null
  } catch {
    return null
  }
}

export interface IngestProgress {
  status: string
  /** warming (model load) | parsing | vlm-reading | null (not yet running) */
  stage: string | null
  elapsedMs: number
  queueDepth: number
  /** CLI-151 progressive fragments: pages the VLM path has ALREADY read
   *  while the parse is still running (out of page order → sorted by the
   *  server). Empty for the docling path — no page-level progress exists
   *  there, shown honestly rather than fabricated. */
  partial?: IngestFragment[]
}

/** one already-extracted page fragment (raw preview; ids/anchors are only
 *  assigned in the final assembled document, so these carry no item id) */
export interface IngestFragment {
  page: number
  kind: 'text' | 'formula' | 'table' | string
  latex?: string
  text?: string
}

/** parse engine: 'docling' 精读定位 (char-precise anchors) | 'vlm' 快速理解
 * (the provider's native multimodal model reads rendered pages — seconds
 * instead of tens of seconds; page-scope anchors, AI-assisted extraction) */
export type IngestMode = 'docling' | 'vlm'

export async function ingestPdf(
  file: File,
  opts: {
    onProgress?: (p: IngestProgress) => void
    attempts?: number
    mode?: IngestMode
    /** CLI-151: the job id as soon as the upload is accepted */
    onJobId?: (jobId: string) => void
    /** CLI-151: parse only these inclusive 1-based pages (on-demand 精读) */
    pages?: [number, number]
    /** latest-wins scope: a newer upload with the SAME client id supersedes
     *  this job. Page reads pass a per-page id so pages never cancel each
     *  other, only a re-read of the same page does. */
    clientId?: string
    /** remember for refresh-reattach on the home page (default true) */
    remember?: boolean
    /** stop polling when aborted (the parse keeps running server-side) */
    signal?: AbortSignal
  } = {},
): Promise<IngestedDoc> {
  const attempts = opts.attempts ?? 3
  const body = new FormData()
  body.append('file', file, file.name)
  body.append('clientId', opts.clientId ?? ingestClientId())
  body.append('mode', opts.mode ?? 'docling')
  if (opts.pages) body.append('pages', `${opts.pages[0]}-${opts.pages[1]}`)
  let lastErr: unknown = null

  for (let i = 0; i < attempts; i++) {
    let jobId: string | null = null
    try {
      const res = await fetch('/api/ingest', { method: 'POST', body, headers: authHeaders() })
      if (res.status === 202) {
        const j = (await res.json()) as { jobId: string }
        jobId = j.jobId
        if (opts.remember !== false) rememberLastJob(j.jobId, file.name)
        opts.onJobId?.(j.jobId)
        // poll OUTSIDE the retry loop: a poll transport failure must NOT
        // re-upload the whole PDF (the old code retried the POST on a dead
        // backend mid-parse, restarting the job up to 3 times)
        return await pollJob(j.jobId, opts.onProgress, opts.signal)
      }
      // 4xx/5xx from the gate itself (415/413/422) — do not blind-retry those
      const detail = await res.text().catch(() => '')
      throw new Error(`ingest failed (${res.status}): ${detail.slice(0, 300)}`)
    } catch (err) {
      // terminal outcomes of THIS upload: superseded means a newer upload with
      // the same client id took over — re-POSTing would supersede THAT job
      // right back (ping-pong). Parse failures surface to the caller instead
      // of a misleading "Docling 服务未启动".
      if (err instanceof Error && (err.message.startsWith('ingest failed') || err.message.startsWith('ingest superseded'))) throw err
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

export async function pollIngestJob(
  jobId: string,
  onProgress?: (p: IngestProgress) => void,
  signal?: AbortSignal,
): Promise<IngestedDoc> {
  return pollJob(jobId, onProgress, signal)
}

/** CLI-151: a settled job's own record — its phase timing and what the parse
 *  actually covered (the normalized document drops both) */
export async function ingestJobRecord(jobId: string): Promise<{
  timing: Record<string, unknown> | null
  coverage: { parsedPages: number[]; totalPages: number; complete: boolean } | null
  /** server-side job wall (created → finished, one server clock), null while open */
  wallMs: number | null
}> {
  const res = await fetch(`/api/ingest/${encodeURIComponent(jobId)}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(`job ${jobId}: HTTP ${res.status}`)
  const body = (await res.json()) as {
    timing?: Record<string, unknown> | null
    createdAt?: number
    finishedAt?: number | null
    document?: { coverage?: unknown }
  }
  const cov = body.document?.coverage as { parsedPages?: number[]; totalPages?: number; complete?: boolean } | undefined
  return {
    timing: body.timing ?? null,
    coverage: cov && Array.isArray(cov.parsedPages) ? { parsedPages: cov.parsedPages, totalPages: Number(cov.totalPages ?? 0), complete: cov.complete === true } : null,
    wallMs: body.createdAt && body.finishedAt ? Math.round((body.finishedAt - body.createdAt) * 1000) : null,
  }
}

async function pollJob(jobId: string, onProgress?: (p: IngestProgress) => void, signal?: AbortSignal): Promise<IngestedDoc> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let consecutiveTransportFails = 0
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('ingest aborted: 轮询已被调用方中止')
    let res: Response
    try {
      res = await fetch(`/api/ingest/${encodeURIComponent(jobId)}`, { headers: authHeaders(), signal: signal ?? undefined })
      consecutiveTransportFails = 0
    } catch (err) {
      if (signal?.aborted) throw new Error('ingest aborted: 轮询已被调用方中止')
      // backend gone mid-parse (restarted / reaped): a few grace retries for a
      // restart window, then surface — never a silent infinite spinner
      void err
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
      partialItems?: IngestFragment[]
    }
    onProgress?.({
      status: body.status,
      stage: body.stage ?? null,
      elapsedMs: body.elapsedMs ?? 0,
      queueDepth: body.queueDepth ?? 0,
      partial: Array.isArray(body.partialItems) ? body.partialItems : undefined,
    })
    if (body.status === 'done' && body.document) {
      clearLastJob()
      return normalizeDocling(body.document)
    }
    if (body.status === 'superseded') {
      clearLastJob()
      throw new Error('ingest superseded: 本任务已被更新的上传取代')
    }
    if (body.status === 'error') throw new Error(`ingest failed (parse): ${body.error ?? 'unknown parser error'}`)
    if (body.status === 'timeout') {
      clearLastJob()
      throw new Error(`ingest failed (timeout): ${body.error ?? '解析超时，已被终止'}`)
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  throw new Error(`ingest failed (timeout): docling did not finish job ${jobId}`)
}
