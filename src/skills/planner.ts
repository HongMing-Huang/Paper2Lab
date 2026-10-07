// Scientific Skills Agent — turns a question into a list of structured
// ACTIONS (never prose). Local deterministic planner; a local LLM
// (web-llm) may later replace planExperiment() but must emit the same
// Action shape (AGENTS.md §4).
export interface AgentAction {
  skill: string
  args: Record<string, unknown>
  label: string
}

export interface ExperimentPlan {
  title: string
  actions: AgentAction[]
}

/** recent-run digest the planner may cite (#24: Agent reads current
 *  experiment AND history before proposing actions) */
export interface RunSummary {
  runId: string
  params: Record<string, number>
  metrics?: Record<string, number>
}

/** a prior run whose params already match the proposed target */
function priorRunWith(history: RunSummary[], match: (params: Record<string, number>) => boolean): RunSummary | null {
  for (const r of history) {
    if (match(r.params)) return r
  }
  return null
}

/** the plan title cites it (visible in the PLAN strip) instead of presenting
 *  the configuration as new; no synthetic action is emitted (whitelist
 *  intact) */
function citePrior(prior: RunSummary | null, baseTitle: string, actions: AgentAction[]): ExperimentPlan {
  if (!prior) return { title: baseTitle, actions }
  const vol = prior.metrics?.occupiedVolume
  const volNote = vol !== undefined ? `，其 |⋃T|=${vol.toFixed(4)}` : ''
  return {
    title: `${baseTitle}（历史已有同参数实验 run …${prior.runId.slice(-6)}${volNote}——对比时应引用它）`,
    actions,
  }
}

const has = (q: string, ...keys: string[]) => keys.some((k) => q.includes(k))

export function planExperiment(
  question: string,
  current: {
    nTubes: number
    deltaExp: number
    packing: number
  },
  history: RunSummary[] = [],
): ExperimentPlan | null {
  const q = question.toLowerCase()

  if (has(q, '方向', 'direction') && has(q, '一半', '减半', '半', 'half', 'halve') || has(q, 'halve direction')) {
    const target = Math.max(8, Math.round(current.nTubes / 2))
    const prior = priorRunWith(history, (p) => p.nTubes === target)
    return citePrior(prior, `方向数减半：${current.nTubes} → ${target}`, [
      { skill: 'fork_experiment', args: { label: `Experiment B · N=${target}` }, label: `fork 当前实验` },
      { skill: 'change_parameter', args: { param: 'kakeya.nTubes', value: target }, label: `方向数 ${current.nTubes} → ${target}` },
      { skill: 'run_scale_sweep', args: {}, label: '重算 |⋃T|–N 曲线' },
      { skill: 'compare_experiments', args: {}, label: '与父实验对比指标' },
      { skill: 'explain_result', args: {}, label: '生成观察（AI INFERENCE）' },
    ])
  }

  if (has(q, '方向', 'direction', 'n') && has(q, '加倍', '双倍', '翻倍', 'double')) {
    const target = Math.min(256, current.nTubes * 2)
    const prior = priorRunWith(history, (p) => p.nTubes === target)
    return citePrior(prior, `方向数加倍：${current.nTubes} → ${target}`, [
      { skill: 'fork_experiment', args: { label: `Experiment B · N=${target}` }, label: 'fork 当前实验' },
      { skill: 'change_parameter', args: { param: 'kakeya.nTubes', value: target }, label: `方向数 ${current.nTubes} → ${target}` },
      { skill: 'compare_experiments', args: {}, label: '与父实验对比指标' },
      { skill: 'explain_result', args: {}, label: '生成观察' },
    ])
  }

  if (has(q, 'δ', 'delta', '半径', '管径') && has(q, '一半', '减半', '小', 'half', 'halve')) {
    const target = Math.min(5.5, current.deltaExp + 1)
    return {
      title: `δ 减半：2^−${current.deltaExp} → 2^−${target}`,
      actions: [
        { skill: 'fork_experiment', args: { label: `Experiment B · δ=2^−${target}` }, label: 'fork 当前实验' },
        { skill: 'change_parameter', args: { param: 'kakeya.deltaExp', value: target }, label: `δ 减半（指数 ${current.deltaExp} → ${target}）` },
        { skill: 'run_scale_sweep', args: {}, label: '重算 scaling 曲线' },
        { skill: 'compare_experiments', args: {}, label: '与父实验对比' },
        { skill: 'explain_result', args: {}, label: '生成观察' },
      ],
    }
  }

  if (has(q, 'sticky', '聚集', '过中心', 'packed', 'packing')) {
    return {
      title: '全部过中心（sticky）',
      actions: [
        { skill: 'fork_experiment', args: { label: 'Experiment B · packing=1' }, label: 'fork 当前实验' },
        { skill: 'change_parameter', args: { param: 'kakeya.packing', value: 1 }, label: 'packing → 1' },
        { skill: 'compare_experiments', args: {}, label: '与父实验对比' },
        { skill: 'explain_result', args: {}, label: '生成观察' },
      ],
    }
  }

  if (has(q, '证明', 'proof', '定理', 'theorem')) {
    return {
      title: '打开论文原文（Theorem 1.2）',
      actions: [{ skill: 'open_proof', args: { theoremId: 'thm-1.2' }, label: '定位 Theorem 1.2 原文' }],
    }
  }

  if (has(q, 'perron', '佩龙', '针', 'needle', '二维', '2d')) {
    return {
      title: 'Perron 树切细一级',
      actions: [
        { skill: 'change_parameter', args: { param: 'perron.k', value: 5 }, label: 'k → 5（32 片）' },
        { skill: 'change_parameter', args: { param: 'perron.alpha', value: 0.7 }, label: 'α → 0.70' },
        { skill: 'explain_result', args: {}, label: '生成观察' },
      ],
    }
  }

  // fallback: still an experiment, never text-only
  return {
    title: '对比 separated vs sticky',
    actions: [
      { skill: 'fork_experiment', args: { label: 'Experiment B · packing=1' }, label: 'fork 当前实验' },
      { skill: 'change_parameter', args: { param: 'kakeya.packing', value: 1 }, label: 'packing → 1' },
      { skill: 'compare_experiments', args: {}, label: '与父实验对比' },
      { skill: 'explain_result', args: {}, label: '生成观察' },
    ],
  }
}
