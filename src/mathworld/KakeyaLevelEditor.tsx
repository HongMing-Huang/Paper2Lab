// Kakeya level editor (CLI-130): a STRUCTURED editor for 方向之室 levels —
// edit the tube family (δ / count / length / packing), cluster membership
// (which tubes are movable, which are the FIXED scene condition), initial
// offsets, budget and the volume target; run a bounded witness search at
// preview resolution; then FREEZE the rules (validateWorld → host.activate
// as an 'edited' world) and play. The raw-JSON editor stays for other worlds.
//
// Honesty rules baked in: the origin is always relabelled 'edited' when the
// definition differs from the shipped sample; the witness search is labelled
// preview-grade (coarse grid) — the authoritative verdict is always the
// formal res/refineRes runs during play.
import { useMemo, useState } from 'react'
import type { KakeyaClusterDecl, KakeyaModel, WorldDefinition } from './definition'
import { validateWorld } from './validate'
import { host } from './host'
import { kakeyaClusterBox, kakeyaClusterMeans, kakeyaPreview } from './kernels'

type Draft = {
  title: string
  premise: string
  objective: string
  deltaExp: number
  nTubes: number
  length: number
  packing: number
  res: number
  refineRes: number
  attempts: number
  maxVolumePct: number
  convTolPct: number
  /** tube index → cluster id ('fixed' cluster included); null = unclustered */
  assignment: Array<string | null>
  clusters: Array<{ id: string; label: string; operable: boolean; ox: number; oy: number; oz: number }>
}

function draftFrom(world: WorldDefinition): Draft {
  const m = world.model as KakeyaModel
  const vol = world.goal.constraints.find((c) => c.kind === 'kakeya-volume')
  const clusters = m.clusters.map((c) => ({
    id: c.id,
    label: c.label ?? c.id,
    operable: c.operable !== false,
    ox: c.offset?.x ?? 0,
    oy: c.offset?.y ?? 0,
    oz: c.offset?.z ?? 0,
  }))
  const assignment: Array<string | null> = Array.from({ length: m.nTubes }, (_, i) => {
    const c = m.clusters.find((q) => q.tubes.includes(i))
    return c?.id ?? null
  })
  return {
    title: world.title,
    premise: world.premise,
    objective: world.objective,
    deltaExp: m.deltaExp,
    nTubes: m.nTubes,
    length: m.length,
    packing: m.packing,
    res: m.res,
    refineRes: m.refineRes,
    attempts: world.goal.attempts,
    maxVolumePct: +(vol && vol.kind === 'kakeya-volume' ? vol.maxVolume * 100 : 10).toFixed(2),
    convTolPct: +(vol && vol.kind === 'kakeya-volume' ? vol.convTol * 100 : 1).toFixed(2),
    assignment,
    clusters,
  }
}

function draftToWorld(base: WorldDefinition, d: Draft): WorldDefinition {
  const clusters: KakeyaClusterDecl[] = d.clusters.map((c) => {
    const tubes = d.assignment.map((a, i) => (a === c.id ? i : -1)).filter((i) => i >= 0)
    return {
      id: c.id,
      label: c.label || c.id,
      tubes,
      operable: c.operable,
      ...(c.ox !== 0 || c.oy !== 0 || c.oz !== 0 ? { offset: { x: c.ox, y: c.oy, z: c.oz } } : {}),
    }
  })
  const model: KakeyaModel = {
    kind: 'kakeya',
    deltaExp: d.deltaExp,
    nTubes: d.nTubes,
    length: d.length,
    packing: d.packing,
    res: d.res,
    refineRes: d.refineRes,
    clusters,
  }
  const controls = clusters
    .filter((c) => c.operable)
    .map((c) => ({ kind: 'cluster-drag' as const, id: `drag-${c.id}`, cluster: c.id, label: c.label }))
  return {
    ...base,
    title: d.title || base.title,
    premise: d.premise,
    objective: d.objective,
    origin: { kind: 'edited', note: `页面编辑的关卡（基于 ${base.id} 布局），未经来源确认` },
    model,
    controls,
    goal: {
      attempts: d.attempts,
      constraints: [
        { kind: 'kakeya-volume', id: 'vol', label: '并集体积', maxVolume: d.maxVolumePct / 100, convTol: d.convTolPct / 100 },
      ],
    },
  }
}

