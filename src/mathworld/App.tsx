// MathWorld page shell (CLI-129): goal, formula handles, verdict, attempt log,
// save/restore and the world editor around the ONE scene. All actions go to
// the Host — the same entry window.__mathworld exposes for automation/agents.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { convertLatexToMarkup } from 'mathlive'
import type { Assessment, ConstraintDecl, WorldDefinition } from './definition'
import { fmt } from './goal'
import { host, tunables, type AttemptRecord, type CatalogEntry, type Session, type Tunable } from './host'
import { KakeyaLevelEditor } from './KakeyaLevelEditor'
import { WorldScene } from './scene/WorldScene'
import { GameplayHUD } from './GameplayHUD'
import { AgentDock } from '../study/AgentDock'
import '../study/agent-dock.css'

const OUTCOME_TEXT: Record<Assessment['outcome'], string> = {
  success: '满足目标',
  fail: '未满足',
  unknown: '数值不确定',
  invalid: '证据无效',
}

function Tex({ latex, display = false }: { latex: string; display?: boolean }) {
  const html = useMemo(() => {
    try {
      return convertLatexToMarkup(latex, { defaultMode: display ? 'math' : 'inline-math' })
    } catch {
      return latex
    }
  }, [latex, display])
  return <span className="mw-tex" dangerouslySetInnerHTML={{ __html: html }} />
}

function constraintText(k: ConstraintDecl, w: WorldDefinition): string {
  const out = w.model.kind === 'formula' ? w.model.output : ''
  if (k.kind === 'gate') return `${out}(${fmt(k.x)}) ∈ [${fmt(k.min)}, ${fmt(k.max)}]`
  if (k.kind === 'avoid-box') return `x∈[${fmt(k.xMin)}, ${fmt(k.xMax)}] 时避开 ${out}∈[${fmt(k.yMin)}, ${fmt(k.yMax)}]`
  if (k.kind === 'series-max') return `全程 ${k.state} ≤ ${fmt(k.max)}`
  if (k.kind === 'final-range') return `${k.min !== undefined ? `${fmt(k.min)} ≤ ` : ''}${k.state}(终点)${k.max !== undefined ? ` ≤ ${fmt(k.max)}` : ''}`
  if (k.kind === 'kakeya-volume') return `管族并集体积 ≤ ${(k.maxVolume * 100).toFixed(1)}% 立方体（加密对照容差 ${(k.convTol * 100).toFixed(2)}%）`
  return `轨迹进入 ${Object.entries(k.center).map(([n, v]) => `${n}=${fmt(v)}`).join(', ')} 半径 ${fmt(k.radius)}`
}

// ---- formula + parameter chips (scrub = preview, release = formal commit) -----

