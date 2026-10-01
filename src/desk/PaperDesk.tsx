// The ingest desk: an infinite research-desk canvas (tldraw) holding the real
// PDF page, formulas lifted from it, and formula experiments that grow as the
// user plays (AGENTS.md §1 v5). Progressive disclosure: paper → key formula
// marker → Play → interactive figure → fork → comparison — nothing else is
// pre-created.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Tldraw,
  createShapeId,
  type Editor,
  type TLShapeId,
} from '@tldraw/tldraw'
import '@tldraw/tldraw/tldraw.css'
import { DeskContext, type DeskPayload } from './context'
import { deskShapeUtils, type PaperShape } from './shapes'
import { deskBus } from './deskBus'
import { usePdfPageSize } from './PdfCanvas'
import { analyzeFormula } from '../formula/analyze'
import { buildExplorerSpec } from '../formula/spec'
import { explorerStore } from './explorerStore'
import { planFormulaActions } from '../skills/formulaPlan'
import { llmConfigFromEnv } from '../skills/llmPlanner'

/** registered layout config (presentation, not evidence) */
const PAPER_W = 560
const PAPER_X = 60
const PAPER_Y = 0

export function PaperDesk({ payload, onOpenKakeya }: { payload: DeskPayload; onOpenKakeya: () => void }) {
  const editorRef = useRef<Editor | null>(null)
  const ids = useRef({
    paper: createShapeId('paper'),
    formula: null as TLShapeId | null,
    chart: createShapeId('chart'),
    source: null as TLShapeId | null,
  })
  const experimentIds = useRef<TLShapeId[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [ask, setAsk] = useState('')
  const size = usePdfPageSize(payload.pdfUrl, 1)

  const message = useCallback((m: string) => {
    setNote(m)
    window.setTimeout(() => setNote((cur) => (cur === m ? null : cur)), 4200)
  }, [])

  const keyFormula = payload.decision.keyFormula

  const ensureExplorer = useCallback((latex: string, anchorId: string) => {
    const a = analyzeFormula(latex)
    if (!a.ok) return null
    const anchorItem = payload.doc.items.find((i) => i.id === anchorId)
    const { spec, compiled } = buildExplorerSpec(a, {
      docId: payload.doc.docId,
      page: anchorItem?.page ?? 1,
      bbox: anchorItem?.bbox ?? { x: 0.3, y: 0.4, w: 0.4, h: 0.06 },
      latex,
    })
    const id = explorerStore.nextId()
    explorerStore.create(id, spec, compiled)
    return id
  }, [payload.doc])

  /** fork an explorer and grow its experiment sheet + comparison chart below */
  const createForkShape = useCallback(
    (srcExplorerId: string, anchorId: string): string | null => {
      const editor = editorRef.current
      const src = explorerStore.get(srcExplorerId)
      if (!editor || !src) return null
      const newId = explorerStore.nextId()
      explorerStore.fork(srcExplorerId, newId)
      const base = experimentIds.current.length
        ? editor.getShape(experimentIds.current[experimentIds.current.length - 1])
        : null
      const expId = createShapeId(`experiment-${newId}`)
      experimentIds.current.push(expId)
      editor.createShape({
        id: expId,
        type: 'p2l-experiment',
        x: (base?.x ?? 900) + 40,
        y: (base?.y ?? 90) + 440,
        props: { anchorId, latex: src.spec.anchor.latex, explorerId: newId, w: 460, h: 380 },
      })
      if (!editor.getShape(ids.current.chart)) {
        editor.createShape({
          id: ids.current.chart,
          type: 'p2l-chart',
          x: (base?.x ?? 900) + 40 + 460 + 70,
          y: (base?.y ?? 90) + 440,
          props: { anchorId, w: 480, h: 340 },
        })
      }
      editor.select(expId)
      return newId
    },
    [],
  )

  // ---- initial mount: paper + marker only ----------------------------------
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !size) return
    if (editor.getShape(ids.current.paper)) return
    editor.createShape({
      id: ids.current.paper,
      type: 'p2l-paper',
      x: PAPER_X,
      y: PAPER_Y,
      props: {
        docId: payload.doc.docId,
        page: 1,
        w: PAPER_W,
        h: Math.round((PAPER_W * size.h) / size.w),
        keyAnchorId: keyFormula?.id ?? '',
        highlightAnchorId: '',
      },
    })
    editor.updateInstanceState({ isGridMode: true })
    window.setTimeout(() => editor.zoomToFit({ animation: { duration: 350 } }), 60)
  }, [size, payload.doc.docId, keyFormula])

  // ---- desk intent handling -------------------------------------------------
  useEffect(() => {
    const unsubscribe = deskBus.subscribe((e) => {
    const editor = editorRef.current
    if (!editor) return
    const doc = payload.doc

    const anchorOf = (id: string) => doc.items.find((i) => i.id === id)

    if (e.kind === 'marker-click') {
      // lift the formula out of the paper, floating beside its anchor
      const anchor = anchorOf(e.anchorId)
      if (!anchor) return
      if (!ids.current.formula) ids.current.formula = createShapeId('formula')
      if (!editor.getShape(ids.current.formula)) {
        editor.createShape({
          id: ids.current.formula,
          type: 'p2l-formula',
          x: PAPER_X + PAPER_W + 36,
          y: PAPER_Y + anchor.bbox.y * Math.round((PAPER_W * (size?.h ?? 792)) / (size?.w ?? 612)) - 40,
          props: {
            anchorId: e.anchorId,
            latex: anchor.latex ?? '',
            explorerId: '',
            w: 300,
            h: 150,
          },
        })
        editor.zoomToFit({ animation: { duration: 450 } })
      } else {
        editor.centerOnPoint(
          { x: (editor.getShape(ids.current.formula)!.x), y: (editor.getShape(ids.current.formula)!.y) },
          { animation: { duration: 450 } },
        )
      }
      return
    }

    if (e.kind === 'play') {
      const anchor = anchorOf(e.anchorId)
      if (!anchor?.latex) return
      const explorerId = ensureExplorer(anchor.latex, e.anchorId)
      if (!explorerId) {
        message('该公式无法编译为可操作实验')
        return
      }
      const fid = ids.current.formula!
      const fshape = editor.getShape(fid)
      // createShapeId(prefix) is deterministic — suffix with the explorer id so
      // forks don't overwrite the base experiment shape
      const expId = createShapeId(`experiment-${explorerId}`)
      experimentIds.current.push(expId)
      editor.createShape({
        id: expId,
        type: 'p2l-experiment',
        x: (fshape?.x ?? PAPER_X + PAPER_W + 36) + 300 + 60,
        y: (fshape?.y ?? 120) - 30,
        props: { anchorId: e.anchorId, latex: anchor.latex, explorerId, w: 460, h: 380 },
      })
      // Source chip under the experiment (Trace affordance)
      const srcId = createShapeId('source')
      ids.current.source = srcId
      if (!editor.getShape(srcId)) {
        editor.createShape({
          id: srcId,
          type: 'p2l-source',
          x: (fshape?.x ?? 0) + 300 + 60,
          y: (fshape?.y ?? 120) - 30 + 380 + 10,
          props: {
            anchorId: e.anchorId,
            label: `p.${anchor.page} · ${anchor.latex.slice(0, 18)}${anchor.latex.length > 18 ? '…' : ''}`,
            w: 300,
            h: 40,
          },
        })
      }
      editor.select(expId)
      editor.centerOnPoint(
        { x: (fshape?.x ?? 0) + 300 + 60 + 230, y: (fshape?.y ?? 120) + 140 },
        { animation: { duration: 450 } },
      )
      message('Interactive Figure 已展开 — 直接拖动公式里的参数')
      return
    }

    if (e.kind === 'fork') {
      const created = createForkShape(e.explorerId, e.anchorId)
      if (created) message('已 Fork — 修改新实验的参数，Compare 表会自动对比两组真实计算')
      return
    }

    if (e.kind === 'compare') {
      if (explorerStore.ids().length < 2) {
        message('先 Fork 一次，才有两组结果可对比')
        return
      }
      if (!editor.getShape(ids.current.chart)) {
        editor.createShape({
          id: ids.current.chart,
          type: 'p2l-chart',
          x: 900,
          y: 520,
          props: { anchorId: '', w: 480, h: 340 },
        })
      }
      editor.centerOnPoint({ x: 1140, y: 690 }, { animation: { duration: 450 } })
      return
    }

    if (e.kind === 'source') {
      const anchor = anchorOf(e.anchorId)
      const paper = editor.getShape(ids.current.paper) as PaperShape | undefined
      if (!anchor || !paper) return
      const ax = paper.x + (anchor.bbox.x + anchor.bbox.w / 2) * paper.props.w
      const ay = paper.y + (anchor.bbox.y + anchor.bbox.h / 2) * paper.props.h
      editor.updateShape({
        id: ids.current.paper,
        type: 'p2l-paper',
        props: { highlightAnchorId: anchor.id },
      })
      editor.centerOnPoint({ x: ax, y: ay }, { animation: { duration: 620 } })
      window.setTimeout(() => {
        editor.updateShape({
          id: ids.current.paper,
          type: 'p2l-paper',
          props: { highlightAnchorId: '' },
        })
      }, 2600)
      return
    }

    if (e.kind === 'goto-kakeya') onOpenKakeya()
    })
    return () => {
      unsubscribe()
    }
  }, [payload, size, ensureExplorer, message, onOpenKakeya, createForkShape])

  const runAsk = useCallback(async () => {
    const q = ask.trim()
    if (!q) return
    const firstId = explorerStore.ids()[0]
    if (!firstId) {
      message('先 Play 展开一个实验，再提问')
      return
    }
    const src = explorerStore.get(firstId)!
    const paramNames = src.spec.parameters.map((p) => p.name)
    const cfg = llmConfigFromEnv()
    const actions = await planFormulaActions(
      q,
      paramNames,
      cfg
        ? async (qq) =>
            fetch(`${cfg.endpoint.replace(/\/$/, '')}/chat/completions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
              body: JSON.stringify({
                model: cfg.model,
                messages: [
                  {
                    role: 'system',
                    content:
                      'You convert a question about a formula experiment into structured ops. ' +
                      'Return ONLY a JSON object {"actions":[{op,param,value}]}. ' +
                      'ops fork|set|scale|rerun|compare; ' +
                      `param must be one of ${JSON.stringify(paramNames)}. set.value is absolute, scale.value is a factor.`,
                  },
                  { role: 'user', content: qq },
                ],
                response_format: { type: 'json_object' },
                temperature: 0,
              }),
            })
              .then((r) => r.json())
              .then(
                (d) =>
                  JSON.parse(
                    ((d as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]
                      ?.message?.content ?? 'null'),
                  ) as unknown,
              )
              .then((c) =>
                Array.isArray(c) ? c : (c as { actions?: unknown[] })?.actions ?? null,
              )
        : undefined,
    )
    if (!actions) {
      message('没听懂 — 试试「如果 a 增大一倍会怎样？」「把 b 设为 3」')
      return
    }
    // execute: fork → set/scale on the fork → compare chart
    let targetId = firstId
    for (const a of actions) {
      if (a.op === 'fork') {
        const anchorId = payload.decision.keyFormula?.id ?? ''
        const created = createForkShape(firstId, anchorId)
        if (created) targetId = created
      } else if (a.op === 'set' || a.op === 'scale') {
        const cur = explorerStore.get(targetId)?.params[a.param!] ?? 1
        const v = a.op === 'set' ? a.value! : cur * a.value!
        explorerStore.setParams(targetId, { [a.param!]: v })
      }
      // rerun/compare: curve recomputes via observable cells; chart is live
    }
    if (actions.some((a) => a.op === 'compare') && !editorRef.current?.getShape(ids.current.chart)) {
      deskBus.emit({ kind: 'compare' })
    }
    setAsk('')
    message(`Agent：${actions.map((a) => (a.param ? `${a.op} ${a.param}${a.value ? (a.op === 'scale' ? '×' : '=') + a.value : ''}` : a.op)).join(' → ')}`)
  }, [ask, message, payload.decision.keyFormula?.id])

  return (
    <DeskContext.Provider value={payload}>
      <div className="desk-root">
        <Tldraw
          shapeUtils={deskShapeUtils}
          onMount={(editor: Editor) => {
            editorRef.current = editor
            // debug/e2e handle — camera moves for verification scripts only
            ;(window as unknown as { __deskEditor?: Editor }).__deskEditor = editor
            ;(window as unknown as { __explorerStore?: typeof explorerStore }).__explorerStore =
              explorerStore
          }}
        >
          <div className="desk-topbar">
            <span className="desk-topbar-title">{payload.fileName}</span>
            <span className="desk-topbar-meta">
              {payload.doc.engine} v{payload.doc.doclingVersion} · {payload.doc.items.length} items ·{' '}
              {payload.doc.pages.length} pages
            </span>
            {payload.decision.adapter === 'kakeya' && (
              <button type="button" className="desk-btn desk-btn-play" onClick={() => deskBus.emit({ kind: 'goto-kakeya' })}>
                → 打开 3D Kakeya Lab
              </button>
            )}
            <button type="button" className="desk-btn" onClick={() => window.location.reload()}>
              ← 换一篇论文
            </button>
          </div>
          <div className="desk-ask">
            <input
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void runAsk()}
              placeholder="问一个实验问题，如：如果 a 增大一倍会怎样？"
            />
            <button type="button" className="desk-btn desk-btn-play" onClick={() => void runAsk()}>
              运行
            </button>
          </div>
          {note && <div className="desk-note">{note}</div>}
        </Tldraw>
      </div>
    </DeskContext.Provider>
  )
}
