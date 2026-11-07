import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { EdgeRuntime, EdgeError, loadConfig, type Device } from './runtime.ts'

const runtime = new EdgeRuntime(loadConfig())
const app = Fastify({ logger: false, bodyLimit: 128 * 1024 })
app.addHook('onRequest', async (request, reply) => {
  const token = process.env.PAPER2LAB_EDGE_TOKEN
  if (token && request.headers.authorization !== `Bearer ${token}`) return reply.code(401).send({ error: 'Unauthorized' })
})
app.setErrorHandler((error, _request, reply) => {
  reply.code(error instanceof EdgeError ? error.status : (error as { statusCode?: number }).statusCode ?? 500)
    .send({ error: error instanceof EdgeError ? error.message : 'Edge service request failed' })
})
app.get('/health', () => ({ service: 'paper2lab-edge', alive: true, ...runtime.capabilities(), inferenceVerified: false }))
app.get('/capabilities', () => runtime.capabilities())
app.get('/devices', async () => {
  try {
    const { stdout } = await promisify(execFile)(process.env.PAPER2LAB_OPENVINO_PYTHON ?? 'python3',
      [fileURLToPath(new URL('./devices.py', import.meta.url))], { timeout: 8000, maxBuffer: 65536, killSignal: 'SIGKILL', windowsHide: true })
    const result = JSON.parse(stdout)
    if (result.runtime !== 'openvino' || !Array.isArray(result.devices) || result.devices.some((d: any) => typeof d.id !== 'string')) throw new Error('Invalid device response')
    return result
  } catch { throw new EdgeError('Local OpenVINO device query unavailable; install the runtime and set PAPER2LAB_OPENVINO_PYTHON. Configured OVMS routes are independent.') }
})

function text(value: unknown, name: string, limit = 16000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new EdgeError(`Invalid ${name}`, 400)
  return value
}
function device(value: unknown): Device | undefined {
  if (value === undefined) return undefined
  if (value !== 'CPU' && value !== 'GPU' && value !== 'NPU') throw new EdgeError('Invalid device', 400)
  return value
}
for (const route of ['chat', 'embeddings', 'rerank', 'search'] as const) {
  app.post(`/api/edge/${route}`, async (request, reply) => {
    const body = request.body as Record<string, unknown>
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new EdgeError('JSON object required', 400)
    const cancel = new AbortController()
    const onClose = () => { if (!reply.raw.writableFinished) cancel.abort() }
    reply.raw.once('close', onClose)
    const signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(60000)])
    try {
      const preferred = device(body.device)
      if (route === 'search') {
        if (body.rerank !== undefined && typeof body.rerank !== 'boolean') throw new EdgeError('rerank must be boolean', 400)
        return await runtime.search(text(body.docId, 'docId', 120), text(body.query, 'query', 2000), body.rerank === true, signal, preferred)
      }
      if (route === 'chat') {
        if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 12) throw new EdgeError('1–12 messages required', 400)
        const messages = body.messages.map((m: any) => {
          if (!m || !['user', 'assistant', 'system'].includes(m.role)) throw new EdgeError('Invalid message role', 400)
          return { role: m.role, content: text(m.content, 'message content', 8000) }
        })
        if (messages.reduce((n, m) => n + m.content.length, 0) > 16000) throw new EdgeError('Context exceeds 16000 characters', 400)
        const tokens = body.max_tokens ?? 512
        if (!Number.isInteger(tokens) || Number(tokens) < 1 || Number(tokens) > 1024) throw new EdgeError('max_tokens must be 1–1024', 400)
        return await runtime.invoke('chat', { messages, max_tokens: tokens, temperature: 0 }, signal, preferred)
      }
      if (route === 'embeddings') {
        const input = Array.isArray(body.input) ? body.input : [body.input]
        if (!input.length || input.length > 16) throw new EdgeError('1–16 embedding texts required', 400)
        return await runtime.invoke('embedding', { input: input.map(v => text(v, 'embedding input', 4000)) }, signal, preferred)
      }
      if (!Array.isArray(body.documents) || !body.documents.length || body.documents.length > 16) throw new EdgeError('1–16 documents required', 400)
      return await runtime.invoke('rerank', { query: text(body.query, 'query', 2000), documents: body.documents.map(v => text(v, 'document', 6000)), top_n: Math.min(6, body.documents.length) }, signal, preferred)
    } finally { reply.raw.removeListener('close', onClose) }
  })
}
const port = Number(process.env.PAPER2LAB_EDGE_PORT ?? 8792)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid PAPER2LAB_EDGE_PORT')
await app.listen({ host: '127.0.0.1', port })
console.log(`[paper2lab-edge] http://127.0.0.1:${port}; OVMS routes are configured, not hardware-verified`)
for (const name of ['SIGINT', 'SIGTERM'] as const) process.once(name, () => void app.close())
