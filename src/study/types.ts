// CLI-151 论文研究空间的入口负载：拖入的原文（本地 blob URL，只管当前预览）
// + 用户选的解析引擎 + 拖入时刻（首屏原文渲染耗时的起点，同进程单调时钟）。
import type { IngestMode } from '../ingest/upload'

export interface StudyPayload {
  file: File
  pdfUrl: string
  mode: IngestMode
  /** performance.now() at the drop — the PDF-first-paint span starts here */
  droppedAt: number
  /** the user's question typed on the home box, carried into the study space */
  initialQuestion?: string
}
