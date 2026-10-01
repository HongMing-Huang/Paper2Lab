// Wang–Zahl paper knowledge: every PAPER item quotes the original text and
// carries a runtime text-layer anchor (page + needle) so the pdf node can
// locate and highlight it. Editorial summaries are marked AI INFERENCE.
// Paper: arXiv:2502.17655 (local: public/papers/wang-zahl-kakeya3d.pdf)

export type Provenance = 'PAPER' | 'CALCULATED' | 'AI INFERENCE'

export interface PaperAnchor {
  /** 1-based page number in the bundled PDF */
  page: number
  /** distinctive plain-text needle found in that page's text layer */
  needle: string
}

export const PAPER_META = {
  title: 'Volume estimates for unions of convex sets, and the Kakeya set conjecture in three dimensions',
  authors: 'Hong Wang (NYU) · Joshua Zahl (UBC)',
  arxiv: 'https://arxiv.org/abs/2502.17655',
  file: '/papers/wang-zahl-kakeya3d.pdf',
  date: '2025-02-24',
  abstract:
    'We study sets of δ tubes in R³, with the property that not too many tubes can be contained inside a common convex set V. We show that the union of tubes from such a set must have almost maximal volume. As a consequence, we prove that every Kakeya set in R³ has Minkowski and Hausdorff dimension 3.',
} as const

export interface TheoremItem {
  id: string
  label: string
  title: string
  quote: string
  commentary: string
  tex?: string
  anchor: PaperAnchor
}

export const THEOREMS: TheoremItem[] = [
  {
    id: 'thm-1.1',
    label: 'THEOREM 1.1',
    title: '三维 Kakeya 集猜想',
    quote:
      'Every Kakeya set in R³ has Minkowski and Hausdorff dimension 3.',
    commentary:
      '本文主定理：R³ 中任何 Kakeya 集（含每个方向单位线段的紧集）的 Minkowski 维数与 Hausdorff 维数都是 3。Davies (1971) 证明了 n=2 情形；三维情形自 Besicovitch (1919) 以来悬置逾百年。',
    tex: '\\dim_H K \\;=\\; \\dim_M K \\;=\\; 3',
    anchor: { page: 3, needle: 'Every Kakeya set in R' },
  },
  {
    id: 'thm-1.2',
    label: 'THEOREM 1.2',
    title: '满足 Wolff 公理的管并集体积下界',
    quote:
      'For all ε > 0, there exists K > 1 so that the following holds for all δ > 0 sufficiently small. Let 𝕋 be a set of δ-tubes contained in the unit ball in R³, and suppose that every rectangular prism of dimensions a × b × 2 contains at most 100abδ⁻² tubes from 𝕋 (this is true, for example, if the tubes in 𝕋 point in δ-separated directions). For each T ∈ 𝕋, let Y(T) ⊂ T be a measurable set with |Y(T)| ≥ λ|T|. Then |⋃_{T∈𝕋} Y(T)| ≥ δ^ε λ^K Σ_{T∈𝕋} |T|.',
    commentary:
      '主定理的技术核心：只要管族不聚集（Wolff 公理），并集体积就"几乎最大"。Theorem 1.1 是它的推论。本 Demo 的 voxel 实验即在有限尺度验证这种现象。',
    tex:
      '\\left|\\bigcup_{T\\in\\mathbb{T}} Y(T)\\right| \\;\\geq\\; \\delta^{\\varepsilon}\\,\\lambda^{K}\\!\\sum_{T\\in\\mathbb{T}} |T|',
    anchor: { page: 3, needle: 'rectangular prism of dimensions' },
  },
  {
    id: 'def-kakeya-set',
    label: 'DEFINITION',
    title: 'Kakeya 集',
    quote:
      'A Kakeya set is a compact subset of Rⁿ that contains a unit line segment pointing in every direction.',
    commentary: '等价说法：对所有方向 θ ∈ S²，∃ 长度 1 的线段 ℓ ∥ θ 且 ℓ ⊂ K。',
    anchor: { page: 3, needle: 'unit line segment pointing in every direction' },
  },
  {
    id: 'def-delta-tube',
    label: 'DEFINITION',
    title: 'δ-tube（δ 管）',
    quote:
      '…δ-tubes in R³, i.e. the δ neighbourhoods of unit line segments…',
    commentary:
      '单管的体积 |T| ≈ δ²（单位长 × 半径 δ 的管）。本 Demo 用胶囊几何（πδ²·1 + ⅔πδ³）做标定，见 CALCULATED 公式卡。',
    tex: '|T| \\sim \\delta^{2}',
    anchor: { page: 3, needle: 'neighbourhoods of unit line segments' },
  },
  {
    id: 'def-wolff-axioms',
    label: 'DEFINITION 1.4',
    title: 'Wolff 公理（非聚集条件）',
    quote:
      'The hypothesis that each a × b × 2 rectangular prism contains at most 100abδ⁻² tubes from 𝕋 is a type of non-clustering condition. A close variant of this hypothesis was first introduced by Wolff, and sets of tubes that satisfy this hypothesis are said to satisfy the Wolff axioms.',
    commentary:
      '方向 δ-分离 ⟹ Wolff 公理成立（论文原注）。"Separated→Packed" 滑杆移动的是管的中点而非方向：方向始终 Fibonacci 球面 δ-分离，packing 只演示"聚集使并集变小、但定理限制其变小程度"。',
    anchor: { page: 3, needle: 'said to satisfy the Wolff axioms' },
  },
]

