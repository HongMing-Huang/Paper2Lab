import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
    proxy: {
      '/api/v1': `http://127.0.0.1:${process.env.PAPER2LAB_NODE_PORT ?? '8790'}`,
      '/api': `http://127.0.0.1:${process.env.PAPER2LAB_API_PORT ?? '8787'}`,
    },
  },
  build: { target: 'es2022' },
  // default dep scan crawls every **/*.html under root, research archive included
  optimizeDeps: { entries: ['index.html'] },
})
