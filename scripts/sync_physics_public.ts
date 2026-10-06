// Sync the vendored MuJoCo scene tree into public/assets/mujoco/scenes/ so
// the browser lab can fetch every file (scene XML + meshes/textures) and
// seed the Emscripten VFS same-origin (AGENTS §0.1: no CDN dependency).
// Also writes index.json (relative file list, from the vendored manifest).
//   node --import tsx scripts/sync_physics_public.ts
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const srcDir = resolve(repo, 'src/physics/scenes')
const outDir = resolve(repo, 'public/assets/mujoco/scenes')

rmSync(outDir, { recursive: true, force: true })

const walk = (dir: string, base = ''): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    const rel = base ? `${base}/${name}` : name
    return statSync(full).isDirectory() ? walk(full, rel) : [rel]
  })

const files = walk(srcDir).filter((f) => f !== 'manifest.json')
for (const rel of files) {
  const dest = join(outDir, rel)
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(join(srcDir, rel), dest)
}
writeFileSync(join(outDir, 'index.json'), JSON.stringify({ files }, null, 2) + '\n')
console.log(`synced ${files.length} scene files → public/assets/mujoco/scenes (+index.json)`)
