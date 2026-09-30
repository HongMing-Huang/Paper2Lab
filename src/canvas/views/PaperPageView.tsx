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
  /** whitespace-collapsed text (single spaces) */
  joined: string
  /** nmap[k] = index of the text item owning character k of `joined` */
  nmap: number[]
  raw: Array<{ transform?: number[]; width?: number; height?: number }>
}
const textCache = new Map<string, PageText>()

async function getPageText(doc: PDFDocumentProxy, url: string, pageNo: number): Promise<PageText> {
  const key = `${url}:${pageNo}`
  let cached = textCache.get(key)
  if (cached) return cached
  const page = await doc.getPage(pageNo)
  const content = await page.getTextContent()
  // concatenate item strings, then collapse whitespace runs while keeping a
  // per-character -> item index map (PDF items split arbitrarily, incl. math;
  // multiple spaces appear between items, e.g. "in   R 3")
  let raw = ''
  const map: number[] = []
  const rawItems: PageText['raw'] = []
  for (let i = 0; i < content.items.length; i++) {
    rawItems.push(content.items[i] as PageText['raw'][number])
    const str = (content.items[i] as { str?: string }).str ?? ''
    for (const ch of str) {
      raw += ch
      map.push(i)
    }
    if (i < content.items.length - 1 && raw.length > 0 && !/\s$/.test(raw)) {
      raw += ' '
      map.push(i)
    }
  }
  let joined = ''
  const nmap: number[] = []
  let lastWasSpace = true
  for (let k = 0; k < raw.length; k++) {
    const ch = raw[k]
    if (/\s/.test(ch)) {
      if (!lastWasSpace) {
        joined += ' '
        nmap.push(map[k])
        lastWasSpace = true
      }
    } else {
      joined += ch
      nmap.push(map[k])
      lastWasSpace = false
    }
  }
  cached = { joined, nmap, raw: rawItems }
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

        if (!highlightNeedle) {
          setRects([])
          return
        }
        const needle = norm(highlightNeedle)
        const pt = await getPageText(doc, url, pageNo)
        if (cancelled) return
        const at = pt.joined.indexOf(needle)
        if (at < 0) {
          setRects([])
          onAnchorFound?.(false)
          return
        }
        const hitItems = new Set<number>()
        for (let k = at; k < at + needle.length && k < pt.nmap.length; k++) hitItems.add(pt.nmap[k])
        const hitRects: AnchorRect[] = []
        for (const iIdx of hitItems) {
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
    <div className="paper-page nodrag nowheel" style={{ width: widthCss, height: pageHeight || undefined }}>
      <canvas ref={canvasRef} />
      {rects.map((r, i) => (
        <div key={i} className="anchor-highlight" style={r} />
      ))}
    </div>
  )
}

/** Does `needle` appear on `page` of `url`? (for anchor verification) */
export async function anchorExists(url: string, page: number, needle: string): Promise<boolean> {
  const doc = await getDoc(url)
  const pt = await getPageText(doc, url, page)
  return pt.joined.indexOf(norm(needle)) >= 0
}
