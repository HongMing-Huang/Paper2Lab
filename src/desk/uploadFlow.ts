// PDF-first upload flow (#15): the ORIGINAL PAPER is viewable the moment a
// file is dropped — a blob URL is created IMMEDIATELY (before any parsing),
// the raw PDF renders in an embedded viewer while Docling runs, and a parse
// failure NEVER blocks access: the view stays up with a retry entry. Only
// success transitions to the desk (which then owns the URL).
import { ingestPdf, type IngestMode, type IngestProgress } from '../ingest/upload'
import type { IngestedDoc } from '../ingest/doclingSchema'
import type { AdapterDecision } from '../skills/adapterRouter'

export type UploadPhase = 'parsing' | 'failed' | 'done'

export interface UploadFlowState {
  phase: UploadPhase
  /** blob URL of the ORIGINAL pdf — exists from the first tick; the embedded
   *  viewer renders it during parsing AND after a failure (原文访问不阻断) */
  pdfUrl: string
  error: string | null
  doc: IngestedDoc | null
  decision: AdapterDecision | null
}

/** create the blob URL (test-shimable: node tests stub URL.createObjectURL) */
function objectUrlFor(file: File): string {
  return URL.createObjectURL(file)
}

/**
 * Start (or retry) a PDF-first upload. `existingUrl` lets a RETRY reuse the
 * already-created blob URL instead of leaking a second one.
 * Resolves ONLY when the flow settles — parsing errors resolve (not throw)
 * as `{phase:'failed'}` so the caller can keep the original-PDF view up.
 */
export async function runPdfFirstUpload(
  file: File,
  opts: {
    onProgress?: (p: IngestProgress) => void
    existingUrl?: string
    mode?: IngestMode
    /** CLI-151: job id as soon as the upload is accepted (enter the study
     *  view mid-parse and keep polling fragments there) */
    onJobId?: (jobId: string) => void
  } = {},
): Promise<UploadFlowState> {
  const pdfUrl = opts.existingUrl ?? objectUrlFor(file)
  try {
    const doc = await ingestPdf(file, {
      onProgress: opts.onProgress,
      mode: opts.mode,
      onJobId: opts.onJobId,
    })
    // dynamic import: routing pulls the cortex engine — only needed once the
    // parse settles, never on the first-paint path
    const { routeAdapter } = await import('../skills/adapterRouter')
    const decision = routeAdapter(doc)
    return { phase: 'done', pdfUrl, error: null, doc, decision }
  } catch (err) {
    return {
      phase: 'failed',
      pdfUrl,
      error: err instanceof Error ? err.message : String(err),
      doc: null,
      decision: null,
    }
  }
}
