// CLI-111 连续论文阅读 + 三种选区并存（文字 / 矩形 / 圈选）。
// 每页：PdfCanvas 画布（CSS 尺寸 viewport，dpr 只进画布后备存储）+ 官方
// pdfjs-dist TextLayer（同 scale、同 CSS 尺寸；--scale-factor 挂容器上；
// 重复渲染前先清空容器，杜绝宽/near 变化时的重复文字节点）。
// 默认原生鼠标拖选文字；矩形与圈选是显式工具（扫描页/图表）。三种选区
// 都以 Clipping 形式累积进选区集合（可删除/可定位），不覆盖上一选区。
import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import 'pdfjs-dist/web/pdf_viewer.css'
import { PdfCanvas, getPdfDocument, usePdfPageSize } from '../desk/PdfCanvas'

export interface PaperRegion {
  page: number
  bbox: { x: number; y: number; w: number; h: number }
  /** lasso selections carry the freehand closed polygon (page fractions) */
  path?: Array<{ x: number; y: number }>
}

/** a collected excerpt — text / rect / lasso all land in the same set */
export interface Clipping {
  id: string
  kind: 'text' | 'rect' | 'lasso'
  page: number
  bbox: PaperRegion['bbox']
  path?: Array<{ x: number; y: number }>
  text: string
  at: number
}

/** a native text selection, frozen at pick time（原文 + 论文身份由宿主持有） */
export interface TextQuote {
  pages: Array<{ page: number; text: string; rects: Array<{ x: number; y: number; w: number; h: number }> }>
  /** viewport-fixed position for the floating menu */
  menuAt: { x: number; y: number }
}

export type QuoteAction = 'explain' | 'why' | 'try'
export type SelectMode = 'text' | 'rect' | 'lasso'

function layerPage(layer: HTMLElement): number {
  const el = layer.closest('[data-paper-page]')
  const n = Number(el?.getAttribute('data-paper-page'))
  return Number.isFinite(n) ? n : 0
}

/** read the current DOM selection, restricted to this reader's text layers */
function readTextQuote(root: HTMLElement): TextQuote | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null
  const layers = Array.from(root.querySelectorAll<HTMLElement>('.textLayer'))
  const byPage = new Map<number, { texts: string[]; rects: TextQuote['pages'][number]['rects']; box: DOMRect }>()
  for (let i = 0; i < sel.rangeCount; i++) {
    const range = sel.getRangeAt(i)
    for (const layer of layers) {
      if (!range.intersectsNode(layer)) continue
      // clamp a clone to THIS layer — cross-page selections split per page
      const r = range.cloneRange()
      if (!layer.contains(r.startContainer)) r.setStart(layer, 0)
      if (!layer.contains(r.endContainer)) r.setEnd(layer, layer.childNodes.length)
      const text = r.toString().replace(/\s+/g, ' ').trim()
      if (!text) continue
      const page = layerPage(layer)
      const box = layer.getBoundingClientRect()
      const rects = Array.from(r.getClientRects())
        .map((cr) => ({
          x: (cr.left - box.left) / box.width,
          y: (cr.top - box.top) / box.height,
          w: cr.width / box.width,
          h: cr.height / box.height,
        }))
        .filter((q) => q.w > 0.002 && q.h > 0.002 && q.x > -0.05 && q.x < 1.05 && q.y > -0.05 && q.y < 1.05)
      if (rects.length === 0) continue
      const entry = byPage.get(page) ?? { texts: [], rects: [], box }
      entry.texts.push(text)
      entry.rects.push(...rects)
      byPage.set(page, entry)
    }
  }
  if (byPage.size === 0) return null
  const pages = [...byPage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([page, e]) => ({ page, text: e.texts.join(' '), rects: e.rects }))
  // order the menu at the end of the last selected page line
  const lastRect = pages.at(-1)!.rects.at(-1)!
  const box = byPage.get(pages.at(-1)!.page)!.box
  return {
    pages,
    menuAt: {
      x: Math.min(window.innerWidth - 210, box.left + (lastRect.x + lastRect.w) * box.width),
      y: Math.min(window.innerHeight - 60, box.top + (lastRect.y + lastRect.h) * box.height + 10),
    },
  }
}

function unionBbox(rects: Array<{ x: number; y: number; w: number; h: number }>) {
  const x0 = Math.min(...rects.map((r) => r.x))
  const y0 = Math.min(...rects.map((r) => r.y))
  const x1 = Math.max(...rects.map((r) => r.x + r.w))
  const y1 = Math.max(...rects.map((r) => r.y + r.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function pathBbox(path: Array<{ x: number; y: number }>) {
  return unionBbox(path.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })))
}

