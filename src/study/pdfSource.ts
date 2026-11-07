// CLI-151 结果一 — 浏览器优先的论文来源。
// PDF.js 在浏览器里逐页提取真实文本行：只作定位与正文证据（数学公式不能
// 靠碎片文本自动确认），每行带页码/区域/parser 标识，每页带实际字符数
// （0 = 无文本层/扫描件：如实"尚未读到"），整篇带内容哈希与覆盖。
// 重解析（Docling 精读）只在用户关心的页上按需发生，不全篇重跑两种。
import { version as pdfjsVersion } from 'pdfjs-dist'
import { getPdfDocument } from '../desk/PdfCanvas'

/** one extracted text line — a LOCATOR plus prose evidence, never a formula claim */
export interface TextLine {
  id: string
  page: number
  /** region on the page: fractions, top-left origin */
  bbox: { x: number; y: number; w: number; h: number }
  text: string
}

export interface PageSource {
  page: number
  lines: TextLine[]
  /** characters actually extracted — 0 means no text layer (e.g. a scan) */
  charCount: number
  /** wall time of this page's text extraction (same-process span) */
  ms: number
}

export const TEXT_PARSER = `pdfjs-text@${pdfjsVersion}`

interface Piece {
  x: number
  y: number
  w: number
  h: number
  str: string
}

/** extract one page's text lines with their regions */
export async function extractPage(pdfUrl: string, page: number): Promise<PageSource> {
  const started = performance.now()
  const doc = await getPdfDocument(pdfUrl)
  const p = await doc.getPage(page)
  const viewport = p.getViewport({ scale: 1 })
  const content = await p.getTextContent()
  const rows = new Map<number, Piece[]>()
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue
    const height = Math.abs(item.transform[3]) || item.height || 10
    const top = viewport.height - item.transform[5] - height
    const piece: Piece = { x: item.transform[4], y: top, w: item.width, h: height, str: item.str }
    // same baseline (±2 PDF units) → same line
    const key = Math.round(item.transform[5] / 2)
    const row = rows.get(key) ?? rows.get(key - 1) ?? rows.get(key + 1)
    if (row) row.push(piece)
    else rows.set(key, [piece])
  }
  const lines: TextLine[] = []
  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x)
    let text = ''
    let end = -Infinity
    for (const piece of row) {
      const gap = piece.x - end
      if (text && gap > piece.h * 0.18 && !text.endsWith(' ') && !piece.str.startsWith(' ')) text += ' '
      text += piece.str
      end = piece.x + piece.w
    }
    const x0 = Math.min(...row.map((r) => r.x))
    const x1 = Math.max(...row.map((r) => r.x + r.w))
    const y0 = Math.min(...row.map((r) => r.y))
    const y1 = Math.max(...row.map((r) => r.y + r.h))
    lines.push({
      id: '',
      page,
      bbox: {
        x: clamp01(x0 / viewport.width),
        y: clamp01(y0 / viewport.height),
        w: clamp01((x1 - x0) / viewport.width),
        h: clamp01((y1 - y0) / viewport.height),
      },
      text: text.trim(),
    })
  }
  lines.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)
  lines.forEach((l, i) => {
    l.id = `t${page}-${i}`
  })
  return {
    page,
    lines: lines.filter((l) => l.text.length > 0),
    charCount: lines.reduce((n, l) => n + l.text.length, 0),
    ms: Math.round(performance.now() - started),
  }
}

export async function pageCount(pdfUrl: string): Promise<number> {
  return (await getPdfDocument(pdfUrl)).numPages
}

/** the paper's content hash — every fragment and request carries it */
export async function sha256OfFile(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}
