// J1.2b — the Research Console: one page where the user asks a research
// question, watches the real Qwen agent call the science tools (live tool
// trace with committed runs), reads its answer, and continues the session.
// Every number shown traces to a committed ExperimentRun from /api/v1/science;
// the AI's own words are always labeled as the model's answer.
//
// Non-AI local actions (fork with explicit parameters) are explicit,
// separately labeled buttons — never presented as the agent's work.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './research.css'

interface ToolStepView {
  seq: number
  kind: 'tool_call' | 'tool_result'
  name: string
  callId: string
  arguments?: unknown
  isError?: boolean
  text?: string
  meta?: { run?: { runId?: string; kind?: string; status?: string; metrics?: Record<string, number>; params?: Record<string, number> } }
}

interface TurnView {
  turnId: number
  taskId: number
  sessionId: string
  prompt: string
  status: string
  finishReason: string | null
  finalResponse: string | null
  steps: ToolStepView[]
  assistantTexts: Array<{ turn: number; text: string }>
  usage: Array<Record<string, unknown>>
  runIds: string[]
  provider: string
  model: string
  error: string | null
}

interface RunView {
  runId: string
  kind: string
  status: string
  parentRunId: string | null
  params: Record<string, number>
  metrics: Record<string, number>
  arrays: Record<string, number>
  points?: Array<{ x: number; y: number }>
}

const RESEARCH_BASE = '/api/v1/research'
const SCIENCE_BASE = '/api/v1/science'

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return res.json() as Promise<T>
}

function RunChart({ run }: { run: RunView }) {
  const points = run.points ?? []
  if (points.length < 2) return null
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys, 0)
  const maxY = Math.max(...ys, 0)
  const W = 320
  const H = 120
  const sx = (x: number) => ((x - minX) / (maxX - minX || 1)) * (W - 8) + 4
  const sy = (y: number) => H - 4 - ((y - minY) / (maxY - minY || 1)) * (H - 8)
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ')
  return (
    <svg width={W} height={H} className="research-run-chart" role="img" aria-label={`run ${run.runId} curve`}>
      <path d={path} fill="none" stroke="#2563eb" strokeWidth="1.5" />
      <line x1={4} x2={W - 4} y1={sy(0)} y2={sy(0)} stroke="#d1d5db" strokeDasharray="3 3" />
    </svg>
  )
}

function StepRow({ step }: { step: ToolStepView }) {
  if (step.kind === 'tool_call') {
    return (
      <li className="research-step call">
        <span className="research-step-badge">调用</span>
        <code>{step.name}</code>
        <span className="research-step-args">{JSON.stringify(step.arguments ?? {}).slice(0, 220)}</span>
      </li>
    )
  }
  const run = step.meta?.run
  return (
    <li className={`research-step result${step.isError ? ' error' : ''}`}>
      <span className="research-step-badge">{step.isError ? '失败' : '结果'}</span>
      {run ? (
        <span className="research-step-run">
          <code>{run.runId}</code> {run.kind} · {Object.entries(run.params ?? {}).map(([k, v]) => `${k}=${v}`).join(' ')} ·{' '}
          {Object.entries(run.metrics ?? {}).map(([k, v]) => (
            <span key={k} className="research-metric">{k}=<b>{typeof v === 'number' ? Number(v.toPrecision(8)) : String(v)}</b></span>
          ))}
        </span>
      ) : (
        <span className="research-step-text">{(step.text ?? '').slice(0, 260)}</span>
      )}
    </li>
  )
}

