// Independent MathWorld page (Linear CLI-129, U2.1 local playable slice).
// A separate config so the shared vite.config.ts and the main app build stay
// untouched: dev on its own port, build into dist/mathworld (git-ignored).
//   dev:   pnpm exec vite --config vite.mathworld.config.ts
//   build: pnpm exec vite build --config vite.mathworld.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // own dep-optimizer cache: sharing node_modules/.vite with the main app's
  // dev server would overwrite its optimized deps and break its next reload
  cacheDir: 'node_modules/.vite-mathworld',
  // the executor imports the voxel worker client (ES-module worker)
  worker: { format: 'es' },
  server: { port: 5191, strictPort: true, host: '127.0.0.1' },
  preview: { port: 5192, strictPort: true, host: '127.0.0.1' },
  // the agent dock (CLI-151b) talks to the same research backend as the main
  // app: /api/v1 → Node 8790, other /api → Python 8788
  proxy: {
    '/api/v1': { target: 'http://127.0.0.1:8790', changeOrigin: true },
    '/api': { target: 'http://127.0.0.1:8788', changeOrigin: true },
  },
  build: {
    target: 'es2022',
    outDir: 'dist/mathworld',
    emptyOutDir: true,
    rollupOptions: { input: 'mathworld.html' },
  },
  // only crawl this page's graph (the research archive holds other html files)
  optimizeDeps: { entries: ['mathworld.html'] },
})
