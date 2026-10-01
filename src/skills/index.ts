// The seven skill families, wired to the deterministic kernels.
// Numbers only ever come from these kernels; `infer` emits AI_INFERENCE text
// that quotes CALCULATED values and never poses as a theorem.
import { registerSkill } from './types'
import { fibonacciDirections, minAngularSeparation } from '../kakeya/directions'
import { makeTubes, type Tube3 } from '../kakeya/tubes'
import { computeVoxelCoverage, type VoxelMetrics } from '../kakeya/voxels3d'
import { perronTree } from '../kakeya/perron'
import { computeVoxels, isWorkerAvailable } from '../workers/voxelClient'
import { isPyodideWorkerAvailable, runPythonJson } from '../workers/pyodideClient'
import { WHATIFS } from '../paper/wangZahl'
import { kakeya } from '../paper/kakeyaGraph'
import { getEvidenceLog } from './types'

const num = (description: string) => ({ type: 'number' as const, description })
const str = (description: string) => ({ type: 'string' as const, description })

// ---- inspect --------------------------------------------------------------

export interface InspectOutput {
  delta: number
  nTubes: number
  packing: number
  minSepRad: number
  minSepDeg: number
  regime: 'separated' | 'intermediate' | 'sticky'
  deltaSeparated: boolean
  sumTubeVolumeAnalytic: number
}

registerSkill({
  id: 'inspect.configuration',
  family: 'inspect',
  title: '检视构型',
  description: '描述当前 δ-tube 构型的方向分离度与解析体积参考',
  input_schema: { type: 'object', required: ['delta', 'nTubes', 'packing'], properties: { delta: num('管半径 δ'), nTubes: num('管数'), packing: num('0 separated … 1 sticky') } },
  output_schema: { type: 'object', properties: { minSepDeg: num('方向最小角距（度）'), regime: str('构型分类'), deltaSeparated: { type: 'boolean', description: '方向是否 δ-分离' } } },
  runtime: 'main',
  evidence_type: 'CALCULATED',
  dependencies: ['kakeya/directions.ts', 'kakeya/tubes.ts'],
  run: ({ delta, nTubes, packing }: { delta: number; nTubes: number; packing: number }): InspectOutput => {
    const dirs = fibonacciDirections(nTubes)
    const sep = minAngularSeparation(dirs)
    const perTube = Math.PI * delta * delta + (4 / 3) * Math.PI * delta ** 3 / 2
    return {
      delta,
      nTubes,
      packing,
      minSepRad: sep,
      minSepDeg: (sep * 180) / Math.PI,
      regime: packing >= 0.6 ? 'sticky' : packing >= 0.25 ? 'intermediate' : 'separated',
      deltaSeparated: sep >= delta,
      sumTubeVolumeAnalytic: nTubes * perTube,
    }
  },
})

// ---- simulate / measure ------------------------------------------------------

async function runCoverage(tubes: Tube3[], res: number, visRes: number): Promise<VoxelMetrics> {
  const r = isWorkerAvailable() ? await computeVoxels(tubes, res, visRes) : computeVoxelCoverage(tubes, res, visRes)
  const { visGrid: _visGrid, ...metrics } = r
  return metrics
}

registerSkill({
  id: 'simulate.kakeya_tubes',
  family: 'simulate',
  title: '模拟 δ-tube 族',
  description: '生成 Fibonacci 半球面方向的 δ-tubes 并计算有限尺度覆盖指标（Worker）',
  input_schema: {
    type: 'object',
    required: ['delta', 'nTubes', 'packing', 'res'],
    properties: { delta: num('δ'), nTubes: num('N'), packing: num('packing'), res: num('体素网格 res') },
  },
  output_schema: { type: 'object', properties: { metrics: { type: 'object', description: 'VoxelMetrics' } } },
  runtime: 'worker',
  evidence_type: 'CALCULATED',
  dependencies: ['kakeya/tubes.ts', 'kakeya/voxels3d.ts', 'workers/voxelClient.ts'],
  run: async ({ delta, nTubes, packing, res }: { delta: number; nTubes: number; packing: number; res: number }) => {
    const tubes = makeTubes(fibonacciDirections(nTubes), delta, packing)
    const metrics = await runCoverage(tubes, res, 0)
    return { tubeCount: tubes.length, metrics }
  },
})

