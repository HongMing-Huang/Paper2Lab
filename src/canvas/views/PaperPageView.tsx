// pdf.js page rendering + text-layer anchor highlight (pdfjs-dist v4:
// ESM worker via ?url; item.width/height are scale-1 device units, rects via
// viewport.convertToViewportRectangle at the same scale used for rendering).
import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const docCache = new Map<string, Promise<PDFDocumentProxy>>()
function getDoc(url: string) {
  let p = docCache.get(url)
  if (!p) {
    p = pdfjsLib.getDocument({ url }).promise
    docCache.set(url, p)
  }
  return p
}

interface PageText {
  /** items joined by single spaces */
  joined: string
  items: { text: string; start: number }[]
  raw: Array<{ transform?: number[]; width?: number; height?: number }>
}
const textCache = new Map<string, PageText>()

async function getPageText(doc: PDFDocumentProxy, url: string, pageNo: number): Promise<PageText> {
  const key = `${url}:${pageNo}`
  let cached = textCache.get(key)
  if (cached) return cached
  const page = await doc.getPage(pageNo)
  const content = await page.getTextContent()
  const items: PageText['items'] = []
  const raw: PageText['raw'] = []
  let joined = ''
  for (const item of content.items) {
    const str = (item as { str?: string }).str ?? ''
    const normStr = str.replace(/\s+/g, ' ')
    if (items.length > 0) joined += ' '
    items.push({ text: normStr, start: joined.length })
    joined += normStr
    raw.push(item as PageText['raw'][number])
  }
  cached = { joined, items, raw }
  textCache.set(key, cached)
  return cached
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

export interface AnchorRect {
  left: number
  top: number
  width: number
  height: number
}

export function PaperPageView({
  url,
  page: pageNo,
  widthCss,
  highlightNeedle,
  onAnchorFound,
}: {
  url: string
  page: number
  /** rendered page width in CSS px (height follows aspect) */
  widthCss: number
  /** text needle to highlight on this page (first match) */
  highlightNeedle?: string | null
  onAnchorFound?: (found: boolean) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [pageHeight, setPageHeight] = useState(0)
  const [rects, setRects] = useState<AnchorRect[]>([])

  useEffect(() => {
    let cancelled = false
    const canvas = canvasRef.current
    if (!canvas) return
    void (async () => {
      try {
        const doc = await getDoc(url)
        const page: PDFPageProxy = await doc.getPage(pageNo)
        if (cancelled) return
        const base = page.getViewport({ scale: 1 })
        const scale = widthCss / base.width
        const viewport = page.getViewport({ scale })
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        setPageHeight(Math.floor(viewport.height))
        const ctx = canvas.getContext('2d')!
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        await page.render({ canvasContext: ctx, viewport }).promise
        if (cancelled) return

        if (highlightNeedle) {
          const pt = await getPageText(doc, url, pageNo)
          if (cancelled) return
          const needle = norm(highlightNeedle)
          const at = pt.joined.indexOf(needle)
          if (at < 0) {
            setRects([])
            onAnchorFound?.(false)
            return
          }
          const matchEnd = at + needle.length
          const hitRects: AnchorRect[] = []
          for (let iIdx = 0; iIdx < pt.items.length; iIdx++) {
            const it = pt.items[iIdx]
            const end = it.start + it.text.length
            if (end < at || it.start > matchEnd) continue
            const rawItem = pt.raw[iIdx]
            if (!rawItem.transform) continue
            const [a, , , , x, y] = rawItem.transform
            const w = rawItem.width ?? 0
            const h = rawItem.height ?? Math.abs(a) * 10
            const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([x, y, x + w, y + h])
            hitRects.push({
              left: Math.min(x1, x2),
              top: Math.min(y1, y2),
              width: Math.abs(x2 - x1),
              height: Math.abs(y2 - y1),
            })
          }
          setRects(hitRects)
          onAnchorFound?.(hitRects.length > 0)
        } else {
          setRects([])
        }
      } catch (err) {
        console.error('[PaperPageView]', err)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, pageNo, widthCss, highlightNeedle])

  return (
    <div ref={wrapRef} className="paper-page nodrag nowheel" style={{ width: widthCss, height: pageHeight || undefined }}>
      <canvas ref={canvasRef} />
      {rects.map((r, i) => (
        <div key={i} className="anchor-highlight" style={r} />
      ))}
    </div>
  )
}
