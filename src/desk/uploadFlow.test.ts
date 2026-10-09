// #15 PDF-first acceptance: the ORIGINAL paper is viewable the moment a
// file lands; a parse failure NEVER blocks access (blob URL lives through
// retry); retry with the SAME url succeeds and reaches the desk. The
// success documents are the REAL Docling dumps of two committed papers
// (ode-lotka-volterra / fit-sine-fit) — no synthetic fixtures.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runPdfFirstUpload } from './uploadFlow'

function realDoc(name: string) {
  return JSON.parse(readFileSync(join('src/ingest/fixtures', `${name}.docling.json`), 'utf8'))
}

function resJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function okChain(doc: unknown) {
  // POST → jobId; poll → running(parsing) → done(document)
  return [
    resJson({ jobId: 'retry-job' }, 202),
    resJson({ status: 'running', stage: 'parsing', elapsedMs: 3000, queueDepth: 0 }),
    resJson({ status: 'done', document: doc }),
  ]
}

describe('PDF-first flow: failure never blocks the original paper (#15)', () => {
  let created: string[]
  let revoked: string[]

  beforeEach(() => {
    created = []
    revoked = []
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn(() => {
        const u = `blob:paper2lab-${created.length}`
        created.push(u)
        return u
      }),
      revokeObjectURL: vi.fn((u: string) => revoked.push(u)),
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('real paper A (ODE): blob URL exists IMMEDIATELY; parse error keeps it; retry (real fixture) reaches the desk', async () => {
    const f = fetch as ReturnType<typeof vi.fn>
    f.mockResolvedValueOnce(resJson({ jobId: 'f1' }, 202))
      .mockResolvedValueOnce(resJson({ status: 'error', error: 'docling failed: simulated crash' }))

    const file = new File([new Uint8Array([1, 2, 3])], 'ode-lotka-volterra.pdf', { type: 'application/pdf' })
    const progress: unknown[] = []
    const first = await runPdfFirstUpload(file, { onProgress: (p) => progress.push(p) })

    // 1) the original paper is accessible from the FIRST tick
    expect(created).toHaveLength(1)
    expect(first.pdfUrl).toBe(created[0])
    // 2) parse failed — flow SETTLES (not throws) with the real reason
    expect(first.phase).toBe('failed')
    expect(first.error).toMatch(/simulated crash/)
    expect(first.pdfUrl).toBe(created[0]) // view retained, not revoked
    expect(revoked).toHaveLength(0)

    // 3) retry reuses the SAME url (no second blob), succeeds with the REAL
    //    docling dump of the same paper, routes to the ODE desk decision
    f.mockReset()
    f.mockImplementationOnce(async () => resJson({ jobId: 'f2' }, 202))
      .mockImplementationOnce(async () => resJson({ status: 'running', stage: 'parsing', elapsedMs: 100, queueDepth: 0 }))
      .mockImplementationOnce(async () => resJson({ status: 'done', document: realDoc('ode-lotka-volterra') }))
    const second = await runPdfFirstUpload(file, { existingUrl: first.pdfUrl })
    expect(created).toHaveLength(1) // reused, no leak
    expect(second.phase).toBe('done')
    expect(second.doc!.items.length).toBeGreaterThan(0)
    expect(second.decision!.status).toBe('ok')
    if (second.decision!.status === 'ok') expect(second.decision!.adapter).toBe('ode')
  })

  it('real paper B (fit): same chain, fit-table decision on retry success', async () => {
    const f = fetch as ReturnType<typeof vi.fn>
    f.mockResolvedValueOnce(resJson({ jobId: 'g1' }, 202))
      .mockResolvedValueOnce(resJson({ status: 'timeout', error: 'docling exceeded 600s' }))
    const file = new File([new Uint8Array([9])], 'fit-sine-fit.pdf', { type: 'application/pdf' })
    const first = await runPdfFirstUpload(file)
    expect(first.phase).toBe('failed')
    expect(first.error).toMatch(/timeout/)
    expect(first.pdfUrl).toBeTruthy() // 原文仍可访问

    f.mockReset()
    const chain = okChain(realDoc('fit-sine-fit'))
    f.mockImplementationOnce(async () => chain[0])
      .mockImplementationOnce(async () => chain[1])
      .mockImplementationOnce(async () => chain[2])
    const second = await runPdfFirstUpload(file, { existingUrl: first.pdfUrl })
    expect(second.phase).toBe('done')
    if (second.decision!.status === 'ok') expect(second.decision!.binding.kind).toBe('fit')
    expect(second.doc!.items.filter((i) => i.kind === 'table')).toHaveLength(1)
  })

  it('a lost job (404) also keeps the original viewable — no blank error wall', async () => {
    const f = fetch as ReturnType<typeof vi.fn>
    f.mockResolvedValueOnce(resJson({ jobId: 'lost' }, 202)).mockResolvedValue(new Response('', { status: 404 }))
    const out = await runPdfFirstUpload(new File([new Uint8Array([1])], 'x.pdf'))
    expect(out.phase).toBe('failed')
    expect(out.error).toMatch(/任务已丢失/)
    expect(out.pdfUrl).toBe(created[0])
  })
})