registerSkill({
  id: 'measure.coverage',
  family: 'measure',
  title: '测量覆盖指标',
  description: '对给定管集合计算 occupied volume / multiplicity 指标（确定性）',
  input_schema: {
    type: 'object',
    required: ['tubes', 'res'],
    properties: { tubes: { type: 'array', description: 'Tube3[]（可结构化克隆）' }, res: num('体素网格 res') },
  },
  output_schema: { type: 'object', properties: { occupiedVolume: num('|⋃T|'), maxMultiplicity: num('max m') } },
  runtime: 'worker',
  evidence_type: 'CALCULATED',
  dependencies: ['kakeya/voxels3d.ts', 'workers/voxelClient.ts'],
  run: async ({ tubes, res }: { tubes: unknown; res: number }) => runCoverage(tubes as Tube3[], res, 0),
})

registerSkill({
  id: 'measure.perron_area',
  family: 'measure',
  title: '测量 Perron 树面积',
  description: '构造 Perron 树并栅格化实测面积',
  input_schema: { type: 'object', required: ['k', 'alpha'], properties: { k: num('细分层数'), alpha: num('重叠比'), raster: num('栅格分辨率') } },
  output_schema: { type: 'object', properties: { computedArea: num('实测面积'), boundArea: num('理论上界') } },
  runtime: 'main',
  evidence_type: 'CALCULATED',
  dependencies: ['kakeya/perron.ts'],
  run: ({ k, alpha, raster }: { k: number; alpha: number; raster?: number }) => {
    const r = perronTree(k, alpha, raster ?? 800)
    const { triangles: _t, medians: _m, ...out } = r
    return out
  },
})

// ---- compare -----------------------------------------------------------------

export interface CompareMetricsInput {
  label: string
  delta: number
  nTubes: number
  packing: number
  occupiedVolume: number
  sumTubeVolume: number
  maxMultiplicity: number
  avgMultiplicity: number
}

export interface CompareRow {
  metric: string
  a: number
  b: number
  delta: number
  relChange: number
}

registerSkill({
  id: 'compare.configurations',
  family: 'compare',
  title: '对比两个构型',
  description: '对两份快照指标做逐项差值对比（空间对比卡的数据源）',
  input_schema: {
    type: 'object',
    required: ['a', 'b'],
    properties: { a: { type: 'object', description: '快照 A 指标' }, b: { type: 'object', description: '快照 B 指标' } },
  },
  output_schema: { type: 'object', properties: { rows: { type: 'array', description: 'CompareRow[]' } } },
  runtime: 'main',
  evidence_type: 'CALCULATED',
  dependencies: ['skills/types.ts'],
  run: ({ a, b }: { a: unknown; b: unknown }) => {
    const A = a as CompareMetricsInput
    const B = b as CompareMetricsInput
    const metrics: Array<[string, (m: CompareMetricsInput) => number, (m: CompareMetricsInput) => string]> = [
      ['|⋃T| occupied volume', (m) => m.occupiedVolume, (m) => m.occupiedVolume.toFixed(4)],
      ['Σ|T| sum tube volume', (m) => m.sumTubeVolume, (m) => m.sumTubeVolume.toFixed(4)],
      ['重叠率 overlap %', (m) => 1 - (m.occupiedVolume / Math.max(1e-12, m.sumTubeVolume)), (m) => `${(100 * (1 - m.occupiedVolume / Math.max(1e-12, m.sumTubeVolume))).toFixed(1)}%`],
      ['max multiplicity', (m) => m.maxMultiplicity, (m) => String(m.maxMultiplicity)],
      ['avg multiplicity', (m) => m.avgMultiplicity, (m) => m.avgMultiplicity.toFixed(3)],
    ]
    const rows: CompareRow[] = metrics.map(([name, get]) => {
      const va = get(A)
      const vb = get(B)
      return { metric: name, a: va, b: vb, delta: vb - va, relChange: Math.abs(va) > 1e-12 ? (vb - va) / Math.abs(va) : 0 }
    })
    const fmt = (m: CompareMetricsInput) =>
      `δ=${m.delta.toFixed(4)} · N=${m.nTubes} · packing=${m.packing.toFixed(2)}`
    return { summaryA: fmt(A), summaryB: fmt(B), rows }
  },
})

