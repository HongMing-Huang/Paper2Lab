import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { WorldDefinition } from '../mathworld/definition'
import { host } from '../mathworld/host'
import { WorldScene } from '../mathworld/scene/WorldScene'
import { FormulaCard } from '../mathworld/App'
import '../mathworld/mathworld.css'
import './game-panel.css'
import { challengeFromRun } from './challengeFromRun'
import { useWorldHostBridge } from './worldHostBridge'

/** Embedded runtime; never loads the sample catalog or runs a second physics model. */
export function StudyGamePanel({ world, sessionId, onQuestion, onChallenge }: { world: WorldDefinition; sessionId: string | null; onChallenge: (world: WorldDefinition) => void; onQuestion: (question: string) => void }) {
  const session = useSyncExternalStore(host.subscribe, host.getSession)
  // CLI-150: while this panel is mounted, it IS the world host for the agent —
  // pending world_set_params actions execute here through the same commit entry
  useWorldHostBridge(sessionId)
  const root = useRef<HTMLDivElement>(null)
  const currentWorld = useRef(world)
  currentWorld.current = world
  const making = useRef(false)
  const [creating, setCreating] = useState(false)
  const [activeWorld, setActiveWorld] = useState<WorldDefinition | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [controls, setControls] = useState(world.controls.length === 0)
  const [full, setFull] = useState(false)
  useEffect(() => {
    let live = true
    setError(null)
    setActiveWorld(null)
    setControls(world.controls.length === 0)
    void host.activate(world, 'edited').then((r) => { if (!live) return; if (!r.ok) setError(r.errors.join('；')); else setActiveWorld(world) }).catch((e: unknown) => { if (live) setError(String(e)) })
    return () => { live = false }
  }, [world])
  useEffect(() => {
    const change = () => setFull(document.fullscreenElement === root.current)
    document.addEventListener('fullscreenchange', change)
    return () => document.removeEventListener('fullscreenchange', change)
  }, [])
  const s = activeWorld === world && session?.world.id === world.id ? session : null
  const a = s?.committed?.assessment
  const explore = world.goal.mode === 'explore'
  const ask = async (text: string) => {
    if (document.fullscreenElement === root.current) {
      try { await document.exitFullscreen() } catch { setError('请先退出全屏，再向研究助手提问'); return }
    }
    onQuestion(text)
  }

  return (
    <div ref={root} className="study-game" data-testid="study-game">
      <header className="study-game-toolbar">
        <b>{explore ? '自由试一试' : '挑战一下'}</b>
        <button onClick={() => setControls((v) => !v)}>{controls ? '收起公式' : '调整公式'}</button>
        {explore && <button disabled={!s || Boolean(s.pending) || creating} onClick={async () => {
          if (!s || making.current) return
          making.current = true; setCreating(true)
          try {
            const result = await challengeFromRun(s)
            const now = host.getSession()
            if (!root.current || currentWorld.current !== world) return
            if (now?.sessionId !== s.sessionId || now.revision !== s.revision || now.pending) { setError('条件已经变化，请等待新结果后再设置目标'); return }
            if ('error' in result) setError(result.error)
            else { setError(null); onChallenge(result.world) }
          } catch (e) { if (root.current) setError(String(e)) }
          finally { making.current = false; if (root.current) setCreating(false) }
        }}>{creating ? '验证目标…' : '把刚才的结果设成目标'}</button>}
        <details className="study-game-menu"><summary>更多</summary><div>
        <button disabled={!s || Boolean(s.pending)} onClick={() => host.undo()}>撤销</button>
        <button disabled={!s || Boolean(s.pending)} onClick={() => void host.reset()}>重新开始</button>
        <button onClick={() => {
          const text = host.exportSave()
          const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
          const link = document.createElement('a'); link.href = url; link.download = `${world.id}.json`; link.click()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
        }} disabled={!s || Boolean(s.pending)}>保存</button>
        </div></details>
        <button onClick={() => {
          const action = full ? document.exitFullscreen() : root.current?.requestFullscreen()
          void action?.catch(() => setError('浏览器未允许全屏；仍可在右侧操作'))
        }}>{full ? '退出全屏' : '全屏玩'}</button>
      </header>
      <div className="study-game-stage">
        {s && <WorldScene s={s} inspecting={false} />}
        {!s && !error && <div className="study-game-empty">正在用当前论文模型计算场景…</div>}
        {error && <div className="study-game-error">{error}<button onClick={() => setError(null)}>继续操作</button></div>}
        <div className="study-game-mission"><b>{world.objective}</b><span>{world.model.kind === 'ode' ? '调整公式中的条件，然后点「释放轨迹」；拖空白处转动视角。' : '抓住金色控制点拖动，或改变公式中的金色数字；松手自动计算。'}</span></div>
        {s && controls && <div className="study-game-formula"><FormulaCard s={s} /></div>}
        {s && <div className="study-game-feedback" role="status" aria-live="polite">
          <b>{s.pending ? '正在计算新条件…' : explore ? '自由探索 · 不计分' : a?.outcome === 'success' ? '达成目标' : a?.outcome === 'fail' ? '还没达到，换个条件再试' : '等待可信结果'}</b>
          {!s.pending && a && <span>{explore ? a.outcome === 'invalid' ? a.summary : '结果来自当前条件的真实计算；你可以继续改变条件。' : a.summary}</span>}
          <button onClick={() => void ask(`请根据当前游戏模型、最新真实Run和操作解释为什么会这样，并给一个我能亲手尝试的下一步。${a?.checks.map((c) => `${c.label}：${c.explanation}`).join('；') ?? ''}`)}>为什么？</button>
        </div>}
      </div>
      <footer className="study-game-source">来自当前论文 · {world.origin.note}{s?.committed && <code>Run {s.attempts.at(-1)?.runIds.join(', ')}</code>}</footer>
    </div>
  )
}
