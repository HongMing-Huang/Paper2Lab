// Test fixture (orphan.test.ts): a stand-in "worker" that starts the SHIPPED
// bundled engine in candidate mode, forwards the request from its own stdin,
// prints the engine pid and exits at once — orphaning the engine, exactly as a
// crashed worker would. The engine's PPID guard must then stop it by itself.
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const engine = spawn(process.execPath, [resolve(root, 'scripts', 'engine_once.mjs'), '--candidate'], {
  cwd: root,
  stdio: ['pipe', 'ignore', 'ignore'],
  detached: true,
  // same contract the real worker uses (server/node/engine.ts)
  env: { ...process.env, PAPER2LAB_ENGINE_OWNER_PID: String(process.pid) },
})
engine.stdin.end(Buffer.concat(chunks))
engine.unref()
process.stdout.write(String(engine.pid))
process.exit(0)