const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback)

export function KakeyaLevelEditor({ base, onClose }: { base: WorldDefinition; onClose: () => void }) {
  const [d, setD] = useState<Draft>(() => draftFrom(base))
  const [errors, setErrors] = useState<string[]>([])
  const [witness, setWitness] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const patch = (p: Partial<Draft>) => setD((prev) => ({ ...prev, ...p }))

  // rebuild the assignment when nTubes changes (keep existing mapping where possible)
  const tubes = useMemo(() => Array.from({ length: d.nTubes }, (_, i) => i), [d.nTubes])

  const searchWitness = () => {
    const world = draftToWorld(base, d)
    const v = validateWorld(world)
    if (!v.ok) { setWitness(null); setErrors([...v.errors, ...v.unsupported.map((u) => `不支持：${u}`)]); return }
    setErrors([])
    const m = world.model as KakeyaModel
    // bounded greedy search (preview kernel, res 22): pack every movable
    // cluster toward the centroid of the FIXED tubes, clamped to its legal box
    const result = witnessSearch(m)
    if (!result) { setWitness('未找到可放置布局（合法盒为空）——请减小 δ 或缩短管'); return }
    const opening = kakeyaPreview(m, {}, 22).occupiedVolume
    setWitness(
      `预览级见证（粗网格 res=22）：开局 ${(opening * 100).toFixed(2)}% → 最佳布局 ${(result.volume * 100).toFixed(2)}%`
      + (result.volume <= d.maxVolumePct / 100 ? ` ≤ 目标 ${d.maxVolumePct}% ✅ 可解` : ` > 目标 ${d.maxVolumePct}% ⚠️ 此布局不可解——放宽目标或重新分簇`)
      + '（正式判定以试玩中的 res/refineRes Run 为准）',
    )
  }

  const freeze = async () => {
    const world = draftToWorld(base, d)
    setBusy(true)
    const res = await host.activate(world, 'edited')
    setBusy(false)
    if (!res.ok) setErrors(res.errors)
    else onClose()
  }

  type NumKey = 'deltaExp' | 'nTubes' | 'length' | 'packing' | 'res' | 'refineRes' | 'attempts' | 'maxVolumePct' | 'convTolPct'
  const field = (label: string, key: NumKey, step: number, min: number, max: number) => (
    <label className="mw-kd-field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={String(d[key])}
        onChange={(e) => {
          const v = num(e.target.value, Number(d[key]))
          const next = { ...d, [key]: v } as Draft
          if (key === 'nTubes') {
            const n = Math.max(3, Math.min(512, Math.round(v)))
            next.nTubes = n
            next.assignment = Array.from({ length: n }, (_, i) => d.assignment[i] ?? null)
          }
          if (key === 'refineRes') next.refineRes = Math.max(Math.round(v), (next.res ?? d.res) + 8)
          setD(next)
        }}
      />
    </label>
  )

  return (
    <div className="mw-modal" role="dialog" aria-label="编辑方向之室关卡">
      <div className="mw-modal-box mw-kd-box">
        <header>
          <b>编辑方向之室关卡</b>
          <span className="mw-muted">改管族/簇/目标后「验证可解」再「冻结规则并试玩」——规则冻结后只能拖簇，目标与预算不可再改。</span>
        </header>
        <div className="mw-kd-grid">
          <label className="mw-kd-field">
            <span>标题</span>
            <input value={d.title} onChange={(e) => patch({ title: e.target.value })} />
          </label>
        </div>
        <textarea className="mw-kd-premise" value={d.premise} onChange={(e) => patch({ premise: e.target.value })} rows={2} placeholder="关卡背景（可选）" />
        <textarea className="mw-kd-objective" value={d.objective} onChange={(e) => patch({ objective: e.target.value })} rows={2} placeholder="目标一句话" />
        <div className="mw-kd-grid">
          {field('δ 指数（δ=2⁻ⁿ）', 'deltaExp', 1, 2, 8)}
          {field('管数 N', 'nTubes', 1, 3, 512)}
          {field('管长 L', 'length', 0.05, 0.3, 1)}
          {field('基准 packing', 'packing', 0.05, 0, 1)}
          {field('计分分辨率 res', 'res', 8, 16, 256)}
          {field('加密分辨率 refineRes', 'refineRes', 8, 16, 256)}
          {field('尝试预算', 'attempts', 1, 1, 50)}
          {field('体积目标（% 立方体）', 'maxVolumePct', 0.1, 1, 99)}
          {field('收敛容差（%）', 'convTolPct', 0.1, 0.1, 10)}
        </div>
        <div className="mw-kd-clusters">
          {d.clusters.map((c, ci) => (
            <div key={c.id} className={`mw-kd-cluster${c.operable ? '' : ' fixed'}`}>
              <label className="mw-kd-field">
                <span>簇名</span>
                <input value={c.label} onChange={(e) => { const next = [...d.clusters]; next[ci] = { ...c, label: e.target.value }; patch({ clusters: next }) }} />
              </label>
              <label className="mw-kd-check">
                <input type="checkbox" checked={c.operable} onChange={(e) => { const next = [...d.clusters]; next[ci] = { ...c, operable: e.target.checked }; patch({ clusters: next }) }} />
                可拖动（否则为固定簇：场景条件）
              </label>
              {(['ox', 'oy', 'oz'] as const).map((k) => (
                <label key={k} className="mw-kd-field">
                  <span>初始 {k[1]}</span>
                  <input type="number" step={0.02} value={String(c[k])} onChange={(e) => { const next = [...d.clusters]; next[ci] = { ...c, [k]: num(e.target.value, c[k]) }; patch({ clusters: next }) }} />
                </label>
              ))}
              <span className="mw-kd-count">{d.assignment.filter((a) => a === c.id).length} 管</span>
            </div>
          ))}
        </div>
        <div className="mw-kd-tubes">
          <span className="mw-muted">每根管归属（灰=未分簇，跟随基准布局不可拖）：</span>
          {tubes.map((i) => (
            <select
              key={i}
              value={d.assignment[i] ?? ''}
              onChange={(e) => { const next = [...d.assignment]; next[i] = e.target.value || null; patch({ assignment: next }) }}
              className={`mw-kd-tube${d.assignment[i] ? '' : ' none'}`}
            >
              <option value="">—</option>
              {d.clusters.map((c) => <option key={c.id} value={c.id}>{c.label}{c.operable ? '' : '（固定）'}</option>)}
            </select>
          ))}
        </div>
        {errors.length > 0 && <ul className="mw-errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        {witness && <div className="mw-kd-witness">{witness}</div>}
        <footer>
          <button onClick={onClose}>取消</button>
          <button onClick={searchWitness}>① 验证可解（预览级见证）</button>
          <button className="primary" disabled={busy} onClick={() => void freeze()}>{busy ? '校验中…' : '② 冻结规则并试玩'}</button>
        </footer>
      </div>
    </div>
  )
}

/** bounded greedy witness search on the preview kernel: every movable cluster
 *  packed toward the fixed tubes' centroid (or cube centre when there is no
 *  fixed cluster), clamped to its legal box — the same centre-directed
 *  strategy the calibration probe validated on the shipped levels. Returns the
 *  best found volume, or null when a cluster has no legal position at all. */
export function witnessSearch(m: KakeyaModel): { volume: number; offsets: Record<string, { x: number; y: number; z: number }> } | null {
  const means = kakeyaClusterMeans(m)
  const fixed = m.clusters.filter((c) => c.operable === false)
  const target = fixed.length
    ? {
        x: fixed.reduce((a, c) => a + means[c.id].x / fixed.length, 0),
        y: fixed.reduce((a, c) => a + means[c.id].y / fixed.length, 0),
        z: fixed.reduce((a, c) => a + means[c.id].z / fixed.length, 0),
      }
    : { x: 0.5, y: 0.5, z: 0.5 }
  const offsets: Record<string, { x: number; y: number; z: number }> = {}
  for (const c of m.clusters) {
    if (c.operable === false) continue
    const box = kakeyaClusterBox(m, c.id)
    if (!box) return null
    const cm = means[c.id]
    offsets[c.id] = {
      x: Math.max(box.min.x, Math.min(box.max.x, target.x - cm.x)),
      y: Math.max(box.min.y, Math.min(box.max.y, target.y - cm.y)),
      z: Math.max(box.min.z, Math.min(box.max.z, target.z - cm.z)),
    }
  }
  try {
    return { volume: kakeyaPreview(m, offsets, 22).occupiedVolume, offsets }
  } catch {
    return null
  }
}