export interface FormulaItem {
  id: string
  tex: string
  caption: string
  provenance: Provenance
  note?: string
}

export const FORMULAS: FormulaItem[] = [
  {
    id: 'f-union-bound',
    tex: '\\left|\\bigcup_{T\\in\\mathbb{T}} Y(T)\\right| \\ge \\delta^{\\varepsilon}\\lambda^{K}\\sum_{T\\in\\mathbb{T}}|T|',
    caption: 'Wang–Zahl Theorem 1.2 体积下界',
    provenance: 'PAPER',
    note: 'Y(T) ⊂ T，|Y(T)| ≥ λ|T|；要求管族满足 Wolff 公理',
  },
  {
    id: 'f-dim-3',
    tex: '\\dim_H K = \\dim_M K = 3',
    caption: 'Theorem 1.1：三维 Kakeya 维数',
    provenance: 'PAPER',
  },
  {
    id: 'f-tube-vol',
    tex: '|T| \\sim \\delta^{2}',
    caption: '单管体积量级（论文记号）',
    provenance: 'PAPER',
    note: '半径 δ、长度 1 的管；忽略常数',
  },
  {
    id: 'f-capsule',
    tex: '|T| = \\pi\\delta^{2}\\cdot 1 + \\tfrac{4}{3}\\pi\\delta^{3}',
    caption: '胶囊几何体积：圆柱 + 完整球冠（CALCULATED）',
    provenance: 'CALCULATED',
    note: '两个测量量须区分：轴对齐管的端盖落在立方体外，|T ∩ 立方体| = πδ²；斜向管端盖在内，= πδ²+⁴⁄₃πδ³。早期版本把球冠体积写成半球——由 verify.pyodide_numpy 的独立 NumPy 蒙特卡洛交叉验证发现并修正（两条单测分别标定两种情形）。',
  },
  {
    id: 'f-perron-bound',
    tex: '\\mathrm{area}(\\text{Perron tree}) \\le \\left(\\alpha^{2k} + 2(1-\\alpha)\\right)\\cdot\\mathrm{area}(\\triangle)',
    caption: '2^k 子三角形、α-重叠合并的 Perron 树面积上界',
    provenance: 'PAPER',
    note: 'Besicovitch/Perron 经典构造（讲义形式）；Demo 中同时给出栅格化实测面积',
  },
]

export interface ConceptItem {
  id: string
  title: string
  body: string
  provenance: Provenance
  anchor?: PaperAnchor
  external?: string
}