function ReadingPage({ url, page, width, mode, onVisible, onRegion, highlights, onRendered }: {
  url: string; page: number; width: number; mode: SelectMode
  onVisible: (page: number) => void; onRegion: (region: PaperRegion) => void
  /** per-page highlights: index 0 is the ACTIVE (strong) one, rest are collected (faint) */
  highlights?: PaperRegion[]; onRendered?: (page: number) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const layerHost = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(page === 1)
  const size = usePdfPageSize(url, page)
  const height = size ? Math.floor(width * size.h / size.w) : Math.floor(width * 1.414)
  const [box, setBox] = useState<PaperRegion['bbox'] | null>(null)
  const [lasso, setLasso] = useState<Array<{ x: number; y: number }> | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)

  // real pdfjs TextLayer — same CSS-size viewport as the canvas (the canvas
  // bakes dpr into its BACKING STORE only; the layer must not see dpr again).
  // The container is CLEARED before every render: width/near re-runs append
  // into the same div, and pdfjs never removes previous spans — duplicates
  // would double-select the same glyphs (CLI-111 文字层重复节点修复).
  useEffect(() => {
    if (!near) return
    let cancelled = false
    let tl: pdfjsLib.TextLayer | null = null
    void (async () => {
      try {
        const doc = await getPdfDocument(url)
        const p = await doc.getPage(page)
        const host = layerHost.current
        if (cancelled || !host) return
        host.replaceChildren()
        const scale = width / p.getViewport({ scale: 1 }).width
        host.style.setProperty('--scale-factor', String(scale))
        tl = new pdfjsLib.TextLayer({
          textContentSource: p.streamTextContent(),
          container: host,
          viewport: p.getViewport({ scale }),
        })
        await tl.render()
      } catch (err) {
        if (!cancelled) console.error('[TextLayer] render', err)
      }
    })()
    return () => {
      cancelled = true
      tl?.cancel()
    }
  }, [url, page, width, near])

  useEffect(() => {
    if (!root.current) return
    const observer = new IntersectionObserver((entries) => entries.forEach((e) => setNear(e.isIntersecting)), { rootMargin: '700px 0px' })
    const visible = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting && e.intersectionRatio > 0.2) onVisible(page) }), { threshold: [0.2, 0.5] })
    observer.observe(root.current); visible.observe(root.current)
    return () => { observer.disconnect(); visible.disconnect() }
  }, [page, onVisible])
  const xy = (e: React.PointerEvent<HTMLDivElement>) => {
    const b = e.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)), y: Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)) }
  }
  const pageMarks = (highlights ?? []).filter((h) => h.page === page)
  return <div ref={root} className="study-reading-page" data-paper-page={page} style={{ width }}>
    <div className="study-reading-number">第 {page} 页</div>
    <div className="study-reading-area" style={{ height }}>
      {near && <PdfCanvas url={url} page={page} width={width} onRendered={onRendered} />}
      {near && <div ref={layerHost} className="textLayer study-text-layer" />}
      {mode === 'rect' && <div className="study-region-layer"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); start.current = xy(e); setBox(null) }}
        onPointerMove={(e) => { if (!start.current) return; const end = xy(e); setBox({ x: Math.min(start.current.x, end.x), y: Math.min(start.current.y, end.y), w: Math.abs(end.x - start.current.x), h: Math.abs(end.y - start.current.y) }) }}
        onPointerUp={(e) => {
          if (!start.current) return
          const end = xy(e); const a = start.current; start.current = null
          const bbox = { x: Math.min(a.x, end.x), y: Math.min(a.y, end.y), w: Math.abs(end.x - a.x), h: Math.abs(end.y - a.y) }
          if (bbox.w > .005 && bbox.h > .005) { setBox(bbox); onRegion({ page, bbox }) }
        }} onPointerCancel={() => { start.current = null; setBox(null) }} />}
      {mode === 'lasso' && <div className="study-region-layer study-lasso-layer"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const p = xy(e); start.current = p; setLasso([p]) }}
        onPointerMove={(e) => { if (!start.current) return; setLasso((prev) => [...(prev ?? []), xy(e)]) }}
        onPointerUp={() => {
          if (!lasso || lasso.length < 6) { start.current = null; setLasso(null); return }
          const path = [...lasso, lasso[0]!]
          start.current = null; setLasso(null)
          onRegion({ page, bbox: pathBbox(path), path })
        }} onPointerCancel={() => { start.current = null; setLasso(null) }} />}
      {mode !== 'text' && lasso && lasso.length > 1 && (
        <svg className="study-lasso-draw" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline points={lasso.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')} fill="none" />
        </svg>
      )}
      {/* collected marks (faint) — page-accurate across pages; active one strong */}
      {pageMarks.slice(1).map((h) => (
        <svg key={h.bbox.x} className="study-region-mark-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          {h.path
            ? <polygon points={h.path.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')} />
            : <rect x={h.bbox.x * 100} y={h.bbox.y * 100} width={h.bbox.w * 100} height={h.bbox.h * 100} />}
        </svg>
      ))}
      {pageMarks[0] && (pageMarks[0].path
        ? <svg className="study-region-mark-svg active" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polygon points={pageMarks[0].path!.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')} />
          </svg>
        : <div className="study-region-mark" style={{ left: `${pageMarks[0].bbox.x * 100}%`, top: `${pageMarks[0].bbox.y * 100}%`, width: `${pageMarks[0].bbox.w * 100}%`, height: `${pageMarks[0].bbox.h * 100}%` }} />)}
      {mode !== 'text' && box && !pageMarks[0] && <div className="study-region-mark" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }} />}
    </div>
  </div>
}

