// #15 UX: the upload client must report LIVE progress (stage/elapsed/queue)
// from each poll, surface the distinct `timeout` terminal state, fail fast on
// a lost job (404), and NEVER re-upload the PDF when the POLL fails mid-parse
// (the old code restarted the whole job up to 3 times).
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { ingestPdf } from './upload'

function resJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const DOC = {
  docId: 'd1',
  title: 'T',
  engine: 'docling',
  doclingVersion: '2.131.0',
  pages: [{ page: 1, width: 612, height: 792 }],
  items: [],
}

describe('ingestPdf progress + failure contracts (#15 UX)', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  it('streams stage/elapsed/queue from every poll to onProgress', async () => {
    const f = fetch as ReturnType<typeof vi.fn>
    f.mockResolvedValueOnce(resJson({ jobId: 'j1' }, 202))
      .mockResolvedValueOnce(resJson({ status: 'queued', stage: null, elapsedMs: 120, queueDepth: 2 }))
      .mockResolvedValueOnce(resJson({ status: 'running', stage: 'warming', elapsedMs: 4000, queueDepth: 0 }))
      .mockResolvedValueOnce(resJson({ status: 'running', stage: 'parsing', elapsedMs: 12000, queueDepth: 0 }))
      .mockResolvedValueOnce(resJson({ status: 'done', document: DOC }))
    const seen: string[] = []
    const doc = await ingestPdf(new File([], 'p.pdf'), {
      onProgress: (p) => seen.push(`${p.status}/${p.stage ?? '-'}/${p.elapsedMs}`),
    })
    expect(doc.docId).toBe('d1')
    expect(seen).toEqual(['queued/-/120', 'running/warming/4000', 'running/parsing/12000', 'done/-/0'])
  })

  it('the timeout terminal state surfaces a clear error (not an infinite poll)', async () => {
    const f = fetch as ReturnType<typeof vi.fn>
    f.mockResolvedValueOnce(resJson({ jobId: 'j9' }, 202))
      .mockResolvedValue(resJson({ status: 'timeout', error: 'docling exceeded 600s — warm worker killed (pid 1)' }))
    await expect(ingestPdf(new File([], 'p.pdf'))).rejects.toThrow(/timeout.*worker killed/)
  })

  it('a lost job (404 after backend restart) fails immediately with a retry hint', async () => {
    const f = fetch as ReturnType<typeof vi.fn>
    f.mockResolvedValueOnce(resJson({ jobId: 'j404' }, 202)).mockResolvedValue(new Response('', { status: 404 }))
    await expect(ingestPdf(new File([], 'p.pdf'))).rejects.toThrow(/任务已丢失/)
  })

  it('a POLL transport failure does NOT re-upload the PDF (no second POST)', { timeout: 20000 }, async () => {
    const f = fetch as ReturnType<typeof vi.fn>
    f.mockResolvedValueOnce(resJson({ jobId: 'jT' }, 202))
    f.mockRejectedValueOnce(new TypeError('network down')) // poll 1
    f.mockRejectedValueOnce(new TypeError('network down')) // poll 2
    f.mockRejectedValueOnce(new TypeError('network down')) // poll 3
    f.mockRejectedValueOnce(new TypeError('network down')) // poll 4
    f.mockRejectedValueOnce(new TypeError('network down')) // poll 5
    f.mockRejectedValueOnce(new TypeError('network down')) // poll 6 → give up
    await expect(ingestPdf(new File([], 'p.pdf'), { attempts: 5 })).rejects.toThrow(/后端不可达/)
    const posts = f.mock.calls.filter((c) => String(c[1]?.method).toUpperCase() === 'POST' && c[0] === '/api/ingest')
    expect(posts).toHaveLength(1) // the upload ran ONCE
  })
})
