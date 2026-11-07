// 搬针过弯 game page (CLI-129) — keyboard/mouse → the ONE NeedleHost entry.
// Mounted at /mathworld.html#needle; the shared mathworld page and the
// Kakeya slice files (integration owner's active scope) are untouched.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { NeedleHost, type NeedleSessionState } from './needle/session'
import { NeedleScene, ACTION_KEYS } from './scene/NeedleScene'
import { checkGoal, type NeedleWorldDef } from './needle/model'
import { validateNeedleWorld } from './needle/validate'
import { StatusChip } from '../mathworld-assets'

const host = new NeedleHost()

interface CatalogEntry { file: string; world?: NeedleWorldDef; errors?: string[] }

const fmt = (v: number) => Number(v.toFixed(4)).toString()

// ---- HUD cards ----------------------------------------------------------------

function GoalCard({ s }: { s: NeedleSessionState }) {
  const used = s.history.length
  return (
    <section className="mw-card mw-goal">
      <div className="mw-origin" title={s.world.origin.note}>{s.world.origin.note}</div>
      <h1>{s.world.title}</h1>
      <p className="mw-premise">{s.world.premise}</p>
      <p className="mw-objective"><b>目标</b> {s.world.objective}</p>
      <ul className="mw-constraints">
        <li><i className={`mw-dot ${s.phase === 'won' ? 'mw-dot-pass' : ''}`} /><span className="mw-k-label">整杆入出口</span><span className="mw-k-text">两个端点都进入按半径内缩的出口区</span></li>
        <li><i className={`mw-dot ${s.phase === 'won' ? 'mw-dot-pass' : ''}`} /><span className="mw-k-label">竖直朝向</span><span className="mw-k-text">杆轴竖直（θ = 90°）</span></li>
      </ul>
      <div className={`mw-phase mw-phase-${s.phase}`}>
        {s.phase === 'won'
          ? <>通关{s.wonAtStep ? ` · 第 ${s.wonAtStep} 个接受动作达成` : ' · 当前位形满足目标'} · R 重开新局</>
          : <>已用 <b>{used}</b> / {s.model.actionBudget} 步（剩 {s.budgetLeft}）· Z 撤销返还预算 · R 重开</>}
      </div>
      <div className="mw-meter">{Array.from({ length: Math.min(40, s.model.actionBudget) }, (_, i) => <span key={i} className={i < used ? 'used' : ''} />)}</div>
      {s.world.rules && (
        <details className="mw-rules" open>
          <summary>规则与判定方式</summary>
          <ul>{s.world.rules.map((r) => <li key={r}>{r}</li>)}</ul>
        </details>
      )}
    </section>
  )
}

function ControlsCard({ s, disabled }: { s: NeedleSessionState; disabled: boolean }) {
  const goal = useMemo(() => checkGoal(s.model, s.state), [s.model, s.state])
  const m = s.model
  return (
    <section className="mw-card mw-formula">
      <div className="mw-card-label">数学对象 <StatusChip state={s.phase === 'won' ? 'ok' : 'idle'} /></div>
      <div className="mw-eqs">
        <div className="mw-eq">胶囊杆：半长 h = {fmt(m.halfLen)}，半径 r = {fmt(m.radius)}</div>
        <div className="mw-eq">状态 (cx, cy, k)：({fmt(s.state.cx)}, {fmt(s.state.cy)}, {s.state.k}) · θ = {Math.round(((s.state.k * 180) / 8) % 180)}°</div>
        <div className="mw-eq">格点 {m.cell} · 朝向档 π/8 · 场地 {m.bounds.width}×{m.bounds.height}</div>
      </div>
      <div className="mw-needle-keys">
        {[['←', 'left'], ['→', 'right'], ['↑', 'up'], ['↓', 'down'], ['Q 逆旋', 'ccw'], ['E 顺旋', 'cw']].map(([label, id]) => (
          <button key={id} disabled={disabled} onClick={() => host.act(id, { actor: 'user' })}>{label}</button>
        ))}
        <button disabled={disabled || s.history.length === 0} onClick={() => host.undo()}>Z 撤销</button>
        <button onClick={() => host.reset()}>R 重开</button>
      </div>
      <div className="mw-checks">
        <div className={`mw-check mw-check-${goal.contained ? 'pass' : 'fail'}`}>
          <div className="mw-check-head"><i className={`mw-dot ${goal.contained ? 'mw-dot-pass' : 'mw-dot-fail'}`} /><b>端点在出口内缩区</b></div>
          <div className="mw-check-why">端点余量 {fmt(goal.margins[0])} / {fmt(goal.margins[1])}（负值=在外多深）</div>
        </div>
        <div className={`mw-check mw-check-${goal.oriented ? 'pass' : 'fail'}`}>
          <div className="mw-check-head"><i className={`mw-dot ${goal.oriented ? 'mw-dot-pass' : 'mw-dot-fail'}`} /><b>竖直朝向</b></div>
          <div className="mw-check-why">当前 k={goal.orientationK}（需要 k={goal.requiredK}，即 90°）</div>
        </div>
      </div>
      <div className="mw-hint">键盘 ←→↑↓/WASD 平移、Q/E 旋转；动作即时本地判定（不等任何模型）。碰撞动作被阻止并显示接触点，不消耗预算。</div>
    </section>
  )
}

