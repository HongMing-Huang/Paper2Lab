// J1.2b — opt-in bearer auth for the Node APIs. PAPER2LAB_API_TOKEN comes from
// the environment ONLY (never source, logs or the browser bundle). Unset (the
// single-user localhost default) leaves the API open; set → every non-health
// route requires `Authorization: Bearer <token>`, and a wrong token is a 401
// with no hint about the expected value.
import type { FastifyInstance } from 'fastify'

export function registerBearerAuth(app: FastifyInstance): void {
  const token = process.env.PAPER2LAB_API_TOKEN
  if (!token) return
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/api/v1/science/health') || req.url.startsWith('/api/v1/research/health')) return
    if (req.method === 'OPTIONS') return
    const header = String(req.headers.authorization ?? '')
    if (header !== `Bearer ${token}`) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
  })
}
