// PDF.js page renderer for the paper shape (bbox-anchored overlays, not text
// needles: Docling already gave us exact boxes). Same worker wiring as the
// Kakeya Paper Mode (pdfjs-dist v4 ESM worker via ?url).
import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
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

export function usePdfPageSize(url: string, page: number) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const doc = await getDoc(url)
        const p = await doc.getPage(page)
        const vp = p.getViewport({ scale: 1 })
        if (!cancelled) setSize({ w: vp.width, h: vp.height })
      } catch (err) {
        console.error('[PdfCanvas] size', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [url, page])
  return size
}

export function PdfCanvas({
  url,
  page,
  width,
  highlight,
}: {
  url: string
  page: number
  width: number
  /** page-relative bbox (fractions) to flash-highlight */
  highlight?: { x: number; y: number; w: number; h: number } | null
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [height, setHeight] = useState(0)

  useEffect(() => {
    let cancelled = false
    const canvas = canvasRef.current
    if (!canvas) return
    void (async () => {
      try {
        const doc = await getDoc(url)
        const p = await doc.getPage(page)
        if (cancelled) return
        const base = p.getViewport({ scale: 1 })
        const scale = width / base.width
        const viewport = p.getViewport({ scale })
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        setHeight(Math.floor(viewport.height))
        const ctx = canvas.getContext('2d')!
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        await p.render({ canvasContext: ctx, viewport }).promise
      } catch (err) {
        console.error('[PdfCanvas] render', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [url, page, width])

  return (
    <div className="desk-pdf" style={{ width, height: height || undefined }}>
      <canvas ref={canvasRef} />
      {highlight && (
        <div
          className="desk-anchor-flash"
          style={{
            left: highlight.x * width,
            top: highlight.y * (height || 0),
            width: highlight.w * width,
            height: highlight.h * (height || 0),
          }}
        />
      )}
    </div>
  )
}
