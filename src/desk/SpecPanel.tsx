// 理解卡 (paper→model L1/L4 panel): the deterministic comprehension of the
// paper — question, equations (classified), quantities, paper claims — plus
// the「构建模型」action that runs model.build + model.solve through the SAME
// unified executor everything else uses (CALCULATED numbers only, every
// result carries its run badge). Panel-first delivery; growing it as a
// tldraw shape is a later slice.
import { useMemo, useState } from 'react'
import type { IngestedDoc } from '../ingest/doclingSchema'
import type { AdapterDecision } from '../skills/adapterRouter'
import { buildPaperSpec, governingSystem, initialsOf, nominalParams } from '../skills/paperSpec'
import { executeSkill } from '../skills/executor'
import { buildPlan } from '../skills/playPlan'
import type { ExperimentRun } from '../experiments/protocol'

interface SolveResult {
  t: number[]
  series: Array<{ state: string; values: number[] }>
  perState: Array<{ state: string; min: number; max: number }>
  period0: number | null
  steps: number
}

export function SpecPanel({ doc, decision, onClose }: {
  doc: IngestedDoc
  decision: AdapterDecision
  onClose: () => void
}) {
  const spec = useMemo(() => buildPaperSpec(doc), [doc])
  const sys = useMemo(() => governingSystem(spec), [spec])
  const initials = useMemo(() => initialsOf(spec), [spec])
  const params = useMemo(
    () => nominalParams(doc, spec.quantities.filter((q) => q.role === 'parameter').map((q) => q.name)),
    [doc, spec],
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [solved, setSolved] = useState<{ run: ExperimentRun; result: SolveResult } | null>(null)

  const buildable = sys.states.length >= 1 && sys.states.every((s) => Number.isFinite(initials[s]))

  const buildAndSolve = async () => {
    setBusy(true)
    setError(null)
    setSolved(null)
    try {
      const build = await executeSkill(
        'model.build',
        { states: sys.states, rhs: sys.rhs, params, initialState: initials },
        buildPlan({ skill: 'model.build', goal: `理解卡构建：${doc.title}` }),
      )
      if (build.status !== 'ok' || !build.run) throw new Error(build.status === 'error' ? build.message : `build ${build.status}`)
      const solve = await executeSkill(
        'model.solve',
        { states: sys.states, rhs: sys.rhs, params, initialState: initials, tSpan: [0, 80] },
        buildPlan({ skill: 'model.solve', goal: `理解卡求解：${doc.title}` }),
      )
      if (solve.status !== 'ok' || !solve.run?.result) {
        throw new Error(solve.status === 'error' ? solve.message : `solve ${solve.status}`)
      }
      setSolved({ run: solve.run, result: solve.run.result as unknown as SolveResult })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="spec-panel" data-testid="spec-panel">
      <div className="spec-panel-head">
        <span className="spec-panel-title">🧠 理解卡</span>
        <span className="spec-panel-prov">确定性提取 · 每项可回溯锚点</span>
        <button type="button" className="desk-btn" onClick={onClose}>收起</button>
      </div>

      <div className="spec-section">
        <div className="spec-label">研究问题</div>
        <div className="spec-question">{spec.question}</div>
      </div>

      <div className="spec-section">
        <div className="spec-label">方程（{spec.equations.length}）</div>
        <ul className="spec-eqs">
          {spec.equations.map((eq, i) => (
            <li key={i} className={`spec-eq role-${eq.role}`}>
              <span className="spec-eq-role">
                {eq.role === 'governing' ? `控制方程 d/dt ${eq.state}` : eq.role === 'initial' ? `初值 ${eq.state}` : '定义'}
              </span>
              <code>{eq.latex}</code>
            </li>
          ))}
        </ul>
      </div>

      <div className="spec-section">
        <div className="spec-label">量（{spec.quantities.length}）</div>
        <table className="spec-quantities">
          <thead><tr><th>符号</th><th>角色</th><th>论文给定值</th></tr></thead>
          <tbody>
            {spec.quantities.map((q) => (
              <tr key={q.name}>
                <td><code>{q.name}</code></td>
                <td>{q.role}</td>
                <td>
                  {q.role === 'state' && Number.isFinite(q.initial) ? `${q.name}(0) = ${q.initial}`
                    : q.role === 'parameter' && Number.isFinite(params[q.name]) ? `= ${params[q.name]}`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {spec.claims.length > 0 && (
        <div className="spec-section">
          <div className="spec-label">论文命题（PAPER）</div>
          <ul className="spec-claims">
            {spec.claims.map((c, i) => <li key={i}>{c.statement}</li>)}
          </ul>
        </div>
      )}

      <div className="spec-section">
        {buildable ? (
          <button type="button" className="desk-btn desk-btn-play" data-testid="build-model" disabled={busy} onClick={() => void buildAndSolve()}>
            {busy ? '引擎构建/求解中…' : `⚙ 构建模型并求解（${sys.states.length} 态 · RK4）`}
          </button>
        ) : (
          <div className="spec-note">
            {sys.states.length === 0
              ? '论文未含导数方程 — 用 Playable 公式实验交互（见左侧论文页）'
              : `状态 ${sys.states.filter((s) => !Number.isFinite(initials[s])).join('/')} 缺论文初值 — 模型不猜造`}
          </div>
        )}
        {error && <div className="spec-error">✖ {error}</div>}
        {solved && (
          <div className="spec-solved" data-testid="model-result">
            <div className="spec-run-badge">
              CALCULATED · {solved.run.engine}@{solved.run.engineVersion} · {solved.run.durationMs}ms · run …{solved.run.runId.slice(-6)}
            </div>
            <table className="spec-quantities">
              <thead><tr><th>状态</th><th>min</th><th>max</th><th>终值 t={solved.result.t[solved.result.t.length - 1]}</th></tr></thead>
              <tbody>
                {solved.result.perState.map((p) => {
                  const vals = solved.result.series.find((s) => s.state === p.state)?.values ?? []
                  return (
                    <tr key={p.state}>
                      <td><code>{p.state}</code></td>
                      <td>{p.min.toFixed(4)}</td>
                      <td>{p.max.toFixed(4)}</td>
                      <td>{(vals[vals.length - 1] ?? 0).toFixed(4)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {solved.result.period0 != null && (
              <div className="spec-note">首态周期 ≈ {solved.result.period0.toFixed(3)}（中位上升过零估计）</div>
            )}
            <div className="spec-note">FINITE-SCALE CALCULATION — 数值来自本地引擎真实积分，非论文证明</div>
          </div>
        )}
      </div>
      {decision.status === 'ok' && decision.adapter === 'ode' && (
        <div className="spec-note">2 态论文也可用相平面实验纸（顶栏「长出 ODE 相平面」）拖初值交互。</div>
      )}
    </div>
  )
}