export const CONCEPTS: ConceptItem[] = [
  {
    id: 'c-history',
    title: '问题简史',
    body: '1917 年 Kakeya 与 Fujiwara 问：单位针在平面上转 180° 最少需要多大面积？1919 年 Besicovitch 证明存在测度为零的 Besicovitch 集（含所有方向的单位线段）；Davies (1971) 证明二维 Kakeya 猜想（维数=2）；Wolff (1995) 证明 n 维下界 (n+2)/2；2022–24 Wang–Zahl 解决三维 sticky 情形；2025 年本文解决三维一般情形。',
    provenance: 'PAPER',
    external: 'https://arxiv.org/abs/2505.07695',
  },
  {
    id: 'c-sticky',
    title: 'Sticky Kakeya（粘性构型）',
    body: '"Sticky" 指所有 δ-tube 都穿过同一个粗点（δ-ball）的构型——它是 Kakeya 问题的极值候选，由 Wang–Zahl 在更早的两篇文章（跟随 Katz–Tao 纲领）解决。本 Demo 的 packing=1 就渲染 sticky 构型：所有管过立方体中心。',
    provenance: 'PAPER',
    anchor: { page: 3, needle: 'sticky' },
  },
  {
    id: 'c-perron',
    title: 'Perron 树：二维针在任意小的面积里转向',
    body: '把高为 1 的等边三角形按底边 2^k 等分成共顶点的子三角形，逐级把相邻组按比例 α 平移重叠（Perron 树），面积可压到 (α^{2k}+2(1−α))·A。子三角形方向覆盖不变；相邻平行边之间用 Pál join（面积可任意小）恢复针的连续运动。右侧 2D 实验卡的实测面积即由此栅格化计算。',
    provenance: 'PAPER',
    external: 'https://www.math.wustl.edu/~alanchang/teaching/mathcamp/mathcamp2020_kakeya_needle_problem.pdf',
  },
  {
    id: 'c-scaling',
    title: '为什么有限尺度实验有意义',
    body: 'Theorem 1.2 是 δ→0 的渐近命题。Demo 在 δ=2^-exp、体素 res³ 网格上做确定性有限尺度测量：occupied volume、multiplicity 直方图。当 packing 增大，方向仍 δ-分离（Wolff 公理依然成立），但管的并集体积明显下降、multiplicity 上升——定理保证这种下降不可能"太多"。这是对定理现象的数值观察，不是对定理的验证。',
    provenance: 'AI INFERENCE',
  },
]

export interface WhatIfItem {
  id: string
  question: string
  body: string
  apply?: { param: string; value: number }[]
}

export const WHATIFS: WhatIfItem[] = [
  {
    id: 'w-halve-delta',
    question: '把 δ 减半会怎样？',
    body: '方向数不变时，单管体积随 δ² 缩小；若管仍基本不重叠，|⋃T| 应按同量级缩小。试把 δ 调小一档，观察 |⋃T| 曲线与重叠率的变化（数值以页面 CALCULATED 为准）。',
    apply: [{ param: 'kakeya.deltaExp', value: 5 }],
  },
  {
    id: 'w-go-sticky',
    question: '全部过中心（sticky）会怎样？',
    body: 'packing→1 时所有管穿过立方体中心，中心处 multiplicity 出现尖峰，|⋃T| 下降到接近"管球"的体积。方向依然 δ-分离——这正是论文里需要 Wolff 公理之外的"凸集非聚集"条件来控制的部分。',
    apply: [{ param: 'kakeya.packing', value: 1 }],
  },
  {
    id: 'w-more-directions',
    question: '方向数加倍呢？',
    body: 'Fibonacci 半球面上 N 翻倍 ⇒ 最小方向间隔约 ×1/√2。若仍 ≳ δ，Wolff 公理近似成立，|⋃T| 应近似线性增长（直到接近 1）。观察 multiplicity 直方图的右尾。',
    apply: [
      { param: 'kakeya.nTubes', value: 192 },
      { param: 'kakeya.packing', value: 0 },
    ],
  },
  {
    id: 'w-perron-deep',
    question: 'Perron 树切得更细？',
    body: 'k 增大一级（子三角形×2）或 α 减小（重叠更狠），实测面积显著下降——但覆盖的方向不变。这是"单位针可在任意小面积内转向"的有限尺度版本。',
    apply: [
      { param: 'perron.k', value: 5 },
      { param: 'perron.alpha', value: 0.7 },
    ],
  },
]

