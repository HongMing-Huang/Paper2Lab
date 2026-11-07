import type { Session } from './host'
import { host, tunables } from './host'

/** A projection of Host state: no second score, answer or scientific state. */
export function GameplayHUD({ session: s, onWhy, onDetails }: {
  session: Session
  onWhy: (text: string) => void
  onDetails: () => void
}) {
  const a = s.committed?.assessment
  const last = s.attempts.filter((r) => r.status === 'committed' && !r.fromFile).at(-1)
  const opening = !last || last.actor === 'init' || last.actor === 'restore'
  const operable = tunables(s.world).filter((t) => t.operable)
  const has = (kind: string) => s.world.controls.some((c) => c.kind === kind)
  const gesture = has('cluster-drag') ? '拖动彩色管簇，试着把它们排得更紧凑。'
    : has('curve-handle') ? '抓住曲线上的金色点上下拖动，观察它怎样改变曲线。'
    : has('initial-point') ? '拖动金色起点，再播放轨迹，看看会经过哪里。'
    : operable.length ? '左右拖动下方公式里的金色数字，改变条件。'
    : '这组条件固定，可以观察结果；打开详情查看可用条件。'
  const why = a?.checks.filter((c) => c.status !== 'pass') ?? []
  const title = s.pending ? '正在核对这次操作…' : opening ? '先观察，再试一下'
    : a?.outcome === 'success' ? '做到了！这次满足了目标'
    : a?.outcome === 'fail' ? '还差一点，换个操作试试'
    : a?.outcome === 'unknown' ? '这次还不能确定，不扣次数'
    : a?.outcome === 'invalid' ? '这次证据无效，不计分' : '准备好就试一下'
  return (
    <section className="mw-card mw-play-card" aria-label="玩法与当前结果">
      <div className="mw-card-label">这次试着做到</div>
      <h1>{s.world.objective}</h1>
      <p className="mw-play-gesture">{gesture}</p>
      <p className="mw-play-small">拖动会即时预览；松手后自动计算并验证，不必重复提交。</p>
      <div className={`mw-play-result mw-play-result-${a?.outcome ?? 'ready'}`} role="status" aria-live="polite">
        <b>{title}</b>
        {!s.pending && a && <p>{a.summary}</p>}
        {!s.pending && why.slice(0, 2).map((c) => <p key={c.constraintId}>{c.label}：{c.explanation}</p>)}
      </div>
      <div className="mw-play-actions">
        <button type="button" disabled={Boolean(s.pending) || s.attempts.filter((r) => r.status === 'committed' && !r.fromFile && !r.fromUndo).length < 2} onClick={() => host.undo()}>撤销这一步</button>
        <button type="button" disabled={Boolean(s.pending)} onClick={() => onWhy('请根据当前真实操作、计算结果和目标解释为什么会这样，先用直观语言，再指出我下一步可以亲手尝试什么。不要编造结果或假称已改变世界。')}>为什么会这样？</button>
        {s.phase === 'lost' && <button type="button" onClick={() => void host.reset()}>重新挑战</button>}
      </div>
      <div className="mw-play-small">{s.phase === 'won' ? '已完成挑战 · 可以继续探索不同条件' : `剩余 ${s.budgetLeft} 次正式尝试 · 计算不确定不扣次数`}</div>
      <button type="button" className="mw-details-link" onClick={onDetails}>查看论文依据、规则与计算记录 →</button>
    </section>
  )
}