// ---- infer (AI_INFERENCE only) --------------------------------------------------

registerSkill({
  id: 'infer.observation',
  family: 'infer',
  title: '生成观察解释',
  description: '基于 CALCULATED 数值生成解释文本（AI_INFERENCE，模板/可选本地 LLM；不产生新数字）',
  input_schema: {
    type: 'object',
    required: ['occupiedVolume', 'sumTubeVolume', 'maxMultiplicity', 'packing'],
    properties: {
      occupiedVolume: num('|⋃T|'), sumTubeVolume: num('Σ|T|'), maxMultiplicity: num('max m'),
      avgMultiplicity: num('avg m'), packing: num('packing'), delta: num('δ'),
    },
  },
  output_schema: { type: 'object', properties: { reading: str('解释文本（AI_INFERENCE）') } },
  runtime: 'main',
  evidence_type: 'AI_INFERENCE',
  dependencies: ['skills/types.ts'],
  run: (m: {
    occupiedVolume: number
    sumTubeVolume: number
    maxMultiplicity: number
    avgMultiplicity?: number
    packing: number
    delta?: number
  }) => {
    const overlap = 1 - m.occupiedVolume / Math.max(1e-12, m.sumTubeVolume)
    const regime = m.packing >= 0.6 ? 'sticky（全部过中心）' : m.packing >= 0.25 ? '中间态' : 'separated'
    return {
      regime,
      reading:
        `构型为 ${regime}：重叠率 ${(overlap * 100).toFixed(1)}%，max multiplicity = ${m.maxMultiplicity}` +
        (m.packing >= 0.6
          ? '。中心 multiplicity 峰值出现在所有管交汇处（CALCULATED 数值见观察卡）。方向仍 δ-分离；Theorem 1.2 所控制的是这种聚集造成的体积下降幅度（结论以论文原文为准）。'
          : '。管的并集体积接近 N·πδ² 的线性叠加，与"几乎最大体积"直觉一致；可继续增大 N 观察 |⋃T| 曲线拐点。'),
      disclaimer: '解释由 AI 生成（AI_INFERENCE）；数值全部来自 CALCULATED；数学结论以论文原文为准。',
    }
  },
})

registerSkill({
  id: 'infer.whatif',
  family: 'infer',
  title: '提议 What-if 实验',
  description: '按 id 返回预置的 What-if 实验提议（参数变更 + 预期观察方向）',
  input_schema: { type: 'object', required: ['whatIfId'], properties: { whatIfId: str('WHATIFS 条目 id') } },
  output_schema: { type: 'object', properties: { question: str('问题'), apply: { type: 'object', description: '参数变更' } } },
  runtime: 'main',
  evidence_type: 'AI_INFERENCE',
  dependencies: ['paper/wangZahl.ts'],
  run: ({ whatIfId }: { whatIfId: string }) => {
    const w = WHATIFS.find((x) => x.id === whatIfId)
    if (!w) throw new Error(`unknown what-if '${whatIfId}'`)
    return { question: w.question, body: w.body, apply: w.apply ?? [] }
  },
})

// ---- trace -------------------------------------------------------------------

export interface TraceChainNode {
  kind: 'param' | 'cell' | 'skill' | 'paper'
  id: string
  version?: number
  stale?: boolean
  detail: string
}

