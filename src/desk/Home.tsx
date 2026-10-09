// The clean home: one dropzone, one hero-demo link. No chat, no cards.
// Dragging a PDF in transitions to the ingest desk (Docling → playable paper).
import { useEffect, useRef, useState } from 'react'
import {
  clearLastJob,
  ingestPdf,
  lastJob,
  pollIngestJob,
  type IngestProgress,
} from '../ingest/upload'
import { routeAdapterWithLlm } from '../skills/adapterRouter'

export function Home({
  onDesk,
  onKakeya,
  onPhysics,
  onChallenges,
}: {
  onDesk: (file: File, pdfUrl: string, doc: Awaited<ReturnType<typeof ingestPdf>>, decision: Awaited<ReturnType<typeof routeAdapterWithLlm>>) => void
  onKakeya: () => void
  onPhysics: () => void
  onChallenges: () => void
}) {
  const [state, setState] = useState<'idle' | 'parsing' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // #15 UX: live parse progress — stage/elapsed/queue instead of a dead
  // spinner (real parses take 20-60s; silence reads as "stuck")
  const [progress, setProgress] = useState<IngestProgress | null>(null)
  const [reattached, setReattached] = useState<string | null>(null) // filename of the reattached job
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (state !== 'parsing') return
    const t = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [state])
  void tick

  // #15 latest-wins: a refresh must FOLLOW the newest task, not blank out —
  // reattach to the still-running job this tab started (server keeps state)
  const resumedRef = useRef(false)
  useEffect(() => {
    if (resumedRef.current) return
    resumedRef.current = true
    const last = lastJob()
    if (!last) return
    setState('parsing')
    setReattached(last.filename)
    setProgress({ status: 'queued', stage: null, elapsedMs: 0, queueDepth: 0 })
    void pollIngestJob(last.jobId, (p) => setProgress(p))
      .then((doc) => {
        // the parsed DOCUMENT survives; the file object does not — ask the
        // user to re-drop the same PDF to enter the desk with full paper view
        clearLastJob()
        setReattached(null)
        setState('idle')
        setError(`「${last.filename}」解析已完成（${doc.items.length} 项）——请重新拖入该 PDF 进入实验台`)
      })
      .catch(() => {
        clearLastJob()
        setReattached(null)
        setState('idle')
      })
  }, [])

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setState('error')
      setError('请拖入 PDF 论文（0.1 支持 .pdf）')
      return
    }
    setState('parsing')
    setError(null)
    setProgress({ status: 'queued', stage: null, elapsedMs: 0, queueDepth: 0 })
    try {
      const doc = await ingestPdf(file, { onProgress: (p) => setProgress(p) })
      const decision = await routeAdapterWithLlm(doc)
      onDesk(file, URL.createObjectURL(file), doc, decision)
    } catch (err) {
      setState('error')
      setError(err instanceof Error ? err.message : String(err))
      setProgress(null)
    }
  }

  return (
    <div
      className={`home-root${dragOver ? ' drag-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const file = e.dataTransfer.files?.[0]
        if (file) void handleFile(file)
      }}
    >
      <div className="home-card">
        <div className="home-title">Paper2Lab</div>
        <div className="home-sub">
          把一篇数学 PDF 变成可以操作的论文 — 公式里的参数直接拖动，
          图与实验即时重算；每个数字都能追溯到它来自的那一行论文。
        </div>
        <button
          type="button"
          className={`home-drop${state === 'parsing' ? ' parsing' : ''}`}
          onClick={() => inputRef.current?.click()}
          disabled={state === 'parsing'}
        >
          {state === 'parsing' ? (
            <ParseProgress p={progress} name={reattached ?? undefined} />
          ) : (
            <>拖入一篇 PDF，或点击选择</>
          )}
        </button>
        {state === 'parsing' && <ParseBar p={progress} />}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
          }}
        />
        {error && (
          <div className="home-error">
            {error}
            <button type="button" className="desk-btn" onClick={() => setState('idle')}>
              重试
            </button>
          </div>
        )}
        <div className="home-sep">· 或 ·</div>
        <button type="button" className="home-kakeya" onClick={onKakeya}>
          打开 Wang–Zahl Kakeya Lab（内置论文 · 3D 专用 Adapter）→
        </button>
        <div className="home-sep">· 或 ·</div>
        <button type="button" className="home-kakeya home-physics" onClick={onPhysics}>
          打开 Physics Lab（MuJoCo · 17 场景 · 拖拽施力真物理）→
        </button>
        <div className="home-sep">· 或 ·</div>
        <button type="button" className="home-kakeya home-challenges" onClick={onChallenges}>
          打开 Challenges（三关：投射命中 · 摆周期 · 管束压缩）→
        </button>
        <div className="home-foot">
          PDF 解析 Docling · 公式 Cortex Compute Engine · 曲线 JSXGraph · 画布 tldraw · 数值全部本地真实计算
        </div>
      </div>
    </div>
  )
}

/** staged parse status: queue → model warm-up → page/formula/table parse,
 *  with live elapsed seconds and queue depth. No fabricated percentages. */
function ParseProgress({ p, name }: { p: IngestProgress | null; name?: string }) {
  if (!p) return <>准备上传…</>
  const ctx = name ? `${name} · ` : ''
  const secs = Math.floor((p.elapsedMs || 0) / 1000)
  if (p.status === 'queued') {
    return (
      <>
        <span className="home-spin">◌</span> {ctx}排队中 · 前面还有 {Math.max(0, p.queueDepth - 1)} 个任务
        {secs > 0 ? ` · 已等 ${secs}s` : ''}
      </>
    )
  }
  if (p.stage === 'warming') {
    return (
      <>
        <span className="home-spin">◌</span> {ctx}正在加载解析模型（首次较慢，约 30–60s）· {secs}s
      </>
    )
  }
  return (
    <>
      <span className="home-spin">◌</span> {ctx}正在解析 · 版面 → 公式 → 表格 · {secs}s
    </>
  )
}

/** paper-scan progress bar: an indeterminate scan line (width is NOT a
 *  percentage — parse progress is not linearly measurable; the motion shows
 *  liveness, the text above shows truth) */
function ParseBar({ p }: { p: IngestProgress | null }) {
  const phase = p?.stage ?? (p?.status === 'queued' ? 'queued' : 'running')
  return (
    <div className={`home-parsebar st-${phase}`} aria-hidden="true">
      <div className="home-parsebar-scan" />
    </div>
  )
}