function CertificateCard({ s }: { s: NeedleSessionState }) {
  const last = s.history.at(-1)
  const lastBlocked = s.blocked.at(-1)
  return (
    <section className="mw-card mw-verdict">
      <div className="mw-card-label">动作判定（每步真实 Run）</div>
      {last && (
        <>
          <div className="mw-outcome mw-outcome-success">已接受 {last.actionId}</div>
          <ul className="mw-checks">
            <li className="mw-check mw-check-pass"><div className="mw-check-head">→ ({fmt(last.to.cx)}, {fmt(last.to.cy)}, k={last.to.k})</div></li>
          </ul>
          <div className="mw-check-scope">Run <code>{last.runId.slice(-10)}</code>（以上一步 Run 为 parent，链可追溯）</div>
        </>
      )}
      {!last && !lastBlocked && <p className="mw-muted">还没有动作：移动或旋转试试</p>}
      {lastBlocked && (
        <div className={`mw-outcome mw-outcome-${lastBlocked.status === 'blocked' ? 'fail' : 'unknown'}`}>
          {lastBlocked.status === 'blocked' ? '被阻止' : lastBlocked.status === 'unknown' ? '无法认证' : '被拒绝'}
        </div>
      )}
      {lastBlocked && <p className="mw-summary">{lastBlocked.reason}</p>}
      {s.blocked.length > 1 && (
        <details className="mw-rules">
          <summary>最近受阻动作（{s.blocked.length}）</summary>
          <ul>{[...s.blocked].reverse().slice(0, 6).map((b, i) => <li key={i}>{b.actionId}：{b.reason.slice(0, 64)}…</li>)}</ul>
        </details>
      )}
    </section>
  )
}

function SolveCard({ s }: { s: NeedleSessionState }) {
  const [busy, setBusy] = useState(false)
  const runSolve = () => {
    setBusy(true)
    // BFS is bounded but synchronous; yield a frame so the button paints
    setTimeout(() => { host.solve(); setBusy(false) }, 30)
  }
  const r = s.solve
  return (
    <section className="mw-card mw-log open">
      <div className="mw-card-label">关卡求解验证 <span className="mw-muted">（与玩家同一 transition 的 BFS）</span></div>
      <div className="mw-needle-keys">
        <button disabled={busy} onClick={runSolve}>{busy ? '求解中…' : '验证本关'}</button>
        <button onClick={() => { const v = host.verifyOwnPath(); host.noteText(v.text) }}>重放我的路径</button>
      </div>
      {r && (
        <div className="mw-solve-result">
          {r.result.status === 'solved' && <div className="mw-outcome mw-outcome-success">有解见证：{r.result.path.length} 步（重放复核通过）</div>}
          {r.result.status === 'solved' && <div className="mw-check-scope">认证净距 {fmt(r.result.minCertifiedClearance)} · 访问 {r.result.visited} 态 · Run <code>{r.runId.slice(-10)}</code></div>}
          {r.result.status === 'unsat-in-finite-graph' && <div className="mw-outcome mw-outcome-fail">本有限动作图内无解（{r.result.visited} 态，无不确定边）——不推广到连续平面</div>}
          {r.result.status === 'unknown' && <div className="mw-outcome mw-outcome-unknown">unknown（{r.result.reason === 'budget' ? '预算/超时' : `${r.result.unknownEdges} 条不确定边`}）</div>}
        </div>
      )}
    </section>
  )
}

