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
    // Docling ingestion backend (server/main.py)
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  build: { target: 'es2022' },
})