export function ResearchConsole({ onExit }: { onExit: () => void }) {
  const [health, setHealth] = useState<{ ok: boolean; configured: boolean; dshInstalled: boolean; model: string | null } | null>(null)
  const [turns, setTurns] = useState<TurnView[]>([])
  const [activeTurn, setActiveTurn] = useState<TurnView | null>(null)
  const [runs, setRuns] = useState<Record<string, RunView>>({})
  const [prompt, setPrompt] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const traceRef = useRef<HTMLDivElement>(null)

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await getJson(`${RESEARCH_BASE}/health`))
    } catch (err) {
      setHealth({ ok: false, configured: false, dshInstalled: false, model: null })
      setNotice(`研究后端不可达：${err instanceof Error ? err.message : err}（需启动 server/node/main.ts，默认 8790）`)
    }
  }, [])

  const refreshTurns = useCallback(async () => {
    try {
      const data = await getJson<{ turns: TurnView[] }>(`${RESEARCH_BASE}/turns?limit=50`)
      setTurns(data.turns)
      const active = data.turns.find((t) => t.status === 'running' || t.status === 'queued')
      if (active) setActiveTurn(active)
      else if (sessionId === null && data.turns.length > 0) setSessionId(data.turns[0].sessionId || null)
    } catch {
      /* health notice already covers an unreachable backend */
    }
  }, [sessionId])

  const loadRuns = useCallback(async (ids: string[]) => {
    const missing = ids.filter((id) => !runs[id])
    if (missing.length === 0) return
    const next: Record<string, RunView> = {}
    await Promise.all(
      missing.slice(0, 12).map(async (id) => {
        try {
          const data = await getJson<{ run: { runId: string; kind: string; status: string; parentRunId: string | null; spec: { params?: Record<string, unknown> }; result: Record<string, unknown>; engine: string } }>(`${SCIENCE_BASE}/runs/${encodeURIComponent(id)}`)
          const result = data.run.result as Record<string, unknown>
          const numericParams = Object.fromEntries(Object.entries(data.run.spec.params ?? {}).filter(([, v]) => typeof v === 'number')) as Record<string, number>
          next[id] = {
            runId: data.run.runId,
            kind: data.run.kind,
            status: data.run.status,
            parentRunId: data.run.parentRunId,
            params: numericParams,
            metrics: Object.fromEntries(Object.entries(result).filter(([, v]) => typeof v === 'number')) as Record<string, number>,
            arrays: Object.fromEntries(Object.entries(result).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).length])),
            points: Array.isArray(result.points) ? (result.points as Array<{ x: number; y: number }>).slice(0, 800) : undefined,
          }
        } catch {
          /* a referenced run may have been truncated server-side; skip it */
        }
      }),
    )
    if (Object.keys(next).length > 0) setRuns((prev) => ({ ...prev, ...next }))
  }, [runs])

  useEffect(() => {
    void refreshHealth()
    void refreshTurns()
    // preload the workspace's committed runs so the sidebar shows evidence
    // even before the first AI turn references them
    void (async () => {
      try {
        const data = await getJson<{ runs: Array<{ record: { runId: string } }> }>(`${SCIENCE_BASE}/runs?limit=10`)
        await loadRuns(data.runs.map((r) => r.record.runId))
      } catch {
        /* backend unreachable — the health notice covers it */
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // poll the active turn until terminal, then load its runs
  useEffect(() => {
    if (!activeTurn || (activeTurn.status !== 'running' && activeTurn.status !== 'queued')) return
    const timer = setInterval(async () => {
      try {
        const t = await getJson<TurnView>(`${RESEARCH_BASE}/turns/${activeTurn.turnId}`)
        setActiveTurn(t)
        setTurns((prev) => prev.map((p) => (p.turnId === t.turnId ? t : p)))
        if (t.status !== 'running' && t.status !== 'queued') {
          setBusy(false)
          setSessionId(t.sessionId || sessionId)
          void loadRuns(t.runIds)
          void refreshHealth()
        }
      } catch {
        /* transient; the next tick retries */
      }
    }, 1200)
    return () => clearInterval(timer)
  }, [activeTurn, loadRuns, refreshHealth, sessionId])

  useEffect(() => {
    traceRef.current?.scrollTo({ top: traceRef.current.scrollHeight })
  }, [activeTurn?.steps.length, activeTurn?.finalResponse])

  const submit = useCallback(async () => {
    const text = prompt.trim()
    if (!text || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch(`${RESEARCH_BASE}/turns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: text, ...(sessionId ? { sessionId } : {}) }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`)
      setActiveTurn({ turnId: body.turnId, taskId: body.taskId, sessionId: body.sessionId ?? '', prompt: text, status: 'queued', finishReason: null, finalResponse: null, steps: [], assistantTexts: [], usage: [], runIds: [], provider: '', model: '', error: null })
      if (body.sessionId) setSessionId(body.sessionId)
      setPrompt('')
    } catch (err) {
      setNotice(`提交失败：${err instanceof Error ? err.message : err}`)
      setBusy(false)
    }
  }, [prompt, busy, sessionId])

  /** explicit NON-AI local fork: the user's own parameter change, labeled as
   *  such — never presented as the agent's action. Follows the operation to
   *  its COMMITTED receipt and loads the new run — a submitted fork is not
   *  "done" until the transactional publish actually happened. */
  const localFork = useCallback(async (runId: string, param: string, factor: number) => {
    setNotice(`本地 fork 计算中（非 AI：${param} ×${factor}）…`)
    try {
      const res = await fetch(`${SCIENCE_BASE}/operations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operationId: `ui-fork-${runId}-${param}-x${factor}-${Date.now().toString(36)}`, skill: 'experiment.fork', input: { sourceRunId: runId, parameterChanges: {} }, parameterScale: { [param]: factor } }),
      })
      const body = await res.json()
      if (!res.ok && res.status !== 202) throw new Error(body.message ?? `HTTP ${res.status}`)
      // poll the operation to its terminal state
      const deadline = Date.now() + 60_000
      let runId2: string | null = null
      let state = String(body.status ?? '')
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 600))
        const op = await getJson<{ status: string; runId: string | null; receipt?: { message?: string } }>(`${SCIENCE_BASE}/operations/${encodeURIComponent(body.operationId)}`)
        state = op.status
        if (state === 'completed') { runId2 = op.runId; break }
        if (state === 'error' || state === 'cancelled' || state === 'needs_input' || state === 'unsupported') {
          throw new Error(op.receipt?.message ?? state)
        }
      }
      if (!runId2) throw new Error(`60s 内未收到正式回执（状态 ${state}）`)
      await loadRuns([runId2])
      setNotice(`本地 fork 已正式提交（非 AI）：新 Run ${runId2}（${param} ×${factor}）`)
    } catch (err) {
      setNotice(`本地 fork 失败：${err instanceof Error ? err.message : err}`)
    }
  }, [loadRuns])

  const committedRuns = useMemo(() => Object.values(runs).sort((a, b) => (a.runId < b.runId ? 1 : -1)), [runs])

  return (
    <div className="research-root">
      <header className="research-header">
        <button type="button" className="research-exit" onClick={onExit}>← 返回</button>
        <h1>研究控制台</h1>
        <span className={`research-provider${health?.ok ? ' ok' : ' blocked'}`}>
          {health === null ? '…' : health.ok ? `Qwen · ${health.model}` : health.configured ? 'DSH 未就绪' : '未配置凭据（真实 AI 回合将被阻塞，如实用错误返回）'}
        </span>
      </header>

      <div className="research-main">
        <section className="research-chat">
          <div className="research-history">
            {turns.length === 0 && <p className="research-empty">向论文研究助手提问——例如「用公式实验验证 a=2 时 y=a·sin(bx) 的峰值，再把 a 翻倍对比」。助手通过真实科学工具计算，每个数字都来自可追溯的 Run。</p>}
            {turns.slice().reverse().map((t) => (
              <article key={t.turnId} className={`research-turn ${t.status}`}>
                <div className="research-turn-prompt">{t.prompt}</div>
                {t.steps.length > 0 && (
                  <ul className="research-steps">
                    {t.steps.map((s) => <StepRow key={`${s.kind}-${s.callId}-${s.seq}`} step={s} />)}
                  </ul>
                )}
                {t.finalResponse && <div className="research-answer"><span className="research-answer-tag">模型回答（{t.model || t.provider || 'AI'}）</span>{t.finalResponse}</div>}
                {t.error && <div className="research-error">{t.error}</div>}
                {t.status === 'running' && <div className="research-running"><span className="home-spin">◌</span> 模型正在研究…</div>}
              </article>
            ))}
            <div ref={traceRef} />
          </div>
          <div className="research-ask">
            <textarea
              value={prompt}
              placeholder="研究问题（同一会话会带上之前的 Run 上下文）…"
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
              }}
              rows={3}
              disabled={busy}
            />
            <div className="research-ask-row">
              <span className="research-session">{sessionId ? `会话 ${sessionId.slice(0, 14)}…` : '新会话'}</span>
              {sessionId && (
                <button type="button" className="research-newsession" onClick={() => { setSessionId(null); setTurns([]); setRuns({}) }}>开新会话</button>
              )}
              <button type="button" className="research-submit" onClick={() => void submit()} disabled={busy || prompt.trim().length === 0}>
                {busy ? '研究中…' : '提问（⌘↵）'}
              </button>
            </div>
            {notice && <div className="research-notice">{notice}</div>}
          </div>
        </section>

        <aside className="research-runs">
          <h2>已提交的 Run（CALCULATED）</h2>
          {committedRuns.length === 0 && <p className="research-empty">尚无 Run。助手实验后，这里显示可追溯的曲线与指标。</p>}
          {committedRuns.map((r) => (
            <div key={r.runId} className="research-run">
              <div className="research-run-head">
                <code>{r.runId}</code>
                {r.parentRunId && <span className="research-lineage">↳ {r.parentRunId}</span>}
              </div>
              <div className="research-run-params">{Object.entries(r.params).map(([k, v]) => `${k}=${v}`).join(' · ')}</div>
              <RunChart run={r} />
              <div className="research-run-metrics">
                {Object.entries(r.metrics).map(([k, v]) => (
                  <span key={k}>{k}=<b>{typeof v === 'number' ? Number(v.toPrecision(8)) : String(v)}</b></span>
                ))}
              </div>
              <div className="research-run-actions">
                {Object.keys(r.params).slice(0, 2).map((p) => (
                  <button key={p} type="button" className="research-fork" onClick={() => void localFork(r.runId, p, 2)}>
                    本地 fork：{p} ×2（非 AI）
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>
      </div>
    </div>
  )
}