function ActionLog({ s }: { s: NeedleSessionState }) {
  const [open, setOpen] = useState(false)
  return (
    <section className={`mw-card mw-log${open ? ' open' : ''}`}>
      <button className="mw-log-toggle" onClick={() => setOpen((v) => !v)}>动作记录 · {s.history.length} 个已接受 Run {open ? '▾' : '▸'}</button>
      {open && (
        <ol>
          {[...s.history].reverse().map((h, i) => (
            <li key={h.runId} className="mw-log-success">
              <span className="mw-log-seq">#{s.history.length - i} {h.actionId}</span>
              <span className="mw-log-params">({fmt(h.from.cx)},{fmt(h.from.cy)},k{h.from.k})→({fmt(h.to.cx)},{fmt(h.to.cy)},k{h.to.k})</span>
              <code className="mw-log-runs" title={h.runId}>{h.runId.slice(-8)}</code>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

// ---- level editor (data-driven: no page rewrite) -------------------------------

function NeedleEditor({ s, catalog, onClose }: { s: NeedleSessionState; catalog: CatalogEntry[]; onClose: () => void }) {
  const [text, setText] = useState(() => JSON.stringify(s.world, null, 2))
  const [errors, setErrors] = useState<string[]>([])
  const [solveNote, setSolveNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const apply = () => {
    let parsed: NeedleWorldDef
    try {
      parsed = JSON.parse(text)
    } catch (err) {
      setErrors([`JSON 解析失败：${err instanceof Error ? err.message : String(err)}`])
      return
    }
    const shipped = catalog.find((c) => c.world?.id === parsed.id)?.world
    if (!shipped || JSON.stringify(shipped) !== JSON.stringify(parsed)) {
      parsed = { ...parsed, origin: { kind: 'edited', note: `页面编辑的关卡定义${shipped ? `（基于开发样例 ${shipped.id}）` : ''}，未经来源确认` } }
    }
    const res = host.activate(parsed, 'edited')
    if (!res.ok) setErrors(res.errors)
    else onClose()
  }
  const verify = () => {
    let parsed: NeedleWorldDef
    try { parsed = JSON.parse(text) } catch (err) { setErrors([`JSON 解析失败：${err instanceof Error ? err.message : String(err)}`]); return }
    const v = validateNeedleWorld(parsed)
    if (!v.ok) { setErrors(v.errors); return }
    setErrors([])
    setBusy(true)
    setTimeout(() => {
      const r = host.solveFor(v.world.model)
      setSolveNote(r ? `${r.status}${r.status === 'solved' ? `：${r.path.length} 步见证（重放复核通过，认证净距 ${fmt(r.minCertifiedClearance)}）` : r.status === 'unsat-in-finite-graph' ? '：本有限动作图内无解' : `：${r.reason === 'budget' ? '预算/超时' : `${r.unknownEdges} 条不确定边`}`}` : '求解失败')
      setBusy(false)
    }, 30)
  }
  return (
    <div className="mw-modal" role="dialog" aria-label="编辑关卡定义">
      <div className="mw-modal-box">
        <header>
          <b>编辑关卡（改墙 / 出口 / 预算 → 验证有解 → 冻结试玩）</b>
          <span className="mw-muted">同一页面数据驱动：改 JSON 即新关卡，无需改代码。规则冻结于进入试玩时刻；验证与试玩用同一 transition。</span>
        </header>
        <textarea spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
        {errors.length > 0 && <ul className="mw-errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        {solveNote && <div className="mw-quality">{solveNote}</div>}
        <footer>
          <button onClick={onClose}>取消</button>
          <button disabled={busy} onClick={verify}>{busy ? '验证中…' : '验证有解'}</button>
          <button className="primary" onClick={apply}>进入试玩（冻结规则）</button>
        </footer>
      </div>
    </div>
  )
}

// ---- top bar & app ---------------------------------------------------------------

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function TopBar({ s, catalog, onEdit }: { s: NeedleSessionState | null; catalog: CatalogEntry[]; onEdit: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [, force] = useState(0)
  const local = s ? host.hasLocalSave(s.world.id) : false
  return (
    <header className="mw-top">
      <div className="mw-brand">Paper2Lab <span>搬针过弯</span></div>
      <select
        value={s?.world.id ?? ''}
        onChange={(e) => {
          const w = catalog.find((c) => c.world?.id === e.target.value)?.world
          if (w) host.activate(w, 'catalog')
        }}
      >
        {catalog.map((c) => c.world
          ? <option key={c.file} value={c.world.id}>{c.world.title}</option>
          : <option key={c.file} disabled>{c.file}（无效：{c.errors?.[0]}）</option>)}
      </select>
      <button onClick={onEdit} disabled={!s}>编辑关卡</button>
      <span className="mw-sep" />
      <button onClick={() => host.undo()} disabled={!s || s.history.length === 0}>撤销 Z</button>
      <button onClick={() => host.reset()} disabled={!s}>重开 R</button>
      <button onClick={() => s && download(`needle-${s.world.id}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, host.exportSave())} disabled={!s}>保存</button>
      <button onClick={() => fileRef.current?.click()}>读取保存</button>
      {s && local && <button onClick={() => void host.resumeLocal(s.world.id).then(() => force((n) => n + 1))}>继续本机进度</button>}
      <a className="mw-top-link" href="/mathworld.html">← 其他世界</a>
      <input
        ref={fileRef} type="file" accept="application/json,.json" hidden
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

let booted = false

export function NeedleApp() {
  const s = useSyncExternalStore(host.subscribe, host.getSession)
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [bootError, setBootError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (booted) return
    booted = true
    void (async () => {
      try {
        const base = '/assets/mathworld/needle/'
        const index = await fetch(`${base}index.json`).then((r) => {
          if (!r.ok) throw new Error(`关卡清单 HTTP ${r.status}`)
          return r.json() as Promise<{ worlds: string[] }>
        })
        const entries: CatalogEntry[] = []
        for (const file of index.worlds) {
          try {
            const raw = await fetch(`${base}${file}`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
            const v = validateNeedleWorld(raw)
            entries.push(v.ok ? { file, world: v.world } : { file, errors: v.errors })
          } catch (err) {
            entries.push({ file, errors: [`读取失败：${err instanceof Error ? err.message : String(err)}`] })
          }
        }
        setCatalog(entries)
        const want = new URLSearchParams(location.search).get('needle')
        const first = entries.find((e) => e.world && (!want || e.world.id === want)) ?? entries.find((e) => e.world)
        if (!first?.world) throw new Error(entries.map((e) => `${e.file}: ${e.errors?.join('；')}`).join(' | ') || '没有关卡')
        const res = host.activate(first.world, 'catalog')
        if (!res.ok) throw new Error(res.errors.join('；'))
      } catch (err) {
        setBootError(err instanceof Error ? err.message : String(err))
      }
    })()
  }, [])

  // keyboard → the SAME host.act entry (also used by buttons and any agent)
  const onKey = useCallback((e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
    if (editing) return
    // never hijack browser/OS shortcuts (Cmd/Ctrl+R refresh, Cmd+Z, etc.)
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const id = ACTION_KEYS[e.key]
    if (id) {
      e.preventDefault()
      host.act(id, { actor: 'user' })
      return
    }
    if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); host.undo() }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); host.reset() }
  }, [editing])
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  return (
    <div className="mw-root mw-root-needle">
      {s && <NeedleScene s={s} />}
      <TopBar s={s} catalog={catalog} onEdit={() => setEditing(true)} />
      {bootError && <div className="mw-boot-error">{bootError}</div>}
      {!s && !bootError && <div className="mw-boot">加载关卡…</div>}
      {s && (
        <>
          <div className="mw-left">
            <GoalCard s={s} />
            <ControlsCard s={s} disabled={s.phase === 'won'} />
          </div>
          <div className="mw-right">
            <CertificateCard s={s} />
            <SolveCard s={s} />
            <ActionLog s={s} />
          </div>
          {s.notice && <div key={s.notice.at} className={`mw-notice mw-notice-${s.notice.kind}`}>{s.notice.text}</div>}
          {editing && <NeedleEditor s={s} catalog={catalog} onClose={() => setEditing(false)} />}
        </>
      )}
    </div>
  )
}

export { host as needleHost }
