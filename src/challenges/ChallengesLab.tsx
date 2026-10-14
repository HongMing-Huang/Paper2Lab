// Challenges Lab — the playable 0.1 page: three levels, drag parameters,
// real compute, immediate target feedback, attempt history, best record,
// shared user/agent budget. ALL numbers on screen come from computed
// ChallengeResults (via the backend engine — same kernels the agent uses).
import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_LEVELS } from './levels'
import { attempt, createLevel, type AttemptRecord, type ChallengeExecutor, type LevelState } from './store'
import type { ChallengeResult, SceneSpec } from './levels'
import { registerImportedRun } from '../experiments/protocol'
import { authHeaders } from '../ingest/apiAuth'
import type { ProjectileResult, PendulumResult, TubesResult, ChallengeKind } from './levels'

function specToChanges(spec: SceneSpec): Record<string, number | number[]> {
  if (spec.kind === 'projectile') return { angleDeg: spec.angleDeg, speed: spec.speed }
  if (spec.kind === 'pendulum') return { length: spec.length, angleDeg: spec.angleDeg }
  return { offsets: spec.offsets }
}

const KIND_LABEL: Record<ChallengeKind, string> = {
  projectile: '投射命中',
  pendulum: '摆周期匹配',
  tubes: '管束压缩',
}

const CHALLENGE_META: Record<ChallengeKind, { goal: string; params: string[] }> = {
  projectile: { goal: '命中 22.9 m 处的目标（±0.5 m）', params: ['angleDeg', 'speed'] },
  pendulum: { goal: '把周期调到 2.0 s（±0.05 s）—— 周期由真实摆动测量', params: ['length', 'angleDeg'] },
  tubes: { goal: '把占据体积压到预算 0.28 以下（把簇向立方体中心收拢——越粘越好？未必）', params: ['offsets'] },
}

