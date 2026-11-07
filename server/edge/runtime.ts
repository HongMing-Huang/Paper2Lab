import { readFileSync } from 'node:fs'

export type Device = 'CPU' | 'GPU' | 'NPU'
export type Capability = 'chat' | 'embedding' | 'rerank'
interface Route { device: Device; baseUrl: string; models: Partial<Record<Capability, string>> }
export interface EdgeConfig { routes: Route[]; order: Device[]; paperBaseUrl: string }
export class EdgeError extends Error {
  constructor(message: string, public status = 503) { super(message) }
}
export function loadConfig(): EdgeConfig {
  const file = process.env.PAPER2LAB_EDGE_CONFIG
  const raw = file ? JSON.parse(readFileSync(file, 'utf8')) : { routes: [], order: ['NPU', 'GPU', 'CPU'] }
  const devices = ['CPU', 'GPU', 'NPU']
  if (!Array.isArray(raw.routes) || !Array.isArray(raw.order) || !raw.order.length || new Set(raw.order).size !== raw.order.length || raw.order.some((d: string) => !devices.includes(d))) throw new Error('Invalid edge routes/order')
  const seen = new Set<string>()
  for (const route of raw.routes) {
    const url = new URL(route.baseUrl)
    if (!devices.includes(route.device) || seen.has(route.device) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || !route.models) throw new Error('Invalid edge device route')
    seen.add(route.device)
    for (const key of Object.keys(route.models)) if (!['chat', 'embedding', 'rerank'].includes(key) || typeof route.models[key] !== 'string' || !route.models[key]) throw new Error('Invalid edge model alias')
    route.baseUrl = url.href.replace(/\/?$/, '/')
  }
  const paperBaseUrl = process.env.PAPER2LAB_PAPER_BASE_URL ?? 'http://127.0.0.1:8787/'
  const paperUrl = new URL(paperBaseUrl)
  if (!['http:', 'https:'].includes(paperUrl.protocol) || paperUrl.username || paperUrl.password) throw new Error('Invalid paper service URL')
  return { routes: raw.routes, order: raw.order, paperBaseUrl }
}
async function jsonResponse(response: Response): Promise<any> {
  if (!response.body) throw new EdgeError('Upstream returned no body', 502)
  const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = []
  try {
    for (;;) { const next = await reader.read(); if (next.done) break
      size += next.value.byteLength
      if (size > 8 * 1024 * 1024) throw new EdgeError('Upstream response exceeds 8 MB', 502)
      chunks.push(next.value)
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new EdgeError('Upstream returned invalid JSON', 502) }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
export class EdgeRuntime {
  constructor(public config: EdgeConfig) {}
  capabilities() {
    return { backend: 'openvino-model-server', configured: this.config.routes.length > 0,
      routes: this.config.routes.map(r => ({ configuredDevice: r.device, models: r.models, actualDevice: null, verification: 'not_hardware_verified' })),
      order: this.config.order, note: 'Device labels describe operator-configured OVMS deployments, not hardware discovery or measured performance.' }
  }
  async invoke(capability: Capability, body: Record<string, unknown>, signal: AbortSignal, preferred?: Device) {
    const order = preferred ? [preferred, ...this.config.order.filter(d => d !== preferred)] : this.config.order
    const candidates = order.flatMap(d => this.config.routes.filter(r => r.device === d && r.models[capability]))
    const attempts: Array<{ device: Device; reason: string }> = []
    for (const route of candidates) {
      if (signal.aborted) throw new EdgeError('Edge request cancelled or timed out', 504)
      const started = performance.now()
      try {
        const endpoint = { chat: 'chat/completions', embedding: 'embeddings', rerank: 'rerank' }[capability]
        const response = await fetch(new URL(endpoint, route.baseUrl), {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...(process.env.PAPER2LAB_OVMS_API_KEY ? { Authorization: `Bearer ${process.env.PAPER2LAB_OVMS_API_KEY}` } : {}) },
          body: JSON.stringify({ ...body, model: route.models[capability], ...(capability === 'chat' ? { stream: false } : {}) }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
        })
        if (!response.ok) { await response.body?.cancel(); throw new EdgeError(`OVMS HTTP ${response.status}`, 502) }
        const output = await jsonResponse(response)
        if (capability === 'chat' && (typeof output.choices?.[0]?.message?.content !== 'string')) throw new EdgeError('Invalid chat output', 502)
        if (capability === 'embedding') {
          const input = body.input as string[]
          if (!Array.isArray(output.data) || output.data.length !== input.length) throw new EdgeError('Invalid embedding count', 502)
          const indexes = new Set(); let dimension = 0
          for (const row of output.data) {
            if (!Number.isInteger(row.index) || row.index < 0 || row.index >= input.length || indexes.has(row.index) || !Array.isArray(row.embedding) || !row.embedding.length || !row.embedding.every((x: unknown) => typeof x === 'number' && Number.isFinite(x))) throw new EdgeError('Invalid embedding output', 502)
            indexes.add(row.index); dimension ||= row.embedding.length
            if (dimension !== row.embedding.length) throw new EdgeError('Mixed embedding dimensions', 502)
          }
        }
        if (capability === 'rerank') {
          const count = (body.documents as unknown[]).length; const seen = new Set()
          if (!Array.isArray(output.results) || output.results.length !== Math.min(Number(body.top_n ?? count), count)) throw new EdgeError('Invalid rerank count', 502)
          for (const row of output.results) {
            if (!Number.isInteger(row.index) || row.index < 0 || row.index >= count || seen.has(row.index) || typeof row.relevance_score !== 'number' || !Number.isFinite(row.relevance_score)) throw new EdgeError('Invalid rerank output', 502)
            seen.add(row.index)
          }
        }
        return { output, inference: { backend: 'openvino-model-server', model: route.models[capability], configuredDevice: route.device, actualDevice: null, durationMs: Math.round(performance.now() - started), fallback: attempts, evidence: 'MODEL_OUTPUT' } }
      } catch (error) {
        if (signal.aborted) throw new EdgeError('Edge request cancelled or timed out', 504)
        // Inference is stateless here: no tools or domain mutations are replayed.
        attempts.push({ device: route.device, reason: error instanceof EdgeError ? error.message : 'OVMS connection failed or timed out' })
      }
    }
    throw new EdgeError(candidates.length ? `No usable ${capability} route: ${attempts.map(a => `${a.device}: ${a.reason}`).join('; ')}` : `No ${capability} model configured`)
  }
  async search(docId: string, query: string, rerank: boolean, signal: AbortSignal, preferred?: Device) {
    if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(docId)) throw new EdgeError('Invalid document id', 400)
    const response = await fetch(new URL(`api/document/${encodeURIComponent(docId)}`, this.config.paperBaseUrl), { signal,
      headers: process.env.PAPER2LAB_API_TOKEN ? { Authorization: `Bearer ${process.env.PAPER2LAB_API_TOKEN}` } : {} })
    if (!response.ok) throw new EdgeError(`Paper service HTTP ${response.status}`, response.status === 404 ? 404 : 502)
    const doc = await jsonResponse(response)
    if (doc.docId !== docId || !Array.isArray(doc.items)) throw new EdgeError('Invalid paper service document', 502)
    const terms = query.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]/g) ?? []
    const candidates = doc.items.flatMap((item: any) => {
      const text = [item.text, item.latex].filter(v => typeof v === 'string').join('\n')
      if (!text || typeof item.id !== 'string' || !Number.isInteger(item.page)) return []
      const lower = text.toLowerCase(); const score = terms.reduce((n, term) => n + (lower.includes(term) ? 1 : 0), 0)
      return score ? [{ docId, anchorId: item.id, page: item.page, bbox: item.bbox, text: text.slice(0, 6000), lexicalScore: score }] : []
    }).sort((a: any, b: any) => b.lexicalScore - a.lexicalScore).slice(0, 12)
    if (!rerank || !candidates.length) return { method: 'lexical', candidates, inference: null }
    const result = await this.invoke('rerank', { query, documents: candidates.map((c: any) => c.text), top_n: Math.min(6, candidates.length) }, signal, preferred)
    return { method: 'lexical+openvino-rerank', candidates: result.output.results.map((row: any) => ({ ...candidates[row.index], relevanceScore: row.relevance_score })), inference: result.inference }
  }
}
