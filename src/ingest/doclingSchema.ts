// Docling ingestion contract: the FastAPI server (server/main.py) runs Docling
// and returns raw JSON; this module is the single client-side normalizer.
// Anchors are page-relative (top-left origin, fractions) so any render scale
// maps them 1:1 onto the paper canvas (AGENTS.md §1 v5: source anchors bind
// the lab back to the original PDF).
export type ItemKind =
  | 'title'
  | 'section_header'
  | 'text'
  | 'formula'
  | 'figure'
  | 'table'
  | 'caption'
  | 'list_item'
  | 'footnote'

export interface AnchorBBox {
  /** fractions of page width/height, top-left origin */
  x: number
  y: number
  w: number
  h: number
}

export interface IngestedItem {
  id: string
  kind: ItemKind
  page: number
  bbox: AnchorBBox
  /** body text (text-ish kinds) */
  text?: string
  /** predicted LaTeX (formula kind) */
  latex?: string
}

export interface IngestedPage {
  page: number
  width: number
  height: number
}

export interface IngestedDoc {
  docId: string
  title: string
  engine: 'docling'
  doclingVersion: string
  pages: IngestedPage[]
  items: IngestedItem[]
}

interface RawItem {
  id?: string
  kind?: string
  page?: number
  bbox?: { x?: number; y?: number; w?: number; h?: number }
  text?: string | null
  latex?: string | null
}

const KNOWN_KINDS: ItemKind[] = [
  'title', 'section_header', 'text', 'formula', 'figure', 'table', 'caption', 'list_item', 'footnote',
]

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** normalize server JSON → IngestedDoc; throws on structurally unusable input */
export function normalizeDocling(raw: unknown): IngestedDoc {
  const r = raw as Partial<IngestedDoc> & { items?: RawItem[] }
  if (!r || typeof r !== 'object') throw new Error('ingest: response is not an object')
  if (!Array.isArray(r.pages) || r.pages.length === 0) throw new Error('ingest: no pages')
  if (!Array.isArray(r.items)) throw new Error('ingest: no items')
  if (typeof r.docId !== 'string' || !r.docId) throw new Error('ingest: missing docId')

  const items: IngestedItem[] = []
  let n = 0
  for (const it of r.items) {
    const kind = (KNOWN_KINDS as string[]).includes(it.kind ?? '') ? (it.kind as ItemKind) : 'text'
    if (typeof it.page !== 'number' || !it.bbox) continue
    const b = it.bbox
    if ([b.x, b.y, b.w, b.h].some((v) => typeof v !== 'number' || !Number.isFinite(v))) continue
    const latex = typeof it.latex === 'string' && it.latex.trim() ? it.latex.trim() : undefined
    const text = typeof it.text === 'string' && it.text.trim() ? it.text.trim() : undefined
    items.push({
      id: it.id ?? `p${it.page}-i${n}`,
      kind,
      page: it.page,
      bbox: {
        x: clamp01(b.x!),
        y: clamp01(b.y!),
        w: clamp01(b.w!),
        h: clamp01(b.h!),
      },
      text: text ?? latex,
      latex,
    })
    n++
  }
  return {
    docId: r.docId,
    title: r.title ?? 'Untitled paper',
    engine: 'docling',
    doclingVersion: r.doclingVersion ?? 'unknown',
    pages: r.pages,
    items,
  }
}

export function formulasOf(doc: IngestedDoc): IngestedItem[] {
  return doc.items.filter((i) => i.kind === 'formula' && !!i.latex)
}

/** concatenated text (titles first) — input to the adapter router */
export function docText(doc: IngestedDoc): string {
  return doc.items
    .filter((i) => i.kind !== 'formula' && i.kind !== 'figure' && i.text)
    .map((i) => i.text)
    .join('\n')
}