// ---- question → on-desk expansions (deterministic packs; AI 只解释) ---------
export interface ExpansionNodeSpec {
  kind: 'concept' | 'theorem' | 'formula' | 'source' | 'chart' | 'whatif' | 'experiment'
  refId: string
  /** placement offset relative to the pack origin */
  offset: [number, number]
}

export interface ExpansionPack {
  id: string
  keywords: string[]
  title: string
  nodes: ExpansionNodeSpec[]
}

export const EXPANSION_PACKS: ExpansionPack[] = [
  {
    id: 'x-kakeya-what',
    keywords: ['kakeya 集', 'kakeya集', 'kakeya set', '什么是 kakeya', '猜想', 'conjecture', '介绍', 'overview', '背景'],
    title: 'Kakeya 集与猜想',
    nodes: [
      { kind: 'concept', refId: 'c-history', offset: [0, 0] },
      { kind: 'theorem', refId: 'def-kakeya-set', offset: [340, -40] },
      { kind: 'theorem', refId: 'thm-1.1', offset: [340, 300] },
      { kind: 'formula', refId: 'f-dim-3', offset: [700, 130] },
      { kind: 'source', refId: 'paper-main', offset: [0, 420] },
    ],
  },
  {
    id: 'x-volume-estimate',
    keywords: ['体积', 'volume', '估计', 'estimate', 'wolff', '公理', 'axiom', 'tube', '1.2', '管族'],
    title: '体积估计与 Wolff 公理',
    nodes: [
      { kind: 'theorem', refId: 'def-delta-tube', offset: [0, 0] },
      { kind: 'theorem', refId: 'thm-1.2', offset: [0, 260] },
      { kind: 'formula', refId: 'f-union-bound', offset: [380, 60] },
      { kind: 'theorem', refId: 'def-wolff-axioms', offset: [380, 340] },
      { kind: 'source', refId: 'paper-main', offset: [0, 620] },
    ],
  },
  {
    id: 'x-sticky',
    keywords: [
      'sticky', 'sticky kakeya', '粘性', '粘', '聚集', 'packed', 'separated', 'packing', '过中心', '分开',
    ],
    title: 'Separated → Packed / Sticky',
    nodes: [
      { kind: 'concept', refId: 'c-sticky', offset: [0, 0] },
      { kind: 'experiment', refId: 'tubes-3d', offset: [380, -60] },
      { kind: 'whatif', refId: 'w-go-sticky', offset: [0, 300] },
      { kind: 'chart', refId: 'chart-multiplicity', offset: [380, 420] },
    ],
  },
  {
    id: 'x-needle-2d',
    keywords: ['针', 'needle', '二维', '2d', 'perron', '佩龙', 'besicovitch', '旋转', '转向'],
    title: '二维针旋转与 Perron 树',
    nodes: [
      { kind: 'concept', refId: 'c-perron', offset: [0, 0] },
      { kind: 'experiment', refId: 'perron-2d', offset: [420, -40] },
      { kind: 'formula', refId: 'f-perron-bound', offset: [0, 320] },
      { kind: 'whatif', refId: 'w-perron-deep', offset: [0, 560] },
    ],
  },
]

export function findPack(question: string): ExpansionPack | null {
  const q = question.toLowerCase()
  let best: { pack: ExpansionPack; score: number } | null = null
  for (const pack of EXPANSION_PACKS) {
    let score = 0
    for (const kw of pack.keywords) if (q.includes(kw)) score += kw.length
    if (score > 0 && (!best || score > best.score)) best = { pack, score }
  }
  return best?.pack ?? null
}
