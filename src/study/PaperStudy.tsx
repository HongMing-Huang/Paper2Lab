// CLI-151 论文研究空间 — 陌生 PDF 的一等入口（结果一 → 结果二）。
//
//   原文：本地 blob URL 经 PDF.js 立即渲染（首屏耗时从拖入算起）。
//   来源：浏览器先读文本层（页/行区域/parser/内容哈希/覆盖）；只有文件名或
//         无文本层时如实说"尚未读到"。精读（Docling/VLM）只针对用户关心的
//         页，按需发起，不全篇重跑两种。
//   请求：选中结构化公式 → 按数学结构匹配 Skill（自治 ODE→model.solve，
//         显式函数→formula.plot），每个值标论文原句/用户提供/缺失；缺就
//         needs_input、不支持就 unsupported，从不补默认值。
//   计算：Node operation → 任务/worker/fencing → PG 原子 Run；界面映射真实
//         状态，并把各进程各自测到的分段时间并列展示（嵌套跨度不相加）。
//   AI：有凭据才发真实 Qwen 回合；论文内容作为不可信数据传入；AI 只能
//         指向公式，数值从不作为论文证据。没有凭据就如实说未执行。
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import '../research/research.css'
import './study.css'
import { ContinuousPaper, unionBbox, type Clipping, type PaperRegion } from './ContinuousPaper'
import type { WorldDefinition } from '../mathworld/definition'
import { host as gameHost } from '../mathworld/host'
const StudyGamePanel = lazy(() => import('./StudyGamePanel').then((m) => ({ default: m.StudyGamePanel })))
import { extractPage, pageCount, sha256OfFile, TEXT_PARSER, type PageSource, type TextLine } from './pdfSource'
import { ingestPdf, ingestJobRecord, ingestClientId, type IngestMode } from '../ingest/upload'
import type { IngestedDoc, IngestedItem } from '../ingest/doclingSchema'
import type { AdapterDecision } from '../skills/adapterRouter'
import type { StudyPayload } from './types'
import {
  buildCandidate,
  requestInput,
  type FormulaFragment,
  type MathRequestCandidate,
  type ProseLine,
  type UserChoices,
  type ValueField,
} from './requestCandidate'
import { buildPlan } from '../skills/playPlan'
import { runPdfFirstUpload } from '../desk/uploadFlow'
import { worldFromOdeCandidate, worldFromFormulaCandidate, type GameRules } from './worldFromRun'
import { AgentDock } from './AgentDock'
import './agent-dock.css'

const SCIENCE_BASE = '/api/v1/science'
/** background text-layer reads stop here; later pages read when visited */
const TEXT_PREFETCH_PAGES = 30
/** research API caps a prompt at 8000 characters */
const DOCLING_STAGE_LABEL: Record<string, string> = {
  doc_enrich: '公式识别模型（doc_enrich）',
  layout: '版面模型（layout）',
  ocr: 'OCR',
  page_parse: '页面解析（page_parse）',
  table_structure: '表格结构',
  doc_assemble: '文档组装',
  reading_order: '阅读顺序',
  page_assemble: '页面组装',
  layout_postprocess: '版面后处理',
}

interface Span {
  name: string
  ms: number
  where: 'browser' | 'server' | 'worker' | 'engine' | 'db'
  detail?: string
}

interface PageParse {
  status: 'running' | 'done' | 'error'
  mode: IngestMode
  parser?: string
  items: IngestedItem[]
  error?: string
}

type Selection = { kind: 'formula'; fragment: FormulaFragment } | { kind: 'line'; line: TextLine }

interface RunView {
  runId: string
  kind: string
  status: string
  durationMs: number
  engine: string
  engineVersion: string
  result: Record<string, unknown>
}

interface Computation {
  status: 'submitting' | 'queued' | 'running' | 'completed' | 'error' | 'cancelled' | 'needs_input' | 'unsupported'
  operationId: string
  message?: string
  run?: RunView
  sample: number
}

interface AiPointer {
  turnId: number
  latex: string
  page: number | null
}

function parserOf(doc: IngestedDoc): string {
  return doc.engine === 'vlm' ? `vlm:${doc.doclingVersion}` : `docling@${doc.doclingVersion}`
}

function fmt(n: number): string {
  return Number.isFinite(n) ? String(Number(n.toPrecision(6))) : String(n)
}

/** short content hash for stable React keys (no collision on same-length strings) */
function hashSnippet(text: string): string {
  let h = 0
  for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0
  return `${(h >>> 0).toString(36)}-${text.length}`
}

function RunChart({ run }: { run: RunView }) {
  const W = 360
  const H = 150
  const series: Array<{ name: string; xs: number[]; ys: number[] }> = []
  const r = run.result
  if (Array.isArray(r.points)) {
    const pts = r.points as Array<[number, number]>
    series.push({ name: 'y', xs: pts.map((p) => p[0]), ys: pts.map((p) => p[1]) })
  } else if (Array.isArray(r.t) && Array.isArray(r.series)) {
    for (const s of (r.series as Array<{ state: string; values: number[] }>).slice(0, 4)) {
      series.push({ name: s.state, xs: r.t as number[], ys: s.values })
    }
  }
  if (series.length === 0) return null
  const allX = series.flatMap((s) => s.xs)
  const allY = series.flatMap((s) => s.ys)
  const [x0, x1] = [Math.min(...allX), Math.max(...allX)]
  const [y0, y1] = [Math.min(...allY, 0), Math.max(...allY, 0)]
  const sx = (x: number) => 6 + ((x - x0) / (x1 - x0 || 1)) * (W - 12)
  const sy = (y: number) => H - 6 - ((y - y0) / (y1 - y0 || 1)) * (H - 12)
  const colors = ['#2563eb', '#c2410c', '#15803d', '#7c3aed']
  return (
    <svg width={W} height={H} className="study-run-chart" role="img" aria-label={`Run ${run.runId}`}>
      <line x1={6} x2={W - 6} y1={sy(0)} y2={sy(0)} stroke="#d6cfc2" strokeDasharray="3 3" />
      {series.map((s, k) => {
        const step = Math.max(1, Math.floor(s.xs.length / 600))
        const d = s.xs.filter((_, i) => i % step === 0).map((x, i) => `${i === 0 ? 'M' : 'L'}${sx(x).toFixed(1)},${sy(s.ys[i * step]).toFixed(1)}`).join(' ')
        return <path key={s.name} d={d} fill="none" stroke={colors[k % colors.length]} strokeWidth="1.5" />
      })}
      {series.map((s, k) => (
        <text key={`l-${s.name}`} x={W - 8} y={14 + k * 13} textAnchor="end" fontSize="11" fill={colors[k % colors.length]}>{s.name}</text>
      ))}
    </svg>
  )
}