function ParamChip({ t, value, session }: { t: Tunable; value: number; session: Session }) {
  const [drag, setDrag] = useState(false)
  const [editing, setEditing] = useState(false)
  const start = useRef({ x: 0, v: 0 })
  const busy = !!session.pending
  const snap = (v: number) => Math.min(t.max, Math.max(t.min, Math.round(v / t.step) * t.step))
  if (!t.operable) {
    return (
      <span className="mw-chip fixed" title="场景条件：不可操作">
        <span className="mw-chip-name">{t.label}</span>
        <span className="mw-chip-value">{fmt(value)}</span>
        <span className="mw-chip-lock">固定</span>
      </span>
    )
  }
  if (editing) {
    return (
      <span className="mw-chip editing">
        <span className="mw-chip-name">{t.label}</span>
        <input
          autoFocus
          defaultValue={String(value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(false)
            if (e.key === 'Enter') {
              const v = Number((e.target as HTMLInputElement).value)
              setEditing(false)
              void host.commit({ [t.name]: v }, { expectedRevision: session.revision, actor: 'user' })
            }
          }}
          onBlur={() => setEditing(false)}
        />
      </span>
    )
  }
  return (
    <span
      className={`mw-chip${drag ? ' dragging' : ''}${busy ? ' busy' : ''}`}
      title={`左右拖动预览，松手正式计算；双击输入精确值。定义域 [${fmt(t.min)}, ${fmt(t.max)}]`}
      onPointerDown={(e) => {
        if (busy) return
        try {
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        } catch {
          /* synthetic events carry no active pointer */
        }
        start.current = { x: e.clientX, v: value }
        setDrag(true)
      }}
      onPointerMove={(e) => {
        if (!drag) return
        const v = snap(start.current.v + (e.clientX - start.current.x) * t.step)
        host.preview({ [t.name]: v }, v === t.min || v === t.max ? `${t.label} 已到定义域边界 ${fmt(v)}` : undefined)
      }}
      onPointerUp={() => {
        if (!drag) return
        setDrag(false)
        void host.commitPreview('user')
      }}
      onPointerCancel={() => { setDrag(false); host.endPreview() }}
      onDoubleClick={() => setEditing(true)}
    >
      <span className="mw-chip-name">{t.label}</span>
      <button type="button" className="mw-chip-step" aria-label={`减小${t.label}`} disabled={busy || value <= t.min}
        onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); void host.commit({ [t.name]: snap(value - Math.max(t.step, (t.max - t.min) / 20)) }, { expectedRevision: session.revision, actor: 'user' }) }}>−</button>
      <span className="mw-chip-value">{fmt(value)}</span>
      <button type="button" className="mw-chip-step" aria-label={`增大${t.label}`} disabled={busy || value >= t.max}
        onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); void host.commit({ [t.name]: snap(value + Math.max(t.step, (t.max - t.min) / 20)) }, { expectedRevision: session.revision, actor: 'user' }) }}>+</button>
      <span className="mw-chip-range">{fmt(t.min)}…{fmt(t.max)}</span>
    </span>
  )
}

export function FormulaCard({ s }: { s: Session }) {
  const preview = useSyncExternalStore(host.subscribePreview, host.getPreview)
  const m = s.world.model
  const values = preview?.params ?? s.params
  const tun = tunables(s.world)
  return (
    <section className="mw-card mw-formula">
      <div className="mw-card-label">数学对象 {preview ? <em className="mw-preview-badge">预览中 · 不计分</em> : null}</div>
      {m.kind === 'formula' ? (
        <div className="mw-eq"><Tex latex={`${m.output}=${m.expression}`} display /></div>
      ) : m.kind === 'ode' ? (
        <div className="mw-eqs">
          {m.states.map((st) => <div key={st.name} className="mw-eq"><Tex latex={`\\dot{${st.name}}=${m.rhs[st.name]}`} display /></div>)}
        </div>
      ) : (
        <div className="mw-kakeya-brief">
          <div className="mw-eq"><Tex latex={`\\delta = 2^{-${m.deltaExp}} \\quad N = ${m.nTubes} \\text{ 根管}`} display /></div>
          {preview?.kakeya && (
            <div className="mw-kakeya-live">
              预览并集体积 <b>{(preview.kakeya.occupiedVolume * 100).toFixed(2)}%</b> · 重数上限 {preview.kakeya.maxMultiplicity}（粗网格 · 不计分）
            </div>
          )}
        </div>
      )}
      <div className="mw-chips">
        {tun.map((t) => <ParamChip key={t.name} t={t} value={values[t.name] ?? t.min} session={s} />)}
        {m.kind === 'kakeya' && m.clusters.filter((c) => c.operable === false).map((c) => (
          <span key={c.id} className="mw-chip fixed" title="固定簇：场景条件，只能绕开它设计">
            <span className="mw-chip-name">{c.label ?? c.id}</span>
            <span className="mw-chip-value">{c.tubes.length} 管</span>
            <span className="mw-chip-lock">固定</span>
          </span>
        ))}
        {m.kind === 'ode' && m.states.filter((st) => !st.operable).map((st) => (
          <span key={st.name} className="mw-chip fixed" title="初值是场景条件：不可操作">
            <span className="mw-chip-name">{st.label ?? st.name}(t₀)</span>
            <span className="mw-chip-value">{fmt(st.initial)}</span>
            <span className="mw-chip-lock">固定</span>
          </span>
        ))}
      </div>
      <div className="mw-hint">
        {m.kind === 'formula' ? '拖动三维场景里的铜色控制点，或左右拖动参数芯片。' : m.kind === 'kakeya' ? '在三维场景里直接拖动彩色管簇（方向/长度/半径固定，只挪位置）；也可左右拖动偏移芯片。' : '左右拖动参数芯片。'}
        拖动时只预览；松手才提交一次正式计算。
      </div>
    </section>
  )
}

