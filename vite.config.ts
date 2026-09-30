import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // ES-module workers so `new Worker(new URL(...), { type: 'module' })` works in dev & build
  worker: { format: 'es' },
  server: { port: 5173, host: true },
  build: { target: 'es2022' },
})