function ValueRow({ field, kind, onChange }: { field: ValueField; kind: string; onChange: (v: number | null) => void }) {
  const src = field.source
  return (
    <tr className={`study-value ${src.kind}`}>
      <td className="study-value-name">{kind === 'initial' ? `${field.name}(0)` : field.name}</td>
      <td>
        <input
          type="number"
          step="any"
          value={field.value ?? ''}
          placeholder="缺"
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          data-testid={`value-${kind}-${field.name}`}
        />
      </td>
      <td className="study-value-src">
        {src.kind === 'paper' && (
          <span title={src.quote}>论文第 {src.page} 页 · {src.parser}「{src.quote.slice(0, 60)}{src.quote.length > 60 ? '…' : ''}」</span>
        )}
        {src.kind === 'user' && <span>你提供（记为实验假设）</span>}
        {src.kind === 'missing' && <span className="miss">缺：论文中未读到数值</span>}
      </td>
    </tr>
  )
}

export function PaperStudy({
  payload,
  onExit,
  onDesk,
}: {
  payload: StudyPayload
  onExit: () => void
  onDesk: (file: File, pdfUrl: string, doc: IngestedDoc, decision: AdapterDecision) => void
}) {
  const { file, pdfUrl, droppedAt } = payload
  const [numPages, setNumPages] = useState<number | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [sha, setSha] = useState<string | null>(null)
  const [texts, setTexts] = useState<Record<number, PageSource>>({})
  const [parses, setParses] = useState<Record<number, PageParse>>({})
  const [page, setPage] = useState(1)
  const [readerJump, setReaderJump] = useState<{ page: number; token: number }>()
  const [region, setRegion] = useState<(PaperRegion & { text: string }) | null>(null)
  /** CLI-111 多选区集合：文字/矩形/圈选全部累积，可删除/可定位，不覆盖 */
  const [clippings, setClippings] = useState<Clipping[]>([])
  const addClipping = (c: Omit<Clipping, 'id' | 'at'>) => {
    setClippings((prev) => [...prev.slice(-19), { ...c, id: `c${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, at: Date.now() }])
  }
  const [questionRequest, setQuestionRequest] = useState<{ id: number; text: string }>()
  /** the shared research session id (AgentDock reports it; the game-panel host
   *  bridge addresses world actions with it) */
  const [researchSessionId, setResearchSessionId] = useState<string | null>(null)
  const [playWorld, setPlayWorld] = useState<WorldDefinition | null>(null)
  const [showSetup, setShowSetup] = useState(false)
  const goToPage = (p: number) => { setPage(p); setReaderJump({ page: p, token: Date.now() }) }

  const [parseMode, setParseMode] = useState<IngestMode>(payload.mode)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [choices, setChoices] = useState<UserChoices>({})
  const [spans, setSpans] = useState<Span[]>([])
  const [computation, setComputation] = useState<Computation | null>(null)
  const [fullParse, setFullParse] = useState<{ status: 'running' | 'refused' | 'error'; message?: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [paperWidth, setPaperWidth] = useState(640)
  const paperRef = useRef<HTMLDivElement>(null)
  const firstPaintRef = useRef(false)
  const aliveRef = useRef(true)

  const addSpan = useCallback((s: Span) => setSpans((prev) => [...prev, s]), [])

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // the paper column width drives the canvas render width
  useEffect(() => {
    const el = paperRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setPaperWidth(Math.max(320, Math.min(860, el.clientWidth - 24))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // open the document, hash it, then read the text layer page by page
  useEffect(() => {
    let cancelled = false
    const opened = performance.now()
    void pageCount(pdfUrl)
      .then(async (n) => {
        if (cancelled) return
        setNumPages(n)
        addSpan({ name: 'PDF.js 打开文档', ms: Math.round(performance.now() - opened), where: 'browser', detail: `${n} 页 · ${(file.size / 1024).toFixed(0)} KB` })
        for (let p = 1; p <= Math.min(n, TEXT_PREFETCH_PAGES); p++) {
          if (cancelled) return
          const src = await extractPage(pdfUrl, p)
          if (cancelled) return
          setTexts((prev) => (prev[p] ? prev : { ...prev, [p]: src }))
          if (p === 1) addSpan({ name: '文本层第 1 页', ms: src.ms, where: 'browser', detail: `${src.lines.length} 行 · ${src.charCount} 字符` })
        }
      })
      .catch((err: unknown) => setPdfError(err instanceof Error ? err.message : String(err)))
    void sha256OfFile(file).then((h) => !cancelled && setSha(h))
    return () => {
      cancelled = true
    }
  }, [pdfUrl, file, addSpan])

  // a page beyond the prefetch window is read when visited
  useEffect(() => {
    if (texts[page] || !numPages || page > numPages) return
    let cancelled = false
    void extractPage(pdfUrl, page).then((src) => !cancelled && setTexts((prev) => ({ ...prev, [page]: src })))
    return () => {
      cancelled = true
    }
  }, [page, numPages, pdfUrl, texts])

  const onRendered = useCallback(
    (p: number) => {
      if (firstPaintRef.current || p !== 1) return
      firstPaintRef.current = true
      addSpan({ name: '原文首屏渲染（拖入→第 1 页画出）', ms: Math.round(performance.now() - droppedAt), where: 'browser' })
    },
    [addSpan, droppedAt],
  )

  /** 精读：only the page the user is looking at, on demand. m6: only the
   *  LATEST request for a page may settle its state (an older superseded
   *  request must not overwrite the newer one's running/done entry). */
  const parseEpochRef = useRef(0)
  const parseAbortRef = useRef<AbortController | null>(null)
  useEffect(() => () => parseAbortRef.current?.abort(), [])
  const parsePage = useCallback(
    async (p: number, mode: IngestMode) => {
      const epoch = ++parseEpochRef.current
      parseAbortRef.current?.abort()
      const pollAbort = new AbortController()
      parseAbortRef.current = pollAbort
      setParses((prev) => ({ ...prev, [p]: { status: 'running', mode, items: [] } }))
      const started = performance.now()
      let jobId: string | null = null
      try {
        const doc = await ingestPdf(file, {
          mode,
          pages: [p, p],
          clientId: `${ingestClientId()}:p${p}`.slice(0, 64),
          remember: false,
          signal: pollAbort.signal,
          onJobId: (id) => {
            jobId = id
          },
        })
        const clientMs = Math.round(performance.now() - started)
        if (!aliveRef.current || epoch !== parseEpochRef.current) return
        const parser = parserOf(doc)
        setParses((prev) => ({ ...prev, [p]: { status: 'done', mode, parser, items: doc.items.filter((it) => it.page === p) } }))
        addSpan({ name: `精读第 ${p} 页（浏览器提交→结果到达）`, ms: clientMs, where: 'browser', detail: parser })
        if (jobId) {
          const rec = await ingestJobRecord(jobId)
          if (!aliveRef.current || epoch !== parseEpochRef.current) return
          if (rec.wallMs !== null) addSpan({ name: `精读第 ${p} 页 · 服务端任务`, ms: rec.wallMs, where: 'server', detail: '含排队与上传落盘' })
          const t = rec.timing ?? {}
          if (typeof t.slotWaitMs === 'number') addSpan({ name: '解析槽位等待', ms: t.slotWaitMs, where: 'server' })
          if (typeof t.workerLockWaitMs === 'number') addSpan({ name: '常驻解析进程等待', ms: t.workerLockWaitMs, where: 'server' })
          const cold = t.cold === true ? '冷（本次加载模型）' : t.cold === false ? '暖（模型已在进程内）' : ''
          for (const s of (Array.isArray(t.spans) ? t.spans : []) as Array<{ name: string; ms: number; page?: number }>) {
            addSpan({ name: s.name, ms: s.ms, where: 'server', detail: [s.page ? `第 ${s.page} 页` : '', s.name === 'docling.convert' ? cold : ''].filter(Boolean).join(' · ') })
            if (s.name !== 'docling.convert') continue
            // docling's own profiler: where the conversion actually went
            const stages = Object.entries((t.doclingStagesMs ?? {}) as Record<string, number>)
              .filter(([k, ms]) => k !== 'pipeline_total' && ms >= 1)
              .sort((a, b) => b[1] - a[1])
            stages.forEach(([k, ms], i) => {
              addSpan({ name: `  ${i === stages.length - 1 ? '└' : '├'} ${DOCLING_STAGE_LABEL[k] ?? k}`, ms, where: 'server', detail: 'docling 内部' })
            })
          }
        }
      } catch (err) {
        if (!aliveRef.current || epoch !== parseEpochRef.current) return
        if (err instanceof Error && err.message.startsWith('ingest aborted')) return // unmount/superseded by a newer parse
        setParses((prev) => ({ ...prev, [p]: { status: 'error', mode, items: [], error: err instanceof Error ? err.message : String(err) } }))
      }
    },
    [file, addSpan],
  )

  const formulas: FormulaFragment[] = useMemo(
    () =>
      Object.values(parses).flatMap((pp) =>
        pp.status === 'done'
          ? pp.items
              .filter((it) => it.kind === 'formula' && it.latex)
              .map((it) => ({ id: it.id, page: it.page, latex: it.latex as string, parser: pp.parser ?? 'parsed', bbox: it.anchorPrecision === 'page' ? undefined : it.bbox }))
          : [],
      ),
    [parses],
  )

  const prose: ProseLine[] = useMemo(() => {
    const out: ProseLine[] = []
    for (const pp of Object.values(parses)) {
      if (pp.status !== 'done') continue
      for (const it of pp.items) if (it.kind !== 'formula' && it.text) out.push({ id: it.id, page: it.page, text: it.text, parser: pp.parser ?? 'parsed' })
    }
    for (const src of Object.values(texts)) for (const l of src.lines) out.push({ id: l.id, page: l.page, text: l.text, parser: TEXT_PARSER })
    return out
  }, [parses, texts])

  const candidate: MathRequestCandidate | null = useMemo(
    () => (selection?.kind === 'formula' ? buildCandidate(selection.fragment, formulas, prose, choices) : null),
    [selection, formulas, prose, choices],
  )

  const select = (s: Selection) => {
    setShowSetup(true)
    setSelection(s)
    setChoices({})
    setComputation(null)
    goToPage(s.kind === 'formula' ? s.fragment.page : s.line.page)
  }

  /** structured picks (formula/line) become the active region too, so their
   *  on-page bbox stays highlighted through the same reader path */
  const pickHighlight = selection?.kind === 'formula'
    ? (selection.fragment.page === page ? selection.fragment.bbox ?? null : null)
    : selection?.kind === 'line' && selection.line.page === page ? selection.line.bbox : null
  const activeReaderHighlight = region ?? (pickHighlight ? { page, bbox: pickHighlight, text: '' } : null)

  /** candidate → Node operation → real Run; every span from where it was measured */
  const compute = useCallback(
    async (c: MathRequestCandidate, sample: number) => {
      let input: Record<string, unknown>
      try {
        input = requestInput(c)
      } catch (err) {
        setNotice(String(err))
        return
      }
      const pages = [...new Set(c.equations.map((e) => e.page))].sort((a, b) => a - b)
      const plan = buildPlan({ skill: c.skill, goal: `论文研究空间：${file.name} 第 ${pages.join(',')} 页 ${c.structure}`, inputs: input })
      const source = {
        kind: 'paper-study',
        fileSha256: sha,
        fileName: file.name,
        pages,
        formulas: c.equations.map((e) => ({ fragmentId: e.fragmentId, page: e.page, parser: e.parser })),
        values: [...c.params, ...c.initials].map((v) => ({ name: v.name, ...(v.source.kind === 'paper' ? { kind: 'paper', page: v.source.page, lineId: v.source.lineId, parser: v.source.parser } : { kind: v.source.kind }) })),
        span: { kind: 'user' },
      }
      const operationId = `study-${(sha ?? 'nosha').slice(0, 10)}-${Date.now().toString(36)}`
      setComputation({ status: 'submitting', operationId, sample })
      const t0 = performance.now()
      try {
        const res = await fetch(`${SCIENCE_BASE}/operations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ operationId, skill: c.skill, input, plan, source }),
        })
        const body = (await res.json()) as { status?: string; state?: string; message?: string }
        addSpan({ name: `提交计算（第 ${sample} 次）`, ms: Math.round(performance.now() - t0), where: 'browser', detail: `HTTP ${res.status}` })
        if (!res.ok && res.status !== 202) {
          setComputation({ status: (body.state as Computation['status']) ?? 'error', operationId, message: body.message ?? `HTTP ${res.status}`, sample })
          return
        }
        setComputation({ status: 'queued', operationId, sample })
        const deadline = Date.now() + 120_000
        for (;;) {
          if (!aliveRef.current) return
          if (Date.now() > deadline) {
            setComputation({ status: 'error', operationId, message: '120 秒内未收到正式回执（任务仍可能在后台完成）', sample })
            return
          }
          await new Promise((r) => setTimeout(r, 200))
          const op = (await (await fetch(`${SCIENCE_BASE}/operations/${encodeURIComponent(operationId)}`)).json()) as {
            status: string
            runId: string | null
            receipt?: Record<string, unknown> & { message?: string; usage?: Record<string, unknown> }
          }
          if (op.status === 'accepted') {
            setComputation((prev) => (prev && prev.status === 'queued' ? { ...prev, status: 'running' } : prev))
            continue
          }
          addSpan({ name: `计算完成被浏览器观察到（第 ${sample} 次）`, ms: Math.round(performance.now() - t0), where: 'browser', detail: op.status })
          const u = op.receipt?.usage ?? {}
          if (typeof u.queueWaitMs === 'number') addSpan({ name: '任务排队（提交→领取）', ms: u.queueWaitMs, where: 'db' })
          if (typeof u.prepareMs === 'number') addSpan({ name: 'worker 准备请求', ms: u.prepareMs, where: 'worker' })
          if (typeof u.engineWallMs === 'number') addSpan({ name: '引擎进程（创建→退出）', ms: u.engineWallMs, where: 'worker', detail: String(u.engineMode ?? '') })
          const e = (u.engine ?? {}) as Record<string, number>
          if (typeof e.bootMs === 'number') addSpan({ name: '  ├ Node 启动+制品导入', ms: e.bootMs, where: 'engine' })
          if (typeof e.executeMs === 'number') addSpan({ name: '  ├ 执行（计划门+编译+计算+封存）', ms: e.executeMs, where: 'engine' })
          if (typeof e.outputBytes === 'number') addSpan({ name: '  └ 结果输出', ms: 0, where: 'engine', detail: `${(e.outputBytes / 1024).toFixed(1)} KB` })
          if (typeof u.verifyMs === 'number') addSpan({ name: '候选校验', ms: u.verifyMs, where: 'worker' })
          if (op.status !== 'completed' || !op.runId) {
            setComputation({ status: op.status as Computation['status'], operationId, message: op.receipt?.message ?? op.status, sample })
            return
          }
          const f0 = performance.now()
          const runRes = await fetch(`${SCIENCE_BASE}/runs/${encodeURIComponent(op.runId)}`)
          const text = await runRes.text()
          const rec = (JSON.parse(text) as { run: RunView }).run
          addSpan({ name: '读取 Run（传输+解析）', ms: Math.round(performance.now() - f0), where: 'browser', detail: `${(text.length / 1024).toFixed(1)} KB` })
          addSpan({ name: 'Run.durationMs（executeSpec 内计算）', ms: rec.durationMs, where: 'engine' })
          setComputation({ status: 'completed', operationId, run: rec, sample })
          return
        }
      } catch (err) {
        setComputation({ status: 'error', operationId, message: err instanceof Error ? err.message : String(err), sample })
      }
    },
    [file.name, sha, addSpan],
  )

  /** explicit fallback: a full parse → prebuilt experiment desk when one matches */
  const openDesk = useCallback(async () => {
    setFullParse({ status: 'running' })
    const out = await runPdfFirstUpload(file, { existingUrl: pdfUrl, mode: parseMode })
    if (!aliveRef.current) return
    if (out.phase === 'done' && out.doc && out.decision?.status === 'ok') {
      const { routeAdapterWithLlm } = await import('../skills/adapterRouter')
      const decision = await routeAdapterWithLlm(out.doc)
      onDesk(file, pdfUrl, out.doc, decision)
      return
    }
    if (out.phase === 'done' && out.decision) {
      setFullParse({ status: 'refused', message: `${out.decision.reason}——继续在此研究：选公式形成请求即可真实计算` })
      return
    }
    setFullParse({ status: 'error', message: out.error ?? '完整解析未完成' })
  }, [file, pdfUrl, parseMode, onDesk])

  const pointAt = (ptr: AiPointer) => {
    // unique per pointer CONTENT (same-length pointers in one turn collide)
    const fragment: FormulaFragment = { id: `ai-${ptr.turnId}-${hashSnippet(ptr.latex)}`, page: ptr.page ?? page, latex: ptr.latex, parser: 'ai-pointer（模型转写，需核对原文）' }
    select({ kind: 'formula', fragment })
  }

  /** 结果三: the confirmed candidate + its committed Run → a MathWorld world
   *  the USER configures (ranges, draggable start, goal) — never AI-authored */
  const [worldRules, setWorldRules] = useState<GameRules>({
    ranges: {},
    draggable: null,
    initialRanges: {},
    goal: [],
    attempts: 8,
    mode: 'explore',
  })
  const [worldResult, setWorldResult] = useState<{ ok: boolean; message: string; href?: string } | null>(null)

  useEffect(() => {
    // sensible defaults per candidate: every paper param ±50% adjustable
    if (!candidate) return
    setWorldRules((prev) => ({
      ...prev,
      ranges: Object.fromEntries(
        candidate.params.map((p) => {
          const v = p.value ?? 1
          const pad = Math.max(Math.abs(v) * 0.5, 0.1)
          const old = prev.ranges[p.name]
          return [p.name, old && old.min <= v && v <= old.max ? old : { min: Number((v - pad).toPrecision(4)), max: Number((v + pad).toPrecision(4)) }]
        }),
      ),
      draggable: prev.draggable && candidate.states.includes(prev.draggable[0]) && candidate.states.includes(prev.draggable[1]) ? prev.draggable : null,
      initialRanges: Object.fromEntries(candidate.states.map((s) => {
        const init = candidate.initials.find((i) => i.name === s)?.value ?? 0
        const pad = Math.max(0.1, Math.abs(init))
        return [s, prev.initialRanges[s] ?? { min: Number((init - pad).toPrecision(4)), max: Number((init + pad).toPrecision(4)) }]
      })),
    }))
  }, [candidate])

  const generateWorld = useCallback(() => {
    if (!candidate || !computation?.run || !sha) return
    const prov = { fileName: file.name, fileSha256: sha, pages: [...new Set(candidate.equations.map((e) => e.page))] }
    const built = candidate.structure === 'autonomous-ode'
      ? worldFromOdeCandidate(candidate,
        { runId: computation.run.runId, perState: computation.run.result.perState as Array<{ state: string; min: number; max: number }> }, worldRules, prov)
      : worldFromFormulaCandidate(candidate,
        { runId: computation.run.runId, points: computation.run.result.points as Array<[number, number]> }, { ...worldRules, mode: 'explore', goal: [] }, prov)
    if ('errors' in built) { setWorldResult({ ok: false, message: built.errors.join('；') }); return }
    setPlayWorld(built.world)
    setShowSetup(false)
    setWorldResult({ ok: true, message: '当前论文的数学模型已交给右侧游戏台，场景将由同一内核重新计算。' })
  }, [candidate, computation, sha, worldRules, file.name])

  /** 结果二: the committed Run no longer matches the candidate inputs → stale */
  const runStale = useMemo(() => {
    if (!computation?.run || !candidate || computation.status !== 'completed') return false
    // the Run record nests its model block under spec (spec.model.rhs/…)
    const spec = (computation.run as unknown as { spec?: { model?: { params?: Record<string, number>; initialState?: Record<string, number>; rhs?: Record<string, string>; states?: string[]; expression?: string; values?: Record<string, number> } } }).spec
    const model = spec?.model
    let inputs: Record<string, unknown>
    try {
      inputs = requestInput(candidate)
    } catch {
      return true
    }
    if (!model) return true
    const normalized = (x: unknown): string => JSON.stringify(x, (_, v: unknown) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v)
    if (candidate.skill === 'model.solve') {
      return ['states', 'rhs', 'params', 'initialState', 'tSpan'].some((k) => normalized((model as Record<string, unknown>)[k]) !== normalized(inputs[k]))
    }
    return ['expression', 'independent', 'range', 'values', 'parameters', 'samples'].some((k) => normalized((model as Record<string, unknown>)[k]) !== normalized(inputs[k]))
  }, [computation, candidate])

  /** 结果二: cancel the in-flight operation (server kills its engine) */
  const cancelComputation = useCallback(async () => {
    if (!computation || !['submitting', 'queued', 'running'].includes(computation.status)) return
    try {
      const op = await (await fetch(`${SCIENCE_BASE}/operations/${encodeURIComponent(computation.operationId)}`)).json() as { taskId?: number }
      if (typeof op.taskId === 'number') await fetch(`${SCIENCE_BASE}/tasks/${op.taskId}/cancel`, { method: 'POST' })
      setNotice('已请求取消（引擎进程退出后回执落账）')
    } catch (err) {
      setNotice(`取消请求失败：${err instanceof Error ? err.message : err}`)
    }
  }, [computation])


  // --------------------------------------------------------------- render
  const textPagesRead = Object.keys(texts).length
  const parsedPages = Object.values(parses).filter((p) => p.status === 'done').length
  const pageText = texts[page]
  const pageParse = parses[page]
  const setUser = (kind: 'params' | 'initials', name: string, v: number | null) =>
    setChoices((prev) => {
      const next = { ...(prev[kind] ?? {}) }
      if (v === null || !Number.isFinite(v)) delete next[name]
      else next[name] = v
      return { ...prev, [kind]: next }
    })

  return (
    <div className="study-root" data-testid="study-root">
      <header className="study-header">
        <button type="button" className="research-exit" onClick={onExit}>← 返回</button>
        <h1>Paper2Lab · 读与玩</h1>
        <span className="study-file" title={file.name}>{file.name}</span>
        <span className="study-coverage" data-testid="study-coverage">
          {numPages === null ? (pdfError ? `原文无法打开：${pdfError}` : '正在打开原文…') : `共 ${numPages} 页 · 文本层已读 ${textPagesRead} 页 · 精读 ${parsedPages} 页`}
        </span>
        <span className="study-sha" title={sha ?? ''}>{sha ? `sha256 ${sha.slice(0, 10)}…` : ''}</span>
        <details className="study-header-actions"><summary>阅读设置</summary>
          <label className="study-mode">
            精读引擎
            <select value={parseMode} onChange={(e) => setParseMode(e.target.value as IngestMode)} data-testid="study-parse-mode">
              <option value="docling">Docling（区域锚点）</option>
              <option value="vlm">快速理解（AI 读图）</option>
            </select>
          </label>
          <button type="button" className="desk-btn" data-testid="study-full-parse" disabled={fullParse?.status === 'running'} onClick={() => void openDesk()}>
            {fullParse?.status === 'running' ? '完整解析中…' : '完整解析 → 实验台'}
          </button>
        </details>
      </header>
      {fullParse && fullParse.status !== 'running' && <div className={`study-banner ${fullParse.status}`} data-testid="study-full-parse-result">{fullParse.message}</div>}
      {notice && <div className="study-banner error" data-testid="study-notice">{notice}</div>}

      <div className="study-main">
        <section className="study-paper" ref={paperRef} data-testid="study-paper">
          {numPages && <ContinuousPaper url={pdfUrl} pages={numPages} width={paperWidth} onRendered={onRendered} jump={readerJump} onVisible={setPage}
            highlights={[
              // active (last pick or structured formula/line pick) first → the
              // strong mark; the same clipping is newest, so drop it from the tail
              ...(activeReaderHighlight ? [{ page: activeReaderHighlight.page, bbox: activeReaderHighlight.bbox, ...(activeReaderHighlight.path ? { path: activeReaderHighlight.path } : {}) }] : []),
              ...clippings.slice(0, region ? -1 : undefined).map((c) => ({ page: c.page, bbox: c.bbox, ...(c.path ? { path: c.path } : {}) })),
            ]}
            onTextPick={(quote, action) => {
              // freeze the quote as the reader region: highlight + context carry
              // the ORIGINAL text with per-page rects (never re-attributed)
              const first = quote.pages[0]!
              const all = quote.pages.flatMap((p) => p.rects)
              const joined = quote.pages.map((p) => `【第${p.page}页】${p.text}`).join('\n')
              setRegion({ page: first.page, bbox: unionBbox(all), text: joined })
              addClipping({ kind: 'text', page: first.page, bbox: unionBbox(all), text: joined })
              setPage(first.page)
              if (action === 'try') {
                // 试一试：真实的结构化识别 + 让 AI 从选区指向可计算公式；
                // 复制的 PDF 文本本身不当公式证据
                setShowSetup(true)
                void parsePage(first.page, parseMode)
                setQuestionRequest({ id: Date.now(), text: '我想亲手试试刚才选中的内容：请指出其中可计算的公式和它需要的全部条件（初值/参数）；如果选区文本不能确认公式结构（上下标/符号可能在复制中丢失），明确说需要哪一步识别，不要猜。' })
              } else if (action === 'why') {
                setQuestionRequest({ id: Date.now(), text: '为什么：结合选中段落（上下文里有原文），解释这一步推理/定义为什么成立，以及它在论文中起什么作用；若与右侧世界或已算 Run 相关，用真实数值说明。' })
              } else {
                setQuestionRequest({ id: Date.now(), text: '请解释我选中的这段（上下文里有原文与页码）：先一句直观说明，再说明它与论文公式、可操作实验的关系。' })
              }
            }}
            onRegion={(picked) => {
              void extractPage(pdfUrl, picked.page).then((source) => {
                const b = picked.bbox
                const text = source.lines.filter((l) => l.bbox.x < b.x + b.w && l.bbox.x + l.bbox.w > b.x && l.bbox.y < b.y + b.h && l.bbox.y + l.bbox.h > b.y).map((l) => l.text).join('\n')
                setRegion({ ...picked, text }); setPage(picked.page)
                addClipping({ kind: picked.path ? 'lasso' : 'rect', page: picked.page, bbox: picked.bbox, ...(picked.path ? { path: picked.path } : {}), text })
                setQuestionRequest({ id: Date.now(), text: text ? `请解释我${picked.path ? '圈选' : '框选'}的内容，先直观说明，再说明与论文公式和可操作实验的关系。` : `这处${picked.path ? '圈选' : '框选'}没有可读文本，请告诉我还需要哪些识别结果，不要猜测公式。` })
              }).catch((e: unknown) => setNotice(String(e)))
            }} />}
          {clippings.length > 0 && (
            <div className="study-clippings" data-testid="study-clippings">
              <div className="study-clippings-head">选区集合（{clippings.length}）· 新选区会累积，不覆盖</div>
              <ul>
                {[...clippings].reverse().map((c) => (
                  <li key={c.id} className={`study-clipping k-${c.kind}`}>
                    <span className={`study-clipping-kind k-${c.kind}`}>{c.kind === 'text' ? '文字' : c.kind === 'rect' ? '矩形' : '圈选'}</span>
                    <span className="study-clipping-page">p{c.page}</span>
                    <span className="study-clipping-text">{c.text ? c.text.replace(/【第\d+页】/g, '').slice(0, 60) : '（无可读文本）'}</span>
                    <span className="study-clipping-ops">
                      <button type="button" title="回到原文位置" onClick={() => { setReaderJump({ page: c.page, token: Date.now() }); setRegion({ page: c.page, bbox: c.bbox, text: c.text, ...(c.path ? { path: c.path } : {}) }); setPage(c.page) }}>定位</button>
                      <button type="button" title="就该选区提问" onClick={() => setQuestionRequest({ id: Date.now(), text: `请解释选区集合里这条（p${c.page}）：${(c.text || '无可读文本').slice(0, 120)}` })}>发问</button>
                      <button type="button" title="从集合删除" onClick={() => setClippings((prev) => prev.filter((x) => x.id !== c.id))}>删除</button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <aside className="study-side study-play-side">
          <div className="study-stage-slot">
            {playWorld ? <Suspense fallback={<div className="study-game-placeholder">正在加载数学游戏台…</div>}><StudyGamePanel world={playWorld} sessionId={researchSessionId} onChallenge={setPlayWorld} onQuestion={(text) => setQuestionRequest({ id: Date.now(), text })} /></Suspense>
              : <div className="study-game-placeholder"><span>论文里的数学，放到这里亲手试</span><h2>圈住不懂的地方，问一句“能让我试试吗？”</h2><p>先识别当前论文的公式与条件，真实计算后在这里展开。不会自动装载预设关卡。</p><button type="button" className="desk-btn" onClick={() => { setShowSetup(true); void parsePage(page, parseMode) }}>识别当前页，选择一个公式</button></div>}
          </div>
          <button type="button" className="study-setup-toggle" onClick={() => setShowSetup((v) => !v)}>{showSetup ? '收起公式与计算设置' : '公式、条件与计算设置'}</button>
          <div className="study-setup-drawer" hidden={!showSetup}>
          <section className="study-block" data-testid="study-fragments">
            <div className="study-block-head">
              <h2>第 {page} 页来源</h2>
              <button
                type="button"
                className="desk-btn"
                data-testid="study-parse-page"
                disabled={pageParse?.status === 'running'}
                onClick={() => void parsePage(page, parseMode)}
              >
                {pageParse?.status === 'running' ? `精读中（${parseMode === 'docling' ? 'Docling' : 'AI 读图'}）…` : pageParse?.status === 'done' ? '重新精读本页' : '精读本页（公式结构化）'}
              </button>
            </div>
            {pageParse?.status === 'error' && (
              <div className="study-error" data-testid="study-parse-error">
                精读失败：{pageParse.error}
                {pageParse.mode === 'vlm' && (
                  <button type="button" className="desk-btn" onClick={() => { setParseMode('docling'); void parsePage(page, 'docling') }}>改用 Docling 精读本页</button>
                )}
              </div>
            )}
            {pageParse?.status === 'done' && (
              <ul className="study-frag-list" data-testid="study-parsed-list">
                {pageParse.items.length === 0 && <li className="research-empty">精读完成，但本页未提取到条目</li>}
                {pageParse.items.map((it) => (
                  <li
                    key={it.id}
                    className={`study-frag k-${it.kind}${selection?.kind === 'formula' && selection.fragment.id === it.id ? ' on' : ''}`}
                    data-testid={it.kind === 'formula' ? 'study-formula' : 'study-parsed-item'}
                    onClick={() => it.kind === 'formula' && it.latex && select({ kind: 'formula', fragment: { id: it.id, page: it.page, latex: it.latex, parser: pageParse.parser ?? 'parsed', bbox: it.anchorPrecision === 'page' ? undefined : it.bbox } })}
                  >
                    <span className={`study-frag-kind k-${it.kind}`}>{it.kind === 'formula' ? '公式' : it.kind}</span>
                    {it.kind === 'formula' ? <code className="study-frag-latex">{it.latex}</code> : <span className="study-frag-text">{(it.text ?? '').slice(0, 150)}</span>}
                  </li>
                ))}
                <li className="study-frag-meta">{pageParse.parser} · {pageParse.items[0]?.anchorPrecision === 'page' ? '页级锚点' : '区域锚点'}</li>
              </ul>
            )}
            <div className="study-subhead">文本层（{TEXT_PARSER}，定位与正文证据；公式需精读确认）</div>
            {!pageText && <p className="research-empty">正在读取本页文本层…</p>}
            {pageText && pageText.charCount === 0 && (
              <p className="research-empty" data-testid="study-no-text">本页没有文本层（可能是扫描件）——尚未读到任何内容；请「精读本页」。</p>
            )}
            {pageText && pageText.charCount > 0 && (
              <ul className="study-frag-list study-lines">
                {pageText.lines.map((l) => (
                  <li key={l.id} className={`study-frag k-line${selection?.kind === 'line' && selection.line.id === l.id ? ' on' : ''}`} onClick={() => select({ kind: 'line', line: l })}>
                    <span className="study-frag-text">{l.text}</span>
                  </li>
                ))}
              </ul>
            )}
            {selection?.kind === 'line' && (
              <div className="study-hint" data-testid="study-line-hint">
                文本层只能定位、不能确认公式（上下标、点、负号常在提取中丢失）。如这一行是公式，请「精读本页」后选中结构化公式。
              </div>
            )}
          </section>

          {candidate && (
            <section className={`study-block study-candidate ${candidate.status}`} data-testid="study-candidate">
              <div className="study-block-head">
                <h2>数学请求候选</h2>
                <span className={`study-status ${candidate.status}`} data-testid="study-candidate-status">
                  {candidate.status === 'ready' ? '可执行' : candidate.status === 'needs_input' ? '缺条件' : '不支持'}
                </span>
              </div>
              <div className="study-cand-skill">
                {candidate.structure === 'autonomous-ode' ? `自治常微分方程组（${candidate.states.join(', ')}）→ model.solve（固定步长 RK4）` : `显式函数 ${candidate.independent} ↦ … → formula.plot`}
              </div>
              {candidate.equations.map((e) => (
                <div key={e.fragmentId} className="study-eq">
                  <textarea
                    value={choices.latex?.[e.fragmentId] ?? e.latex}
                    onChange={(ev) => setChoices((prev) => ({ ...prev, latex: { ...(prev.latex ?? {}), [e.fragmentId]: ev.target.value } }))}
                    rows={1}
                    data-testid="study-eq-latex"
                  />
                  <button type="button" className="study-source-link" onClick={() => goToPage(e.page)}>第 {e.page} 页 · {e.parser}</button>
                </div>
              ))}
              <table className="study-values">
                <tbody>
                  {candidate.params.map((f) => <ValueRow key={`p-${f.name}`} field={f} kind="param" onChange={(v) => setUser('params', f.name, v)} />)}
                  {candidate.initials.map((f) => <ValueRow key={`i-${f.name}`} field={f} kind="initial" onChange={(v) => setUser('initials', f.name, v)} />)}
                </tbody>
              </table>
              <div className="study-span">
                {candidate.structure === 'autonomous-ode' ? '积分区间 t ∈' : `${candidate.independent} 的范围`}
                <input type="number" step="any" placeholder="起点" value={Number.isFinite(choices.span?.[0]) ? choices.span?.[0] : ''} data-testid="study-span-0"
                  onChange={(e) => setChoices((prev) => ({ ...prev, span: [e.target.value === '' ? NaN : Number(e.target.value), prev.span?.[1] ?? NaN] }))} />
                <input type="number" step="any" placeholder="终点" value={Number.isFinite(choices.span?.[1]) ? choices.span?.[1] : ''} data-testid="study-span-1"
                  onChange={(e) => setChoices((prev) => ({ ...prev, span: [prev.span?.[0] ?? NaN, e.target.value === '' ? NaN : Number(e.target.value)] }))} />
                <span className="study-value-src">{candidate.span.source.kind === 'user' ? '你提供（实验假设）' : <span className="miss">缺：这是实验选择，需要你指定</span>}</span>
              </div>
              {candidate.notes.map((n) => <div key={n} className="study-note">{n}</div>)}
              {candidate.issues.length > 0 && (
                <ul className="study-issues" data-testid="study-issues">
                  {candidate.issues.map((i) => <li key={i.field + i.message} className={i.level}>{i.level === 'unsupported' ? '不支持' : '缺'}：{i.message}</li>)}
                </ul>
              )}
              <div className="study-cand-actions">
                <button
                  type="button"
                  className="desk-btn"
                  data-testid="study-compute"
                  disabled={candidate.status !== 'ready' || !sha || (computation !== null && ['submitting', 'queued', 'running'].includes(computation.status))}
                  onClick={() => void compute(candidate, (computation?.sample ?? 0) + 1)}
                >
                  {computation?.status === 'completed' ? '按当前条件重新计算' : '计算这个公式'}
                </button>
                <span className="study-cand-note">候选＝结构匹配+来源核对，尚未计算；数值结果只来自提交后的 Run。</span>
              </div>
            </section>
          )}

          {computation && (
            <section className="study-block" data-testid="study-computation">
              <div className="study-block-head">
                <h2>计算</h2>
                <span className={`study-status ${computation.status}`} data-testid="study-compute-status">{computation.status}</span>
                {['submitting', 'queued', 'running'].includes(computation.status) && (
                  <button type="button" className="desk-btn" onClick={() => void cancelComputation()}>取消</button>
                )}
              </div>
              {runStale && (
                <div className="study-stale" data-testid="study-run-stale">
                  已提交的 Run 对应候选的早前输入——当前候选改动后它已过期（stale）；重新「提交真实计算」得到当前输入的结果。
                </div>
              )}
              {computation.message && <div className="study-error">{computation.message}</div>}
              {computation.run && (
                <div className="study-run" data-testid="study-run">
                  <div className="study-run-head">
                    <code>{computation.run.runId}</code> {computation.run.kind} · {computation.run.status} · CALCULATED · {computation.run.engine}@{computation.run.engineVersion}
                  </div>
                  <RunChart run={computation.run} />
                  <div className="study-run-metrics">
                    {Array.isArray(computation.run.result.perState) &&
                      (computation.run.result.perState as Array<{ state: string; min: number; max: number }>).map((s) => (
                        <span key={s.state}>{s.state}: [{fmt(s.min)}, {fmt(s.max)}]</span>
                      ))}
                    {typeof computation.run.result.period0 === 'number' && <span>period≈{fmt(computation.run.result.period0)}</span>}
                    {computation.run.result.period0 === null && <span>窗口内无周期</span>}
                    {typeof computation.run.result.peak === 'number' && <span>peak={fmt(computation.run.result.peak)}</span>}
                    {typeof computation.run.result.integral === 'number' && <span>∫|y|={fmt(computation.run.result.integral)}</span>}
                  </div>
                </div>
              )}
              {candidate && computation?.status === 'completed' && computation.run && !runStale && (
                <div className="study-world-gen">
                  <div className="study-subhead">当前论文 → 游戏台（探索范围是游戏设置，不是论文结论）</div>
                  {candidate.structure === 'autonomous-ode' && <label className="study-note"><input type="checkbox" checked={worldRules.mode === 'challenge'} onChange={(e) => setWorldRules((r) => ({ ...r, mode: e.target.checked ? 'challenge' : 'explore' }))} /> 设定挑战目标（默认自由探索，无需填写）</label>}
                  <table className="study-values study-ranges">
                    <tbody>
                      {candidate.params.map((p) => (
                        <tr key={p.name}>
                          <td className="study-value-name">{p.name}</td>
                          <td>
                            可调 <input type="number" step="any" value={worldRules.ranges[p.name]?.min ?? ''} onChange={(e) => setWorldRules((prev) => ({ ...prev, ranges: { ...prev.ranges, [p.name]: { min: Number(e.target.value), max: prev.ranges[p.name]?.max ?? 0 } } }))} />
                            ～ <input type="number" step="any" value={worldRules.ranges[p.name]?.max ?? ''} onChange={(e) => setWorldRules((prev) => ({ ...prev, ranges: { ...prev.ranges, [p.name]: { min: prev.ranges[p.name]?.min ?? 0, max: Number(e.target.value) } } }))} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="study-span" hidden={worldRules.mode !== 'challenge'}>
                    目标（t 结束时）
                    {candidate.states.map((s) => (
                      <span key={s} className="study-goal-state">
                        {s} ∈ [<input type="number" step="any" placeholder="min" onChange={(e) => setWorldRules((prev) => {
                          const goal = prev.goal.filter((g) => !(g.kind === 'final-range' && g.state === s))
                          const min = e.target.value === '' ? undefined : Number(e.target.value)
                          const existing = prev.goal.find((g) => g.kind === 'final-range' && g.state === s) as { min?: number; max?: number } | undefined
                          if (min !== undefined || existing?.max !== undefined) goal.push({ kind: 'final-range', id: `g-${s}`, label: `t 末 ${s} 在范围内`, state: s, min, max: existing?.max })
                          return { ...prev, goal }
                        })} />, <input type="number" step="any" placeholder="max" onChange={(e) => setWorldRules((prev) => {
                          const goal = prev.goal.filter((g) => !(g.kind === 'final-range' && g.state === s))
                          const max = e.target.value === '' ? undefined : Number(e.target.value)
                          const existing = prev.goal.find((g) => g.kind === 'final-range' && g.state === s) as { min?: number; max?: number } | undefined
                          if (max !== undefined || existing?.min !== undefined) goal.push({ kind: 'final-range', id: `g-${s}`, label: `t 末 ${s} 在范围内`, state: s, min: existing?.min, max })
                          return { ...prev, goal }
                        })} />]
                      </span>
                    ))}
                  </div>
                  <div className="study-cand-actions">
                    <button type="button" className="desk-btn" data-testid="study-generate-world" disabled={worldRules.mode !== 'explore' && worldRules.goal.length === 0} onClick={generateWorld}>
                      在右侧展开，开始试一试 →
                    </button>
                    {worldResult && (
                      worldResult.ok && worldResult.href
                        ? <a className="desk-btn" href={worldResult.href} data-testid="study-world-link">{worldResult.message}</a>
                        : <span className="study-error">{worldResult.message}</span>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="study-block" data-testid="study-timing">
            <h2>分段时间（各自在测量它的进程里计时，缩进项嵌套在上一项内，不能相加）</h2>
            {spans.length === 0 && <p className="research-empty">尚无记录</p>}
            <table className="study-spans">
              <tbody>
                {spans.map((s, i) => (
                  <tr key={i}>
                    <td className="study-span-name">{s.name}</td>
                    <td className="study-span-ms">{s.ms} ms</td>
                    <td className="study-span-where">{s.where}</td>
                    <td className="study-span-detail">{s.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          </div>
        </aside>
      </div>
      {/* CLI-151b: the persistent, foldable agent dock (bottom centre) — the
          same real research-turn chain, now shared with the world view */}
      <AgentDock
        dockId="study"
        defaultOpen={false}
        questionRequest={questionRequest}
        initialQuestion={payload.initialQuestion}
        onSessionId={setResearchSessionId}
        contextBuilder={() => {
          const ctx: string[] = []
          if (researchSessionId) ctx.push(`[research-session] ${researchSessionId}（世界工具用它定位；右侧游戏台打开时可用）`)
          ctx.push('[世界工具] world_read 读用户当前世界（模型/参数/revision/最近判定与Run）；world_set_params 以 world_read 的 expected_revision 为前提改参数——它由用户浏览器里的同一验证入口执行并返回真实回执，revision 过期/越域/未打开都会如实失败')
          if (region) ctx.push(`[用户选区 p${region.page} 区域 ${JSON.stringify(region.bbox)}] ${region.text || '无可读文本层，尚不能解释图像内容'}`)
          if (clippings.length > 1) {
            ctx.push(`[选区集合 ${clippings.length} 条] ${clippings.map((c) => `p${c.page}${c.kind === 'text' ? '文字' : c.kind === 'rect' ? '矩形' : '圈选'}:${(c.text || '无可读文本').slice(0, 60)}`).join(' | ').slice(0, 1200)}`)
          }
          if (playWorld) {
            ctx.push(`[右侧游戏台模型] ${JSON.stringify(playWorld.model)}`)
            const game = gameHost.getSession()
            if (game?.world.id === playWorld.id) {
              ctx.push(`[当前游戏条件] ${JSON.stringify(game.params)}`)
              ctx.push(`[游戏最新正式Run] ${game.attempts.at(-1)?.runIds.join(',') ?? '尚未完成'}`)
              if (game.committed) ctx.push(`[游戏正式反馈] ${JSON.stringify(game.committed.assessment)}`)
              if (game.pending) ctx.push('[游戏状态] 新条件尚在计算，不可将旧结果视为新结果')
            }
          }
          if (candidate) ctx.push(`[候选 ${candidate.status}] ${candidate.equations.map((e) => `p${e.page}: ${e.latex}`).join(' ; ')}`)
          if (computation?.run) ctx.push(`[真实计算指标] ${JSON.stringify(computation.run.result.perState ?? { peak: computation.run.result.peak, integral: computation.run.result.integral })}`)
          if (computation?.run) ctx.push(`[已提交 Run] ${computation.run.runId} ${computation.run.kind} ${computation.run.status}${runStale ? '（对当前候选已过期）' : ''}`)
          // Run 输入完整绑定：模型能看到这条 Run 的确切输入（不只指标），
          // 才能对比条件差异；过期时以当前候选输入为准解释
          if (candidate) {
            try {
              ctx.push(`[${runStale ? '当前候选输入（Run 已过期）' : 'Run 输入'}] ${JSON.stringify(requestInput(candidate))}`)
            } catch { /* candidate not ready — nothing to bind */ }
          }
          for (const f of formulas) ctx.push(`[p${f.page}·公式·${f.parser}] ${f.latex}`)
          const order = [page, ...Object.keys(texts).map(Number).filter((p) => p !== page).sort((a, b) => a - b)]
          for (const p of order) for (const l of texts[p]?.lines ?? []) ctx.push(`[p${p}·文本层] ${l.text}`)
          return ctx
        }}
        dataCard={
          computation?.run
            ? {
                title: runStale ? '最近 Run（对当前候选已过期）' : '最近 Run（CALCULATED）',
                lines: [
                  `${computation.run.runId} · ${computation.run.kind} · ${computation.run.status}`,
                  ...((computation.run.result.perState as Array<{ state: string; min: number; max: number }> | undefined) ?? []).map((s) => `${s.state}: [${fmt(s.min)}, ${fmt(s.max)}]`),
                  ...(computation.message ? [computation.message] : []),
                ],
              }
            : null
        }
        onMathPointer={(latex, p) => pointAt({ turnId: -1, latex, page: p })}
      />
    </div>
  )
}
