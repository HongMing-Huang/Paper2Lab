// Build the self-contained load-verification page:
//   node src/mathworld-assets/preview/build-preview.mjs
// Bundles react + three + R3F + drei + the asset kit into ONE iife bundle at
// public/assets/mathworld-library/preview/bundle.js, then the static page
// public/assets/mathworld-library/preview/index.html can be served from any
// static file server rooted at public/ (e.g. `python3 -m http.server -d public`).
// Verification tooling only — never imported by the product.
import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const entry = path.join(root, 'src/mathworld-assets/preview/preview.tsx')
const outDir = path.join(root, 'public/assets/mathworld-library/preview')
mkdirSync(outDir, { recursive: true })

// resolve the repo-local esbuild binary (pnpm keeps it out of the top .bin)
const candidates = [
  path.join(root, 'node_modules/.bin/esbuild'),
  path.join(root, 'node_modules/.pnpm/node_modules/.bin/esbuild'),
]
const esbuildBin = candidates.find((p) => existsSync(p))
if (!esbuildBin) {
  console.error('esbuild not found — run pnpm install first; tried:', candidates)
  process.exit(1)
}

execFileSync(
  esbuildBin,
  [
    entry,
    '--bundle',
    '--minify',
    '--format=iife',
    '--jsx=automatic',
    `--outfile=${path.join(outDir, 'bundle.js')}`,
    '--log-level=warning',
  ],
  { stdio: 'inherit', cwd: root },
)
console.log('preview bundle written to', path.join(outDir, 'bundle.js'))
