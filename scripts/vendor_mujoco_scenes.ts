// Vendor MuJoCo demo scenes from the LOCKED upstream commit
// zalo/mujoco_wasm@f6b202ca29bc1706e4db583edf732c4a0902c27b into
// src/physics/scenes/, plus a manifest (file list + sha256 + provenance).
//
//   node --import tsx scripts/vendor_mujoco_scenes.ts
//
// Security posture (Mimosa constraints):
//   * fetch over https only, host allow-listed (public github codeload) —
//     localhost/loopback/private addresses are rejected before any request
//   * every .xml is scanned for <!DOCTYPE / <!ENTITY before being written:
//     XXE-shaped input never reaches disk (MuJoCo's own parser would also
//     reject it, but we refuse at ingest)
//   * flex.xml is EXCLUDED on purpose (upstream integrator incompatibility)
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const UPSTREAM = 'zalo/mujoco_wasm'
const COMMIT = 'f6b202ca29bc1706e4db583edf732c4a0902c27b'
const TARBALL_HOST = 'codeload.github.com'
const TARBALL_URL = `https://${TARBALL_HOST}/${UPSTREAM}/tar.gz/${COMMIT}`

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const outDir = resolve(repo, 'src/physics/scenes')

// 16 scenes that pass the upstream headless test (17 minus flex.xml)
const SCENES = [
  '22_humanoids.xml', 'adhesion.xml', 'agility_cassie/scene.xml', 'arm26.xml',
  'balloons.xml', 'car.xml', 'hammock.xml', 'humanoid.xml', 'humanoid_body.xml',
  'model.xml', 'model_with_tendon.xml', 'mug.xml', 'scene.xml',
  'shadow_hand/scene_left.xml', 'shadow_hand/scene_right.xml',
  'simple.xml', 'slider_crank.xml',
] as const

function assertPublicHost(u: URL): void {
  if (u.protocol !== 'https:') throw new Error(`only https is allowed: ${u.protocol}`)
  if (u.hostname !== TARBALL_HOST) throw new Error(`host not allow-listed: ${u.hostname}`)
  const h = u.hostname.toLowerCase()
  const blockedHosts = ['localhost', '0.0.0.0', '[::1]', '127.0.0.1', '::1']
  const blockedPrefixes = ['127.', '10.', '192.168.', '169.254.', '172.16.', '172.17.', '172.18.', '172.19.', '172.2', '172.30.', '172.31.']
  if (blockedHosts.includes(h) || blockedPrefixes.some((p) => h.startsWith(p))) {
    throw new Error(`private/loopback host rejected: ${u.hostname}`)
  }
}

function main() {
  assertPublicHost(new URL(TARBALL_URL))
  const tmp = resolve(repo, '.tmp-mujoco-vendor')
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  const tgz = join(tmp, 'upstream.tar.gz')
  // curl with an explicit URL argument list (no shell string building)
  execFileSync('curl', ['-fsSL', '--max-time', '180', '-o', tgz, TARBALL_URL], { stdio: 'inherit' })
  execFileSync('tar', ['-xzf', tgz, '-C', tmp], { stdio: 'inherit' })

  // GitHub names the tarball root `<repo>-<full-ref>` — discover it instead
  // of guessing the prefix length
  const rootName = readdirSync(tmp).find((n) => n.startsWith('mujoco_wasm-'))
  if (!rootName) throw new Error('unexpected tarball layout: no mujoco_wasm-* root')
  const root = join(tmp, rootName, 'assets', 'scenes')
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  // copy every scene entry (xml + the meshes/textures the subfolders carry)
  // plus the mug assets referenced by mug.xml
  const keep: Array<{ src: string; dest: string }> = []
  for (const scene of SCENES) {
    const rel = scene.includes('/') ? scene.slice(0, scene.indexOf('/')) : scene
    keep.push({ src: rel, dest: rel })
  }
  for (const mug of ['mug.obj', 'mug.png']) keep.push({ src: mug, dest: mug })

  const copied: Record<string, string> = {}
  const seen = new Set<string>()
  for (const { src, dest } of keep) {
    if (seen.has(dest)) continue
    seen.add(dest)
    const from = join(root, src)
    execFileSync('cp', ['-R', from, join(outDir, dest)])
  }
  // hash every vendored file (walk)
  const walk = (dir: string, base = ''): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name)
      const rel = base ? `${base}/${name}` : name
      return statSync(full).isDirectory() ? walk(full, rel) : [rel]
    })
  for (const rel of walk(outDir)) {
    const buf = readFileSync(join(outDir, rel))
    if (rel.endsWith('.xml')) {
      const text = buf.toString('utf8')
      if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error(`unsafe XML rejected: ${rel}`)
    }
    copied[rel] = createHash('sha256').update(buf).digest('hex').slice(0, 16)
  }

  const manifest = {
    upstream: `github.com/${UPSTREAM}`,
    commit: COMMIT,
    license: 'upstream ISC (scenes © respective MuJoCo demos)',
    excluded: ['flex.xml (upstream integrator incompatibility — 16/17 headless pass)'],
    scenes: [...SCENES],
    files: copied,
    generatedAt: new Date().toISOString(),
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  rmSync(tmp, { recursive: true, force: true })
  console.log(`vendored ${Object.keys(copied).length} files (${SCENES.length} scenes) from ${UPSTREAM}@${COMMIT.slice(0, 7)}`)
}

main()
