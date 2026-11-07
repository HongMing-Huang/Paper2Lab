import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// /api 代理端口：显式 env 优先；缺省 8788（dev-mvp.sh 的规范 API 端口，
// vite.mathworld.config.ts 同此默认）。端口必须是 1024–65535 的整数，
// 且探测目标主机固定为回环地址字面量——白名单写法，不拼任意输入。
function apiPort(): string {
  const raw = process.env.PAPER2LAB_API_PORT ?? '8788'
  if (!/^\d{4,5}$/.test(raw) || Number(raw) < 1024 || Number(raw) > 65535) {
    throw new Error(`PAPER2LAB_API_PORT must be an integer in [1024,65535], got: ${raw}`)
  }
  return raw
}

export default defineConfig({
  plugins: [react()],
  // ES-module workers so `new Worker(new URL(...), { type: 'module' })` works in dev & build
  worker: { format: 'es' },
  resolve: {
    alias: {
      // jsxgraph's exports map hides its stylesheet — alias to the real file
      'jsxgraph/distrib/jsxgraph.css': fileURLToPath(
        new URL('./node_modules/jsxgraph/distrib/jsxgraph.css', import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    host: true,
    // J1.2: the Node backend serves /api/v1/* (science + research); everything
    // else under /api stays on the Docling ingestion backend (server/main.py).
    // Vite matches the longest prefix first.
    //
    // 2026-11-07 上传修复：手动 `pnpm dev` 的 /api 默认从 8787 改为 8788。
    // 8787 曾被其他项目占用：默认指向它会把用户论文 POST 给无关应用（404）。
    proxy: {
      '/api/v1': `http://127.0.0.1:${process.env.PAPER2LAB_NODE_PORT ?? '8790'}`,
      '/api': {
        target: `http://127.0.0.1:${apiPort()}`,
        // 启动后校验目标身份：不是 Paper2Lab 后端就大声告警，而不是静默吃掉
        // 上传请求（2026-11-07 实测 8787 被无关 uvicorn 占用 → ingest 404）。
        // 仅探测本机回环地址；协议/主机为字面量白名单，端口经整数校验。
        configure: () => {
          const origin = `http://127.0.0.1:${apiPort()}` // loopback literal allowlist
          void fetch(`${origin}/openapi.json`)
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => {
              if (j?.info?.title !== 'Paper2Lab backend') {
                console.warn(
                  `[paper2lab] ⚠ /api 代理目标 ${origin} 不是 Paper2Lab 后端` +
                    `（openapi title=${j?.info?.title ?? '<无>'}）。` +
                    `上传/精读会失败——请用 scripts/dev-mvp.sh 启动，或设 PAPER2LAB_API_PORT。`,
                )
              }
            })
            .catch(() => {
              console.warn(
                `[paper2lab] ⚠ /api 代理目标 ${origin} 无响应。` +
                  `请先启动解析后端（scripts/dev-mvp.sh），或设 PAPER2LAB_API_PORT。`,
              )
            })
        },
      },
    },
  },
  build: { target: 'es2022' },
  // default dep scan crawls every **/*.html under root, research archive included
  optimizeDeps: { entries: ['index.html'] },
})