export function ChallengesLab({ onExit }: { onExit: () => void }) {
  const [kind, setKind] = useState<ChallengeKind>('projectile')
  const [state, setState] = useState<LevelState>(() => createLevel(DEFAULT_LEVELS.projectile, 20))
  const [draft, setDraft] = useState<Record<string, number | number[]>>({})
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  /** switch kind + frozen level ATOMICALLY — a render with kind≠level.kind
   *  used to read the wrong level's fields and crash (undefined.toFixed) */
  const switchLevel = useCallback((k: ChallengeKind) => {
    setKind(k)
    setState(createLevel(DEFAULT_LEVELS[k], 20))
    setDraft({})
    setNote(null)
  }, [])

  /** every attempt runs in the BACKEND ENGINE (the same kernels the agent
   *  uses) and the produced Run is imported — the page never invents numbers */
  const engineExec: ChallengeExecutor = async (spec: SceneSpec) => {
    const res = await fetch('/api/engine/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        skill: 'challenge.attempt',
        input: { challenge: spec.kind, changes: specToChanges(spec), level: { ...spec } },
        planId: `plan-challenge-${spec.kind}`,
        plan: {
          planId: `plan-challenge-${spec.kind}`,
          skill: 'challenge.attempt',
          goal: `${KIND_LABEL[spec.kind]}：冻结条件下真实内核通关`,
          metrics: ['score'],
          nonClaims: ['有限尺度挑战，不构成定理证明'],
        },
      }),
    })
    if (!res.ok) throw new Error(`engine HTTP ${res.status}`)
    const body = (await res.json()) as { outcome: { status: string; message?: string; run?: { runId: string; result: ChallengeResult } } }
    const out = body.outcome
    if (out.status !== 'ok' || !out.run) throw new Error(out.message ?? `engine returned ${out.status}`)
    registerImportedRun(out.run as never)
    return { result: out.run.result, runId: out.run.runId }
  }

  const run = useCallback(async (actor: 'user' | 'agent') => {
    setBusy(true)
    setNote(null)
    try {
      const changes: Record<string, number | number[]> =
        levelKind === 'tubes' && Array.isArray(draft.offsets)
          ? { offsets: draft.offsets }
          : Object.fromEntries(Object.entries(draft).filter(([, v]) => typeof v === 'number')) as Record<string, number>
      const rec = await attempt(state, actor, changes, engineExec)
      const r = rec.result
      if (!r) return
      if (r.kind === 'projectile') {
        setNote(r.hit
          ? `命中！落点 ${r.landingX.toFixed(2)} m（误差 ${r.error.toFixed(2)}）· +${rec.score} 分`
          : `未命中：落点 ${r.landingX.toFixed(2)} m，差 ${r.error.toFixed(2)} m —— 调整角度/力度再试`)
      } else if (r.kind === 'pendulum') {
        setNote(r.matched
          ? `匹配！实测周期 ${r.measuredPeriod!.toFixed(3)} s · +${rec.score} 分`
          : `实测周期 ${r.measuredPeriod?.toFixed(3) ?? '—'} s，目标 ${r.targetPeriod.toFixed(3)} s，差 ${(r.error ?? NaN).toFixed(3)} s —— 改杆长再试`)
      } else {
        setNote(r.withinBudget
          ? `达标！|⋃T| ${r.occupiedVolume.toFixed(4)} ≤ 预算 ${r.budget} · +${rec.score} 分`
          : `|⋃T| ${r.occupiedVolume.toFixed(4)} > 预算 ${r.budget} —— 继续压缩`)
      }
      setState({ ...state }) // re-render with the new attempt
    } catch (e) {
      setNote(`尝试失败：${e instanceof Error ? e.message : String(e)}（预算已扣）`)
      setState({ ...state })
    } finally {
      setBusy(false)
    }
  }, [state, draft, kind])

  // headless hook: level state + last feedback for the product-path script
  const stateRef = useRef(state)
  stateRef.current = state
  useEffect(() => {
    ;(window as unknown as { __P2L_CHALLENGE__?: unknown }).__P2L_CHALLENGE__ = {
      kind: () => kind,
      attempts: () => stateRef.current.attempts.length,
      best: () => stateRef.current.bestScore,
      solved: () => stateRef.current.solved,
      budget: () => stateRef.current.budgetRemaining,
      lastNote: () => note,
    }
  }, [kind, note])

  const levelKind = state.level.kind
  const meta = CHALLENGE_META[levelKind]
  const last = state.attempts[state.attempts.length - 1] as AttemptRecord | undefined

  return (
    <div className="challenges-lab">
      <div className="physics-topbar">
        <button type="button" className="desk-btn" onClick={onExit}>← 首页</button>
        {(Object.keys(KIND_LABEL) as ChallengeKind[]).map((k) => (
          <button
            key={k}
            type="button"
            className={`desk-btn${kind === k ? ' desk-btn-play' : ''}`}
            data-testid={`level-${k}`}
            onClick={() => switchLevel(k)}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <span className="physics-status">
          预算 {state.budgetRemaining} · 最佳 你 {state.bestByActor.user} / Agent {state.bestByActor.agent}
          {state.solved ? ' · ✓ 已通关' : ''}
        </span>
      </div>

      <div className="challenges-main">
        <div className="challenges-side">
          <div className="challenges-goal">
            <strong>目标</strong>：{meta.goal}
          </div>

          {levelKind === 'projectile' && (
            <>
              <ParamRow label="角度" testId="param-angleDeg" min={0} max={85} step={1} value={(typeof draft.angleDeg === 'number' ? draft.angleDeg : (state.level as { angleDeg: number }).angleDeg)} onChange={(v) => setDraft((d) => ({ ...d, angleDeg: v }))} format={(v) => `${v.toFixed(0)}°`} />
              <ParamRow label="力度 (m/s)" testId="param-speed" min={1} max={30} step={0.5} value={(typeof draft.speed === 'number' ? draft.speed : (state.level as { speed: number }).speed)} onChange={(v) => setDraft((d) => ({ ...d, speed: v }))} format={(v) => v.toFixed(1)} />
            </>
          )}
          {levelKind === 'pendulum' && (
            <>
              <ParamRow label="杆长 (m)" testId="param-length" min={0.2} max={2} step={0.005} value={(typeof draft.length === 'number' ? draft.length : (state.level as { length: number }).length)} onChange={(v) => setDraft((d) => ({ ...d, length: v }))} format={(v) => v.toFixed(3)} />
              <ParamRow label="释放角" testId="param-angleDeg" min={5} max={90} step={1} value={(typeof draft.angleDeg === 'number' ? draft.angleDeg : (state.level as { angleDeg: number }).angleDeg)} onChange={(v) => setDraft((d) => ({ ...d, angleDeg: v }))} format={(v) => `${v.toFixed(0)}°`} />
            </>
          )}
          {levelKind === 'tubes' && (
            <div className="challenges-rows" data-testid="tubes-rows">
              {(state.level as { offsets: number[] }).offsets.map((_o0, i) => {
                const offsets = (Array.isArray(draft.offsets) ? draft.offsets : (state.level as { offsets: number[] }).offsets) as number[]
                return (
                  <ParamRow key={i} label={`簇 ${i + 1} 收拢`} testId={`param-offset-${i}`} min={0} max={1} step={0.05}
                    value={offsets[i]}
                    onChange={(v) => setDraft((d) => {
                      const base = Array.isArray(d.offsets) ? (d.offsets as number[]) : (state.level as { offsets: number[] }).offsets
                      const next = [...base]
                      next[i] = v
                      return { ...d, offsets: next }
                    })}
                    format={(v) => v.toFixed(2)} />
                )
              })}
            </div>
          )}

          <div className="challenges-actions">
            <button type="button" className="desk-btn desk-btn-play" data-testid="fire" disabled={busy} onClick={() => void run('user')}>
              {busy ? '真实计算中…' : kind === 'projectile' ? '🚀 发射' : kind === 'pendulum' ? '🎬 释放摆' : '📦 压缩测量'}
            </button>
            <button type="button" className="desk-btn" data-testid="agent-try" disabled={busy} onClick={() => void run('agent')}>
              🤖 Agent 同条件尝试
            </button>
          </div>
          {note && <div className="challenges-note" data-testid="feedback">{note}</div>}
        </div>

        <div className="challenges-stage" data-testid="challenges-stage">
          {last?.result?.kind === 'projectile' && <ProjectileView r={last.result as ProjectileResult} history={state.attempts.filter((a) => a.result?.kind === 'projectile')} />}
          {last?.result?.kind === 'pendulum' && <PendulumView r={last.result as PendulumResult} />}
          {last?.result?.kind === 'tubes' && <TubesView r={last.result as TubesResult} />}
          {!last && <div className="challenges-empty">调好参数，按左侧按钮 —— 结果全部来自真实计算（CALCULATED Run）</div>}
        </div>
      </div>

      <div className="challenges-history" data-testid="attempt-history">
        {state.attempts.slice().reverse().slice(0, 10).map((a) => (
          <span key={a.attemptId} className="challenges-attempt" title={`${a.attemptId} · run ${a.runId ?? '—'}`}>
            {a.actor === 'agent' ? '🤖' : '👤'} {a.score} 分{a.result?.kind === 'projectile' && (a.result as ProjectileResult).hit ? ' ✓命中' : a.result?.kind === 'pendulum' && (a.result as PendulumResult).matched ? ' ✓匹配' : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

function ParamRow({ label, testId, min, max, step, value, onChange, format }: {
  label: string
  testId: string
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
  format: (v: number) => string
}) {
  return (
    <label className="physics-param" data-testid={testId}>
      <span style={{ width: 72, display: 'inline-block' }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1 }}
      />
      <span style={{ width: 52, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{format(value)}</span>
    </label>
  )
}

/** ground line + trajectory polyline + target marker (SVG, sampled from the run) */
function ProjectileView({ r, history }: { r: ProjectileResult; history: AttemptRecord[] }) {
  const W = 640, H = 360
  const maxX = Math.max(r.targetX + 2, ...r.x, 2)
  const maxZ = Math.max(2, ...r.z)
  const sx = (x: number) => (x / maxX) * (W - 40) + 20
  const sz = (z: number) => H - 30 - (z / maxZ) * (H - 60)
  const path = (xs: number[], zs: number[]) => xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${sx(x).toFixed(1)},${sz(zs[i]).toFixed(1)}`).join(' ')
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} data-testid="projectile-svg">
      <line x1={20} y1={H - 30} x2={W - 20} y2={H - 30} stroke="#8a7f70" strokeWidth={1.5} />
      {/* history trajectories (kept, PhET-style) */}
      {history.slice(0, -1).map((a) => a.result?.kind === 'projectile' ? (
        <path key={a.attemptId} d={path((a.result as ProjectileResult).x, (a.result as ProjectileResult).z)} fill="none" stroke="rgba(138,127,112,0.3)" strokeWidth={1.2} />
      ) : null)}
      {/* current attempt */}
      <path d={path(r.x, r.z)} fill="none" stroke="#2f5d8a" strokeWidth={2.4} />
      {/* target + tolerance band */}
      <rect x={sx(r.targetX - r.tolerance)} y={H - 42} width={sx(r.targetX + r.tolerance) - sx(r.targetX - r.tolerance)} height={12} fill="rgba(154,59,46,0.35)" />
      <line x1={sx(r.targetX)} y1={H - 48} x2={sx(r.targetX)} y2={H - 24} stroke="#9a3b2e" strokeWidth={2} />
      {/* landing point */}
      <circle cx={sx(r.landingX)} cy={H - 30} r={5} fill={r.hit ? '#2e7d4f' : '#9a3b2e'} />
      <text x={20} y={26} fontSize={13} fill="#433c33">
        {r.hit ? '命中' : '未命中'}：落点 {r.landingX.toFixed(2)} m · 误差 {r.error.toFixed(2)} m · {r.score} 分
      </text>
    </svg>
  )
}

/** θ(t) trace with the measured period marked between crossings */
function PendulumView({ r }: { r: PendulumResult }) {
  const W = 640, H = 360
  const maxT = r.t[r.t.length - 1] || 1
  const maxA = Math.max(0.2, ...r.theta.map(Math.abs))
  const sx = (t: number) => (t / maxT) * (W - 40) + 20
  const sy = (a: number) => H / 2 - (a / maxA) * (H / 2 - 40)
  const d = r.theta.map((a, i) => `${i === 0 ? 'M' : 'L'}${sx(r.t[i]).toFixed(1)},${sy(a).toFixed(1)}`).join(' ')
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} data-testid="pendulum-svg">
      <line x1={20} y1={H / 2} x2={W - 20} y2={H / 2} stroke="#8a7f70" strokeDasharray="4 4" />
      <path d={d} fill="none" stroke="#2f5d8a" strokeWidth={2} />
      <text x={20} y={26} fontSize={13} fill="#433c33">
        实测周期 {r.measuredPeriod?.toFixed(3) ?? '—'} s（目标 {r.targetPeriod.toFixed(3)}，差 {r.error?.toFixed(3) ?? '—'}）· {r.matched ? '✓ 匹配' : '未匹配'} · {r.score} 分
      </text>
    </svg>
  )
}

function TubesView({ r }: { r: TubesResult }) {
  const pct = Math.min(100, r.occupiedVolume * 100)
  const budgetPct = r.budget * 100
  return (
    <div style={{ padding: 28 }} data-testid="tubes-bars">
      <div style={{ fontSize: 14, marginBottom: 10 }}>
        |⋃T| = {r.occupiedVolume.toFixed(4)} · 预算 {r.budget} · {r.withinBudget ? '✓ 达标' : '超出'} · {r.score} 分
      </div>
      <div style={{ position: 'relative', height: 28, background: 'rgba(138,127,112,0.2)', borderRadius: 4 }}>
        <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: r.withinBudget ? '#2e7d4f' : '#9a3b2e', borderRadius: 4 }} />
        <div style={{ position: 'absolute', left: `${budgetPct}%`, top: -4, bottom: -4, width: 2, background: '#433c33' }} />
      </div>
      <div style={{ fontSize: 11, color: '#8a7f70', marginTop: 8 }}>逐簇偏移 → 真实体素计数（同一内核 Agent 共用）</div>
    </div>
  )
}
