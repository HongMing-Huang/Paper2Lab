// Headless P50/P95 probe per pipeline stage (#23). Run:
//   npx tsx scripts/perf_probe.ts
// Stages measured WITHOUT network/render (render needs the deployed env —
// recorded separately when available). Every stage calls the REAL kernels
// (no mocks): Cortex parse/compile, formula.plot sampling, kakeya
// preview/exact/sweep, challenge tubes, runtime queue latency.
import { analyzeFormula } from '../src/formula/analyze'
import { compileFormula } from '../src/formula/compile'
import { executeSkill } from '../src/skills/executor'
import '../src/challenges/registerChallengeRunner'
import { explorerStore, CURVE_SAMPLES, PREVIEW_SAMPLES } from '../src/desk/explorerStore'
import { buildExplorerSpec } from '../src/formula/spec'
import { computeVoxelCoverage } from '../src/kakeya/voxels3d'
import { fibonacciDirections } from '../src/kakeya/directions'
import { makeTubes } from '../src/kakeya/tubes'
import { Runtime } from '../src/runtime/cell'

function stats(samples: number[]): { p50: number; p95: number; min: number; max: number; n: number } {
  const s = samples.slice().sort((a, b) => a - b)
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]
  return { p50: at(0.5), p95: at(0.95), min: s[0], max: s[s.length - 1], n: s.length }
}

async function bench(label: string, n: number, fn: () => unknown | Promise<unknown>, warmup = 2) {
  for (let i = 0; i < warmup; i++) await fn()
  const t: number[] = []
  for (let i = 0; i < n; i++) {
    const t0 = performance.now()
    await fn()
    t.push(performance.now() - t0)
  }
  const s = stats(t)
  console.log(
    `${label.padEnd(46)} p50 ${s.p50.toFixed(2).padStart(8)}ms  p95 ${s.p95.toFixed(2).padStart(8)}ms  (n=${s.n}, min ${s.min.toFixed(2)}, max ${s.max.toFixed(2)})`,
  )
  return s
}

const LATEX = 'y = a\\sin(bx)'

// ---- parse / compile --------------------------------------------------------
await bench('parse: docling latex → MathJSON → roles', 100, () => analyzeFormula(LATEX))
const analysis = analyzeFormula(LATEX)
await bench('compile: MathJSON → JS function', 100, () => compileFormula(analysis.rhs))

// ---- formula compute (same kernels the worker uses) -------------------------
const { spec, compiled } = buildExplorerSpec(analysis, { docId: 'perf', anchorId: 'eq', page: 1, bbox: { x: 0, y: 0, w: 1, h: 1 }, latex: LATEX })
await bench(`formula.plot exact (${CURVE_SAMPLES} samples, executor)`, 50, () =>
  executeSkill(
    'formula.plot',
    {
      expression: analysis.rhs,
      parameters: ['a', 'b'],
      independent: 'x',
      range: [-7, 7],
      values: { a: 1.5, b: 2 },
      samples: CURVE_SAMPLES,
    },
    { planId: 'perf-probe-plan' },
  ),
)

// preview (drag path): local kernel at PREVIEW_SAMPLES
const previewExplorerId = 'perf-explorer'
explorerStore.create(previewExplorerId, spec, compiled)
await explorerStore.waitForRun(previewExplorerId)
let previewStep = 0
await bench(`formula preview (${PREVIEW_SAMPLES} samples, local kernel)`, 100, () =>
  explorerStore.setParams(previewExplorerId, { a: 1 + ((previewStep += 0.01) % 2) }, { preview: true }),
)

// ---- kakeya kernels ----------------------------------------------------------
const tubes = makeTubes(fibonacciDirections(96), 2 ** -4, 0)
await bench('kakeya preview grid (res 32, sync)', 30, () => computeVoxelCoverage(tubes, 32, 0))
await bench('kakeya exact grid (res 48, node kernel)', 15, () => computeVoxelCoverage(tubes, 48, 16))
const sweepTubes = (n: number) => makeTubes(fibonacciDirections(n), 2 ** -4, 0)
await bench('kakeya sweep point (res 40, node kernel)', 15, () => computeVoxelCoverage(sweepTubes(64), 40, 0))

// ---- challenge kernel (side-effect import registers the runner) --------------
await bench('challenge tubes attempt (res 24)', 50, () =>
  executeSkill('challenge.attempt', { challenge: 'tubes', changes: { offsets: [0.5, 0.5, 0.5, 0.5] } }, { planId: 'perf-probe-plan' }),
)

// ---- runtime queue latency: setParam → preview notification ------------------
// (the drag loop's real budget: how fast does a param change reach subscribers)
{
  const rt = new Runtime()
  const p = rt.param('drag', 1)
  let notifyCount = 0
  let v = 0
  rt.subscribe('drag', () => { notifyCount++ })
  await bench('runtime queue: setParam → subscriber notify (sync)', 200, () => rt.setParam(p.id, (v += 0.01)))
  if (notifyCount < 200) throw new Error('unexpected notify count')
}

console.log('\nNOTE: 传输/渲染阶段需要部署环境（浏览器+网络），此处无头不可测——按 #23 验收口径单独记录。')