// ---- goal + verdict ------------------------------------------------------------

function StatusDot({ status }: { status: string }) {
  return <i className={`mw-dot mw-dot-${status}`} aria-hidden />
}

function GoalCard({ s }: { s: Session }) {
  const w = s.world
  const last = s.committed?.assessment
  const used = w.goal.attempts - s.budgetLeft
  return (
    <section className="mw-card mw-goal">
      <div className="mw-origin" title={w.origin.note}>{w.origin.note}</div>
      <h1>{w.title}</h1>
      <p className="mw-premise">{w.premise}</p>
      <p className="mw-objective"><b>目标</b> {w.objective}</p>
      <ul className="mw-constraints">
        {w.goal.constraints.map((k) => {
          const c = last?.checks.find((x) => x.constraintId === k.id)
          return (
            <li key={k.id}>
              <StatusDot status={c?.status ?? 'none'} />
              <span className="mw-k-label">{k.label ?? k.id}</span>
              <span className="mw-k-text">{constraintText(k, w)}</span>
            </li>
          )
        })}
      </ul>
      <div className={`mw-phase mw-phase-${s.phase}`}>
        {s.phase === 'playing' && <>正式尝试 <b>{used}</b> / {w.goal.attempts}（剩 {s.budgetLeft} 次）</>}
        {s.phase === 'won' && <>通关 · 第 {s.wonAtSeq} 次正式尝试达成；之后的提交是自由探索，不计分</>}
        {s.phase === 'lost' && <>{w.goal.attempts} 次正式尝试用完，挑战失败 · 点“重置”再来</>}
      </div>
      <div className="mw-meter">{Array.from({ length: w.goal.attempts }, (_, i) => <span key={i} className={i < used ? 'used' : ''} />)}</div>
      {w.rules && (
        <details className="mw-rules">
          <summary>规则与判定方式</summary>
          <ul>{w.rules.map((r) => <li key={r}>{r}</li>)}</ul>
        </details>
      )}
    </section>
  )
}

function VerdictCard({ s }: { s: Session }) {
  const a = s.committed?.assessment
  const rec = s.attempts.filter((x) => x.status === 'committed' && !x.fromFile).at(-1)
  return (
    <section className="mw-card mw-verdict">
      <div className="mw-card-label">独立判定 {s.pending && <em className="mw-pending">正式计算中…</em>}</div>
      {!a && <p className="mw-muted">尚无正式结果</p>}
      {a && (
        <>
          <div className={`mw-outcome mw-outcome-${a.outcome}`}>
            {OUTCOME_TEXT[a.outcome]}
            {rec && <span className="mw-outcome-who">{rec.actor === 'init' ? '开局观察' : rec.actor === 'restore' ? '恢复重算' : rec.exploration ? '通关后探索' : rec.seq ? `第 ${rec.seq} 次尝试` : ''}</span>}
          </div>
          <p className="mw-summary">{a.summary}</p>
          <ul className="mw-checks">
            {a.checks.map((c) => (
              <li key={c.constraintId} className={`mw-check mw-check-${c.status}`}>
                <div className="mw-check-head"><StatusDot status={c.status} /><b>{c.label}</b><span>{c.measured}</span></div>
                <div className="mw-check-why">{c.explanation}</div>
                <div className="mw-check-scope">{c.scope} · <code title={c.runIds.join('\n')}>{c.runIds.map((r) => r.split('-').slice(0, 2).join('-') + '…' + r.slice(-6)).join(' ')}</code></div>
              </li>
            ))}
          </ul>
          {a.quality && (
            <div className={`mw-quality mw-quality-${a.quality.status}`}>
              加密对照 RK4 {a.quality.steps[0]} / {a.quality.steps[1]} 步：最大差 {fmt(a.quality.maxDiff)}（容差 {fmt(a.quality.tol)}）→ {a.quality.status === 'provisional' ? '可用于判定（收敛估计，非严格界）' : '不确定'}
            </div>
          )}
          <div className="mw-evaluator">{a.evaluator}</div>
        </>
      )}
    </section>
  )
}