export function ContinuousPaper({ url, pages, width, jump, onVisible, onRegion, onTextPick, highlights, onRendered }: {
  url: string; pages: number; width: number; jump?: { page: number; token: number }
  onVisible: (page: number) => void; onRegion: (region: PaperRegion) => void
  onTextPick?: (quote: TextQuote, action: QuoteAction) => void
  /** active highlight first; any additional regions render faint on their pages */
  highlights?: PaperRegion[]; onRendered?: (page: number) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const scrollHost = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<SelectMode>('text')
  const [menu, setMenu] = useState<{ quote: TextQuote } | null>(null)
  useEffect(() => {
    if (jump) root.current?.querySelector(`[data-paper-page="${jump.page}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [jump])

  // native text selection → freeze the quote (menu clicks never lose it:
  // buttons preventDefault on mousedown and the quote is already snapshotted)
  useEffect(() => {
    if (!onTextPick) return
    const settle = () => {
      setTimeout(() => {
        const host = scrollHost.current
        if (!host) return
        const quote = readTextQuote(host)
        setMenu(quote ? { quote } : null)
      }, 0)
    }
    document.addEventListener('pointerup', settle)
    document.addEventListener('keyup', settle)
    return () => { document.removeEventListener('pointerup', settle); document.removeEventListener('keyup', settle) }
  }, [onTextPick])
  const pick = (action: QuoteAction) => {
    if (menu) onTextPick?.(menu.quote, action)
    setMenu(null)
  }

  return <>
    <div className="study-reader-toolbar">
      <span>向下滚动阅读 · 直接用鼠标选中文字提问</span>
      <span className="study-mode-group" role="group" aria-label="选区工具">
        <button type="button" aria-pressed={mode === 'text'} onClick={() => { setMode('text'); setMenu(null) }}>文字</button>
        <button type="button" aria-pressed={mode === 'rect'} title="扫描页/图表：拖一个矩形" onClick={() => { setMode('rect'); setMenu(null) }}>矩形</button>
        <button type="button" aria-pressed={mode === 'lasso'} title="绕着要问的内容画一圈" onClick={() => { setMode('lasso'); setMenu(null) }}>圈选</button>
      </span>
    </div>
    <div ref={(el) => { root.current = el; scrollHost.current = el }} className="study-paper-scroll study-continuous" onScroll={() => setMenu(null)}>
      {Array.from({ length: pages }, (_, i) => <ReadingPage key={`${url}:${i}`} url={url} page={i + 1} width={width} mode={mode} onVisible={onVisible} onRegion={onRegion} highlights={highlights} onRendered={onRendered} />)}
    </div>
    {menu && (
      <div className="study-selmenu" style={{ left: menu.quote.menuAt.x, top: menu.quote.menuAt.y }} role="menu">
        <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => pick('explain')}>解释这段</button>
        <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => pick('why')}>为什么</button>
        <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => pick('try')}>试一试</button>
        <span className="study-selmenu-src">p{menu.quote.pages.map((p) => p.page).join(',')}</span>
      </div>
    )}
  </>
}

export { unionBbox }
