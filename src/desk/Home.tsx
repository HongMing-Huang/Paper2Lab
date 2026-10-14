// The clean home: one dropzone, one hero-demo link. No chat, no cards.
// Dragging a PDF in transitions to the ingest desk (Docling → playable paper).
import { useEffect, useRef, useState } from 'react'
import {
  clearLastJob,
  lastJob,
  pollIngestJob,
  type IngestMode,
  type IngestProgress,
} from '../ingest/upload'
import { runPdfFirstUpload, type UploadFlowState } from './uploadFlow'
import type { AdapterDecision } from '../skills/adapterRouter'

export function Home({
  onDesk,
  onKakeya,
  onPhysics,
  onChallenges,
}: {
  onDesk: (file: File, pdfUrl: string, doc: import('../ingest/doclingSchema').IngestedDoc, decision: AdapterDecision) => void
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
  // #15 PDF-first: the ORIGINAL paper is viewable the instant a file lands —
  // parse failure never blocks access (blob URL lives through retry)
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null)
  const [retrying, setRetrying] = useState(false)
  const fileRef = useRef<File | null>(null)
  // #15 speed: parse-engine choice. Default is the VLM fast path (the
  // provider's native multimodal model reads rendered pages — seconds, not
  // tens of seconds); 精读定位 (Docling) stays one click away for
  // char-precise anchors. No silent fallback — a missing provider surfaces
  // as an explicit, actionable error.
  const [mode, setMode] = useState<IngestMode>('vlm')
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
    fileRef.current = file
    setState('parsing')
    setError(null)
    setProgress({ status: 'queued', stage: null, elapsedMs: 0, queueDepth: 0 })
    const out = await runPdfFirstUpload(file, { onProgress: (p) => setProgress(p), mode })
    settle(out, file)
  }

  /** settle a pdf-first run: done → desk (with the SAME blob URL); failed →
   *  keep the original-PDF view up + the real reason + a retry entry */
  const settle = (out: UploadFlowState, file: File) => {
    if (out.phase === 'done' && out.doc && out.decision && out.decision.status === 'ok') {
      // deterministic routing succeeded — hand over (LLM refinement path only
      // improves the deterministic choice, so routeAdapter is sufficient here).
      // Dynamic import keeps the cortex engine OUT of the first-paint chunk:
      // routing runs once per upload, seconds after the drop, never at paint.
      void import('../skills/adapterRouter')
        .then(({ routeAdapterWithLlm }) => routeAdapterWithLlm(out.doc!))
        .then((decision) => {
          onDesk(file, out.pdfUrl, out.doc!, decision)
        })
      return
    }
    // failed (parse error / lost job / superseded) or routing refused:
    // the ORIGINAL PAPER stays accessible — never a blank error wall
    setPreview({ file, url: out.pdfUrl })
    setState('error')
    setError(out.error ?? (out.decision ? out.decision.reason : '解析未完成'))
    setProgress(null)
  }

  /** retry uses the SAME blob URL (no leak) and the same file */
  const retryParse = async () => {
    const file = fileRef.current
    if (!file || retrying) return
    setRetrying(true)
    setState('parsing')
    setError(null)
    setProgress({ status: 'queued', stage: null, elapsedMs: 0, queueDepth: 0 })
    const out = await runPdfFirstUpload(file, {
      onProgress: (p) => setProgress(p),
      existingUrl: preview?.url,
      mode,
    })
    setRetrying(false)
    settle(out, file)
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
        <div className="home-modes" data-testid="parse-mode">
          <button
            type="button"
            className={`home-mode${mode === 'vlm' ? ' active' : ''}`}
            onClick={() => setMode('vlm')}
            disabled={state === 'parsing'}
            title="AI 视觉模型直接阅读论文页面（秒级）；锚点为页面级，提取来源标注为 AI"
          >
            ⚡ 快速理解<span>AI 读图 · 秒级</span>
          </button>
          <button
            type="button"
            className={`home-mode${mode === 'docling' ? ' active' : ''}`}
            onClick={() => setMode('docling')}
            disabled={state === 'parsing'}
            title="Docling 版面+公式+表格模型（较慢）；字符级精确锚点，可回溯到原文位置"
          >
            🔍 精读定位<span>Docling · 字符级锚点</span>
          </button>
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
            {error.includes('快速理解模式需要') && (
              <div className="home-error-hint">
                当前后端未配置 AI 视觉 provider — 可切换到「🔍 精读定位」后重试
              </div>
            )}
            {fileRef.current ? (
              <button type="button" className="desk-btn" data-testid="retry-parse" disabled={retrying} onClick={() => void retryParse()}>
                {retrying ? '重新解析中…' : '重试解析'}
              </button>
            ) : (
              <button type="button" className="desk-btn" onClick={() => setState('idle')}>
                重试
              </button>
            )}
          </div>
        )}
        {/* PDF-first: the original paper stays viewable even when parsing
            failed — access is never blocked by an ingest error (#15) */}
        {preview && state !== 'idle' && (
          <div className="home-pdf-first" data-testid="pdf-first-view">
            <div className="home-pdf-first-head">
              原文预览（解析不影响阅读）
            </div>
            <iframe
              className="home-pdf-first-frame"
              title="original paper"
              src={preview.url}
              data-testid="pdf-first-frame"
            />
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
  if (p.stage === 'vlm-reading') {
    return (
      <>
        <span className="home-spin">◌</span> {ctx}AI 正在阅读页面图片（逐页并发）· {secs}s
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
