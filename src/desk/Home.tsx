// The clean home: one dropzone, one hero-demo link. No chat, no cards.
// Dragging a PDF in transitions to the ingest desk (Docling → playable paper).
import { useRef, useState } from 'react'
import { ingestPdf } from '../ingest/upload'
import { routeAdapterWithLlm } from '../skills/adapterRouter'

export function Home({
  onDesk,
  onKakeya,
}: {
  onDesk: (file: File, pdfUrl: string, doc: Awaited<ReturnType<typeof ingestPdf>>, decision: Awaited<ReturnType<typeof routeAdapterWithLlm>>) => void
  onKakeya: () => void
}) {
  const [state, setState] = useState<'idle' | 'parsing' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setState('error')
      setError('请拖入 PDF 论文（0.1 支持 .pdf）')
      return
    }
    setState('parsing')
    setError(null)
    try {
      const doc = await ingestPdf(file)
      const decision = await routeAdapterWithLlm(doc)
      onDesk(file, URL.createObjectURL(file), doc, decision)
    } catch (err) {
      setState('error')
      setError(err instanceof Error ? err.message : String(err))
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
            <>
              <span className="home-spin">◌</span> Docling 解析中 — 版面 · 公式 · 图表…
            </>
          ) : (
            <>拖入一篇 PDF，或点击选择</>
          )}
        </button>
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
        <div className="home-foot">
          PDF 解析 Docling · 公式 Cortex Compute Engine · 曲线 JSXGraph · 画布 tldraw · 数值全部本地真实计算
        </div>
      </div>
    </div>
  )
}