const TRACE_TARGETS: Record<string, { params: string[]; cells: string[]; skills: string[]; papers: string[] }> = {
  'kakeya.voxel': {
    params: ['kakeya.deltaExp', 'kakeya.nTubes', 'kakeya.packing', 'kakeya.voxelRes'],
    cells: ['kakeya.delta', 'kakeya.dirs', 'kakeya.minSep', 'kakeya.tubes', 'kakeya.voxel'],
    skills: ['simulate.kakeya_tubes', 'measure.coverage', 'verify.invariants'],
    papers: ['thm-1.2', 'def-wolff-axioms', 'def-delta-tube'],
  },
  'perron.tree': {
    params: ['perron.k', 'perron.alpha'],
    cells: ['perron.tree'],
    skills: ['measure.perron_area', 'verify.invariants'],
    papers: ['c-perron', 'f-perron-bound'],
  },
}

registerSkill({
  id: 'trace.evidence',
  family: 'trace',
  title: '证据链溯源',
  description: '对指定目标输出 参数→cell→技能→论文 的完整证据链（含版本戳）',
  input_schema: { type: 'object', required: ['target'], properties: { target: str("目标 id，如 'kakeya.voxel'") } },
  output_schema: { type: 'object', properties: { chain: { type: 'array', description: 'TraceChainNode[]' } } },
  runtime: 'main',
  evidence_type: 'CALCULATED',
  dependencies: ['runtime/cell.ts', 'skills/types.ts', 'paper/wangZahl.ts'],
  run: ({ target }: { target: string }) => {
    const spec = TRACE_TARGETS[target]
    if (!spec) throw new Error(`unknown trace target '${target}'`)
    const cells = new Map(kakeya.describe().map((c) => [c.id, c]))
    const chain: TraceChainNode[] = []
    for (const p of spec.params) {
      chain.push({ kind: 'param', id: p, version: cells.get(p)?.version, detail: `value = ${JSON.stringify(kakeya.get(p).value)}` })
    }
    for (const c of spec.cells) {
      const cell = cells.get(c)
      chain.push({ kind: 'cell', id: c, version: cell?.version, stale: cell?.stale, detail: `deps = ${(cell?.deps ?? []).join(', ') || '—'}` })
    }
    for (const s of spec.skills) {
      const runs = getEvidenceLog().filter((r) => r.skillId === s)
      chain.push({ kind: 'skill', id: s, detail: runs.length ? `最近运行 #${runs[runs.length - 1].seq}（${runs[runs.length - 1].durationMs}ms）` : '尚未运行' })
    }
    for (const p of spec.papers) chain.push({ kind: 'paper', id: p, detail: 'PAPER 引文（可在论文中定位）' })
    return { target, chain }
  },
})

// ---- verify -------------------------------------------------------------------

export interface VerifyCheck {
  name: string
  pass: boolean
  detail: string
}