function attemptLabel(a: AttemptRecord): string {
  if (a.actor === 'init') return '开局'
  if (a.actor === 'restore') return '恢复'
  if (a.status === 'superseded') return '被新动作取代'
  if (a.status === 'failed') return '计算失败'
  if (a.exploration) return '探索'
  return a.seq ? `#${a.seq}${a.actor === 'agent' ? '·agent' : ''}` : '—'
}

function AttemptLog({ s }: { s: Session }) {
  const [open, setOpen] = useState(false)
  const replayIdx = useSyncExternalStore(host.subscribe, () => host.replayIdx)
  const items = [...s.attempts].map((a, i) => ({ a, i })).reverse()
  const replayable = (i: number) => s.attempts[i]?.status === 'committed' && !!s.attempts[i].assessment
  return (
    <section className={`mw-card mw-log${open ? ' open' : ''}`}>
      <button className="mw-log-toggle" onClick={() => setOpen((v) => !v)}>Run 记录 · {s.attempts.length} 条 {open ? '▾' : '▸'}</button>
      {open && (
        <ol>
          {items.map(({ a, i }) => (
            <li key={`${a.generation}-${a.at}`} className={`mw-log-${a.assessment?.outcome ?? a.status}${replayIdx === i ? ' replaying' : ''}`}>
              <span className="mw-log-seq">{attemptLabel(a)}{a.fromFile ? '·文件' : ''}</span>
              <span className="mw-log-params">{Object.entries(a.params).map(([k, v]) => `${k}=${fmt(v)}`).join(' ')}</span>
              <span className="mw-log-out">{a.assessment ? OUTCOME_TEXT[a.assessment.outcome] : a.error ?? a.status}</span>
              <code className="mw-log-runs" title={a.runIds.join('\n')}>{a.runIds.length} Run</code>
              {replayable(i) && !a.fromFile && (
                <button className="mw-log-replay" title="回放这一局的布局（只读展示，不计分不改状态）" onClick={() => (replayIdx === i ? host.exitReplay() : host.replay(i))}>
                  {replayIdx === i ? '退出回放' : '回放'}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

// ---- world editor (data-driven: no page change needed) ---------------------------

function WorldEditor({ s, catalog, onClose }: { s: Session; catalog: CatalogEntry[]; onClose: () => void }) {
  const [text, setText] = useState(() => JSON.stringify(s.world, null, 2))
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const apply = async () => {
    let parsed: WorldDefinition
    try {
      parsed = JSON.parse(text)
    } catch (err) {
      setErrors([`JSON 解析失败：${err instanceof Error ? err.message : String(err)}`])
      return
    }
    // honesty rule: anything that differs from the shipped sample is "edited"
    const shipped = catalog.find((c) => c.world?.id === parsed.id)?.world
    if (!shipped || JSON.stringify(shipped) !== JSON.stringify(parsed)) {
      parsed = { ...parsed, origin: { kind: 'edited', note: `页面编辑的世界定义${shipped ? `（基于开发样例 ${shipped.id}）` : ''}，未经来源确认` } }
    }
    setBusy(true)
    const res = await host.activate(parsed, 'edited')
    setBusy(false)
    if (!res.ok) setErrors(res.errors)
    else onClose()
  }
  return (
    <div className="mw-modal" role="dialog" aria-label="编辑世界定义">
      <div className="mw-modal-box">
        <header>
          <b>编辑世界定义（JSON）</b>
          <span className="mw-muted">改表达式、条件或目标后进入新世界——同一页面，不改代码。超出已注册内核能力的定义会被明确拒绝。</span>
        </header>
        <textarea spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
        {errors.length > 0 && <ul className="mw-errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        <footer>
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={busy} onClick={() => void apply()}>{busy ? '校验中…' : '校验并进入'}</button>
        </footer>
      </div>
    </div>
  )
}

// ---- top bar -------------------------------------------------------------------

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** CLI-112 anchor localization: build the paper link with a #page=N fragment
 *  from a structured PaperAnchor ({ page, bbox?, note? }) — PDF viewers
 *  (PDF.js, Chromium, Firefox) honour the fragment and open that page. Returns
 *  { href, label } with the page called out in the label. */
export function paperAnchorLink(paperRef: NonNullable<WorldDefinition['paperRef']>): { href: string; label: string; note: string | null } {
  const anchor = paperRef.anchor
  let href = paperRef.url
  let page: number | null = null
  let note: string | null = null
  if (anchor && typeof anchor === 'object' && Number.isInteger(anchor.page) && anchor.page >= 1) {
    page = anchor.page
    href = `${paperRef.url}#page=${page}`
    note = anchor.note ?? null
  } else if (typeof anchor === 'string' && anchor) {
    note = anchor
  }
  const label = page ? `📄 返回论文原文 · 第 ${page} 页` : '📄 返回论文原文'
  return { href, label, note }
}

function TopBar({ s, catalog, onEdit, onEditLevel }: { s: Session | null; catalog: CatalogEntry[]; onEdit: () => void; onEditLevel: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [, force] = useState(0)
  const local = s ? host.hasLocalSave(s.world.id) : false
  return (
    <header className="mw-top">
      <div className="mw-brand">Paper2Lab <span>MathWorld</span></div>
      <select
        value={s && s.origin !== 'edited' ? s.world.id : '__edited'}
        onChange={(e) => {
          const w = catalog.find((c) => c.world?.id === e.target.value)?.world
          if (w) void host.activate(w, 'catalog')
        }}
      >
        {s?.origin === 'edited' && <option value="__edited">（页面编辑）{s.world.title}</option>}
        {catalog.map((c) => c.world
          ? <option key={c.file} value={c.world.id}>{c.world.title}</option>
          : <option key={c.file} disabled>{c.file}（无效：{c.errors?.[0]}）</option>)}
      </select>
      <button onClick={onEdit} disabled={!s}>编辑世界</button>
      {s?.world.model.kind === 'kakeya' && <button className="mw-edit-level" onClick={onEditLevel} disabled={!s}>编辑关卡</button>}
      {s?.world.paperRef && (() => {
        const link = paperAnchorLink(s.world.paperRef)
        return (
          <a className="mw-paper-link" href={link.href} target="_blank" rel="noreferrer" title={link.note ?? s.world.paperRef!.title}>
            {link.label}
          </a>
        )
      })()}
      <span className="mw-sep" />
      <button onClick={() => host.undo()} disabled={!s} title="回到上一次已验证状态：恢复历史参数与判定，不产生新 Run、不扣次数">撤销</button>
      <button onClick={() => void host.reset()} disabled={!s}>重置</button>
      <button onClick={() => s && download(`mathworld-${s.world.id}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, host.exportSave())} disabled={!s}>保存结果</button>
      <button onClick={() => fileRef.current?.click()}>读取保存</button>
      {s && local && <button onClick={() => void host.resumeLocal(s.world.id).then(() => force((n) => n + 1))}>继续本机进度</button>}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          const res = await host.importSave(await f.text(), 'file')
          if (!res.ok) alert(`读取失败：${res.reason}`)
        }}
      />
    </header>
  )
}

/** the replay banner: shown whenever the scene renders a historical attempt */
function ReplayBar() {
  const replayIdx = useSyncExternalStore(host.subscribe, () => host.replayIdx)
  const session = useSyncExternalStore(host.subscribe, host.getSession)
  if (replayIdx === null || !session) return null
  const a = session.attempts[replayIdx]
  return (
    <div className="mw-replay-bar">
      回放 · {a ? `${attemptLabel(a)}（${a.assessment ? OUTCOME_TEXT[a.assessment.outcome] : a.status}）` : ''} — 只读展示该局的管簇布局，不计分、不改当前状态
      <button onClick={() => host.exitReplay()}>退出回放</button>
    </div>
  )
}

// ---- app -------------------------------------------------------------------------

let started = false

export function MathWorldApp() {
  const session = useSyncExternalStore(host.subscribe, host.getSession)
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [bootError, setBootError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [levelEditing, setLevelEditing] = useState(false)
  const [inspecting, setInspecting] = useState(false)
  const [questionRequest, setQuestionRequest] = useState<{ id: number; text: string }>()

  useEffect(() => {
    if (started) return
    started = true
    void (async () => {
      try {
        const entries = await host.loadCatalog()
        setCatalog(entries)
        // CLI-151 结果三: a world generated in the paper study space arrives
        // through a one-time localStorage handoff; it is ALWAYS activated as
        // 'edited' (never a shipped sample) and validated like any other world
        const handoff = new URLSearchParams(location.search).get('handoff')
        if (handoff && /^[A-Za-z0-9._:-]{1,80}$/.test(handoff)) {
          const key = `p2l-world-handoff:${handoff}`
          const raw = localStorage.getItem(key)
          localStorage.removeItem(key)
          if (!raw) throw new Error('来自论文研究空间的世界已被打开过或已过期——请回到研究空间重新生成')
          const res = await host.activate(JSON.parse(raw) as unknown, 'edited')
          if (!res.ok) throw new Error(`研究空间生成的世界未通过校验：${res.errors.join('；')}`)
          return
        }
        const want = new URLSearchParams(location.search).get('world')
        const first = entries.find((e) => e.world && (!want || e.world.id === want)) ?? entries.find((e) => e.world)
        if (!first?.world) throw new Error(`没有可用的世界定义：${entries.map((e) => `${e.file}: ${e.errors?.join('；')}`).join(' | ')}`)
        const res = await host.activate(first.world, 'catalog')
        if (!res.ok) throw new Error(res.errors.join('；'))
      } catch (err) {
        setBootError(err instanceof Error ? err.message : String(err))
      }
    })()
  }, [])

  useEffect(() => {
    if (!catalog.length && host.catalog.length) setCatalog(host.catalog)
  }, [catalog.length, session])

  /** CLI-151b: the agent dock's world context — REAL data only (definition,
   *  current tunables, the latest committed assessment + its Run ids). The
   *  paper prose is untrusted data for the model, never instructions. */
  const dockContext = useMemo(() => {
    if (!session) return () => ['（世界尚未激活）']
    const w = session.world
    const last = session.attempts.filter((x) => x.status === 'committed' && !x.fromFile && x.assessment).at(-1) as AttemptRecord | undefined
    return () => {
      const lines: string[] = []
      lines.push(`[世界] ${w.title}（${w.id}，origin=${w.origin.kind}）`)
      lines.push(`[前提] ${w.premise}`)
      if (w.model.kind === 'ode') {
        lines.push(`[模型·自治ODE] 状态 ${w.model.states.map((s) => s.name).join(',')}；${Object.entries(w.model.rhs).map(([s, r]) => `d${s}/dt = ${r}`).join('；')}；t∈[${w.model.tSpan}], steps=${w.model.steps}`)
      } else if (w.model.kind === 'formula') {
        lines.push(`[模型·显式函数] ${w.model.expression}，${w.model.independent}∈[${w.model.range}]`)
      } else {
        lines.push(`[模型·Kakeya] δ=2^-${w.model.deltaExp}, N=${w.model.nTubes}, length=${w.model.length}, res=${w.model.res}`)
      }
      lines.push(`[参数当前值] ${tunables(w).map((t) => `${t.name}=${session.params[t.name] ?? '?'}`).join(' ') || '（无）'}`)
      lines.push(`[目标] ${w.goal.constraints.map((c) => c.label ?? c.id).join('；')}（正式尝试剩余 ${session.budgetLeft}/${w.goal.attempts}）`)
      if (last?.assessment) {
        for (const c of last.assessment.checks) lines.push(`[判定·${c.status}] ${c.label}: 实测 ${c.measured}，要求 ${c.requirement}——${c.explanation}（Run ${c.runIds.join(',')}，方法 ${c.scope}）`)
      } else {
        lines.push('[判定] 尚无正式尝试')
      }
      if (w.paperRef) lines.push(`[论文来源] ${w.paperRef.title}（anchor=${typeof w.paperRef.anchor === 'string' ? w.paperRef.anchor : `p${w.paperRef.anchor?.page}`}）`)
      return lines
    }
  }, [session])

  const dockCard = useMemo(() => {
    const last = session?.attempts.filter((x) => x.status === 'committed' && !x.fromFile && x.assessment).at(-1) as AttemptRecord | undefined
    if (!last?.assessment) return null
    const a = last.assessment
    return {
      title: `最近判定：${a.outcome === 'success' ? '达成' : a.outcome === 'fail' ? '未满足' : a.outcome === 'unknown' ? '不确定（不判胜负）' : a.outcome} · ${last.assessment.evaluator}`,
      lines: a.checks.map((c) => `${c.status === 'pass' ? '✓' : c.status === 'unknown' ? '?' : '✗'} ${c.label}: ${c.measured}（要求 ${c.requirement}）`),
    }
  }, [session])

  return (
    <div className={`mw-root${inspecting ? ' mw-inspecting' : ' mw-playing'}`}>
      {session && <WorldScene s={session} inspecting={inspecting} />}
      <TopBar s={session} catalog={catalog} onEdit={() => setEditing(true)} onEditLevel={() => setLevelEditing(true)} />
      {bootError && <div className="mw-boot-error">{bootError}</div>}
      {!session && !bootError && <div className="mw-boot">加载世界…</div>}
      {session && (
        <>
          <div className="mw-left">
            <GameplayHUD session={session} onWhy={(text) => setQuestionRequest({ id: Date.now(), text })} onDetails={() => setInspecting(true)} />
            <FormulaCard s={session} />
            {inspecting && <GoalCard s={session} />}
          </div>
          {inspecting && <div className="mw-right">
            <button className="mw-close-details" onClick={() => setInspecting(false)}>收起详情 · 回到游玩</button>
            <VerdictCard s={session} />
            <AttemptLog s={session} />
          </div>}
          {session.notice && <div key={session.notice.at} className={`mw-notice mw-notice-${session.notice.kind}`}>{session.notice.text}</div>}
          {editing && <WorldEditor s={session} catalog={catalog} onClose={() => setEditing(false)} />}
          {levelEditing && session.world.model.kind === 'kakeya' && <KakeyaLevelEditor base={session.world} onClose={() => setLevelEditing(false)} />}
          {host.replayIdx !== null && <ReplayBar />}
        </>
      )}
      {/* CLI-151b: persistent, foldable agent dock — bottom centre, never
          covering the main operation areas; input focus pauses shortcuts */}
      <AgentDock dockId="mathworld" contextBuilder={dockContext} dataCard={dockCard} defaultOpen={false} questionRequest={questionRequest} />
    </div>
  )
}
