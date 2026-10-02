// Build the importable ExperimentRun bundle from the C++ precompute output.
//
//   /tmp/precompute_kakeya large | node --import tsx scripts/build_kakeya_bundle.ts
//   node --import tsx scripts/build_kakeya_bundle.ts            # rebuild from committed dataset
//
// The C++ rows arrive on STDIN (no path arguments anywhere) — same kernels and
// seed as the browser (kakeya-voxel-v3). Writes:
//   src/data/kakeya-precomputed.json       raw cpp rows (committed artifact)
//   src/data/kakeya-precomputed-runs.json  protocol bundle: meta + run records
//
// Every row becomes ONE immutable kakeya.voxel ExperimentRun (engine
// cpp-precompute) with a stable, human-readable runId — the page imports the
// bundle atomically (runRepository.importRuns) so every datapoint carries a
// REAL traceable runId instead of a presentation literal.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as readline from 'node:readline'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const dataDir = resolve(repo, 'src/data')
const defaultRaw = resolve(dataDir, 'kakeya-precomputed.json')

interface CppRow {
  deltaExp: number; delta: number; packing: number; res: number; n: number
  occupiedVolume: number; sumTubeVolume: number; maxMultiplicity: number; avgMultiplicity: number
}
interface CppOutput {
  algorithmVersion: string; seed: number; compile: string; kernel: string
  rowCount: number; checksumFnv1a: string; series: CppRow[]
}

async function readStdinJson(): Promise<string | null> {
  if (process.stdin.isTTY) return null
  const chunks: Buffer[] = []
  const rl = readline.createInterface({ input: process.stdin })
  // readline splits lines; reassemble verbatim (JSON is line-safe here)
  let first = true
  for await (const line of rl) {
    chunks.push(Buffer.from((first ? '' : '\n') + line))
    first = false
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  return text || null
}

const stdinText = await readStdinJson()
const raw: CppOutput = JSON.parse(stdinText ?? readFileSync(defaultRaw, 'utf8'))

const pct = (p: number) => Math.round(p * 100)
const runs = raw.series.map((row) => ({
  runId: `kakeya-cpp-d${row.deltaExp}-p${pct(row.packing)}-n${row.n}`,
  spec: {
    kind: 'kakeya.voxel',
    params: { deltaExp: row.deltaExp, packing: row.packing, nTubes: row.n },
    seed: raw.seed,
    res: row.res,
    model: { ...row, algorithmVersion: raw.algorithmVersion, checksumFnv1a: raw.checksumFnv1a },
  },
  status: 'resolved',
  result: {
    res: row.res,
    occupiedVolume: row.occupiedVolume,
    sumTubeVolume: row.sumTubeVolume,
    maxMultiplicity: row.maxMultiplicity,
    avgMultiplicity: row.avgMultiplicity,
  },
  engine: 'cpp-precompute',
  engineVersion: raw.algorithmVersion,
  durationMs: 0,
  evidence: 'CALCULATED',
  createdAt: 0,
  startedAt: 0,
  errors: [],
}))

const bundle = {
  meta: {
    algorithmVersion: raw.algorithmVersion,
    seed: raw.seed,
    compile: raw.compile,
    kernel: raw.kernel,
    rowCount: raw.rowCount,
    checksumFnv1a: raw.checksumFnv1a,
    note: 'offline C++ precompute — same kernels/seed as the browser; import atomically via runRepository.importRuns',
  },
  runs,
}

writeFileSync(resolve(dataDir, 'kakeya-precomputed.json'), JSON.stringify(raw, null, 2) + '\n')
writeFileSync(resolve(dataDir, 'kakeya-precomputed-runs.json'), JSON.stringify(bundle, null, 2) + '\n')
console.log(`bundle: ${runs.length} runs, checksum ${raw.checksumFnv1a.slice(0, 16)}, max res ${Math.max(...raw.series.map((r) => r.res))}`)