registerSkill({
  id: 'verify.invariants',
  family: 'verify',
  title: '不变量校验',
  description: '对当前 CALCULATED 结果运行确定性不变量检查',
  input_schema: {
    type: 'object',
    required: ['metrics', 'packing', 'nTubes'],
    properties: {
      metrics: { type: 'object', description: 'VoxelMetrics' },
      packing: num('packing'), nTubes: num('N'),
      perronComputedArea: num('Perron 实测面积'), perronTriangleArea: num('原三角形面积'),
    },
  },
  output_schema: { type: 'object', properties: { checks: { type: 'array', description: 'VerifyCheck[]' }, allPass: { type: 'boolean', description: '是否全部通过' } } },
  runtime: 'main',
  evidence_type: 'CALCULATED',
  dependencies: ['kakeya/voxels3d.ts', 'kakeya/perron.ts'],
  run: (i: {
    metrics: unknown
    packing: number
    nTubes: number
    perronComputedArea?: number
    perronTriangleArea?: number
  }) => {
    const m = i.metrics as VoxelMetrics
    const checks: VerifyCheck[] = [
      {
        name: '|⋃T| ≤ Σ|T|（次可加性）',
        pass: m.occupiedVolume <= m.sumTubeVolume + 1e-9,
        detail: `${m.occupiedVolume.toFixed(5)} ≤ ${m.sumTubeVolume.toFixed(5)}`,
      },
      {
        name: 'avg multiplicity ≥ 1',
        pass: m.avgMultiplicity >= 1 - 1e-6,
        detail: `avg m = ${m.avgMultiplicity.toFixed(3)}`,
      },
      {
        name: '单管体积 ≈ 解析胶囊值（±25%，分辨率充分性）',
        pass: Math.abs(m.sumTubeVolume / Math.max(1, i.nTubes) - m.analyticPerTube) / m.analyticPerTube < 0.25,
        detail: `voxel ${(m.sumTubeVolume / Math.max(1, i.nTubes)).toFixed(5)} vs analytic ${m.analyticPerTube.toFixed(5)}`,
      },
    ]
    if (i.packing >= 1) {
      checks.push({
        name: 'sticky（packing=1）⇒ max m = N',
        pass: m.maxMultiplicity === i.nTubes,
        detail: `max m = ${m.maxMultiplicity}, N = ${i.nTubes}`,
      })
    }
    if (typeof i.perronComputedArea === 'number' && typeof i.perronTriangleArea === 'number') {
      checks.push({
        name: 'Perron 实测面积 ≤ 原三角形面积（+栅格容差）',
        pass: i.perronComputedArea <= i.perronTriangleArea * 1.02,
        detail: `${i.perronComputedArea.toFixed(4)} ≤ ${i.perronTriangleArea.toFixed(4)}`,
      })
    }
    return { checks, allPass: checks.every((c) => c.pass), ranAt: Date.now() }
  },
})

registerSkill({
  id: 'verify.pyodide_numpy',
  family: 'verify',
  title: 'NumPy 交叉验证（Pyodide，可选）',
  description: '在 Pyodide 中用 NumPy 种子化蒙特卡洛独立复算单管胶囊体积，与解析公式互验',
  input_schema: {
    type: 'object',
    required: ['delta'],
    properties: { delta: num('δ（0.05–0.15 内效果最好）'), samples: num('MC 样本数'), seed: num('随机种子') },
  },
  output_schema: { type: 'object', properties: { available: { type: 'boolean', description: 'Pyodide 是否可用' }, pass: { type: 'boolean', description: '相对误差 < 3%' } } },
  runtime: 'pyodide-worker',
  evidence_type: 'CALCULATED',
  dependencies: ['workers/pyodide.worker.ts（CDN Pyodide v0.27.7，可选运行时）'],
  optional: true,
  run: async ({ delta, samples, seed }: { delta: number; samples?: number; seed?: number }) => {
    if (!isPyodideWorkerAvailable()) {
      return { available: false, reason: '当前环境无 Worker' }
    }
    const n = samples ?? 1_500_000 // δ=0.0625 needs ≳1M samples for σ_rel ≲1%
    const py = [
      'import numpy as np, json',
      `delta = ${delta}`,
      `n = ${n}`,
      `seed = ${seed ?? 20250224}`,
      'rng = np.random.default_rng(seed)',
      'box = 1.2',
      'p = rng.uniform(-box/2, box/2, (n, 3))',
      'd = np.array([0.0, 0.0, 1.0])',
      's = np.clip(p @ d, -0.5, 0.5)',
      'q = p - s[:, None] * d',
      'r2 = (q * q).sum(axis=1)',
      'hits = float((r2 <= delta * delta).mean())',
      'mc = hits * box ** 3',
      'analytic = float(np.pi * delta ** 2 + (4/3) * np.pi * delta ** 3 / 2)',
      'rel = float(abs(mc - analytic) / analytic)',
      'json.dumps({"mc": mc, "analytic": analytic, "relErr": rel, "pass": bool(rel < 0.03), "samples": n})',
    ].join('\n')
    try {
      const out = (await runPythonJson(py)) as { mc: number; analytic: number; relErr: number; pass: boolean; samples: number }
      return { available: true, ...out }
    } catch (err) {
      return { available: false, reason: `Pyodide 不可用（${String((err as Error).message).slice(0, 120)}…）— 不影响确定性内核` }
    }
  },
})
