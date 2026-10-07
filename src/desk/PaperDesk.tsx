// The ingest desk: an infinite research-desk canvas (tldraw) holding the real
// PDF page, formulas lifted from it, and formula experiments that grow as the
// user plays (AGENTS.md §1 v5). Progressive disclosure: paper → key formula
// marker → Play → interactive figure → fork → comparison — nothing else is
// pre-created.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  Tldraw,
  createShapeId,
  type Editor,
  type TLShapeId,
} from '@tldraw/tldraw'
import '@tldraw/tldraw/tldraw.css'
import { DeskContext, type DeskPayload } from './context'
import { deskShapeUtils, deskBindingUtils, type PaperShape, type FormulaShape } from './shapes'
import { applyLabLayout } from './labFrame'
import { runAgentAction, type AgentHelpers } from './agentActions'
import { Desk3DOverlay } from './RunView3D'
import { deskBus } from './deskBus'
import { usePdfPageSize } from './PdfCanvas'
import { analyzeFormula } from '../formula/analyze'
import { buildExplorerSpec } from '../formula/spec'
import { explorerStore } from './explorerStore'
import { odePhaseStore } from './odePhaseStore'
import { planFormulaActions } from '../skills/formulaPlan'
import { llmConfigFromEnv } from '../skills/llmPlanner'
import { runAgentTurn, newAgentSessionId, type DeskAgentContext } from './agentBridge'
import { agentState } from './agentState'
import { executeFormulaSteps } from '../skills/formulaExecutor'

/** registered layout config (presentation, not evidence) */
const PAPER_W = 560
const PAPER_X = 60
const PAPER_Y = 0

/** orchestrator phases rendered as paper states — never "AI is thinking…" */
function AgentPhaseStrip() {
  const s = useSyncExternalStore(agentState.subscribe, agentState.getSnapshot, agentState.getSnapshot)
  const p = s.phase
  if (p.kind === 'idle' && !s.observation) return null
  let text = ''
  if (p.kind === 'plan') text = `PLAN · ${p.skill} — ${p.goal.slice(0, 40)}`
  else if (p.kind === 'running') text = `RUNNING · ${p.tool}`
  else if (p.kind === 'computed') text = `LOCAL COMPUTE → CALCULATED · run …${p.runId.slice(-4)}`
  else if (p.kind === 'error') text = `ERROR · ${p.message.slice(0, 60)}`
  return (
    <div className={`desk-agent-strip st-${p.kind}`}>
      {text || 'AI INFERENCE'}
    </div>
  )
}

export function PaperDesk({ payload, onOpenKakeya }: { payload: DeskPayload; onOpenKakeya: () => void }) {
  const editorRef = useRef<Editor | null>(null)
  const ids = useRef({
    lab: createShapeId('lab-frame'),
    paper: createShapeId('paper'),
    formula: null as TLShapeId | null,
    chart: createShapeId('chart'),
    source: null as TLShapeId | null,
    run3d: createShapeId('run3d'),
    runOde: createShapeId('run-ode'),
  })
  const deskRootRef = useRef<HTMLDivElement | null>(null)
  const experimentIds = useRef<TLShapeId[]>([])
  const agentSession = useRef(newAgentSessionId())
  const agentTarget = useRef<string | null>(null)
  const busy = useRef(false)
  const [asking, setAsking] = useState(false)
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
      anchorId,
      page: anchorItem?.page ?? 1,
      bbox: anchorItem?.bbox ?? { x: 0.3, y: 0.4, w: 0.4, h: 0.06 },
      latex,
    })
    const id = explorerStore.nextId()
    // the ROUTER's binding is authoritative for the paper's key formula —
    // forks/side formulas synthesise their own (playPlan fallback)
    const d = payload.decision
    const binding = d.status === 'ok' && d.adapter === 'formula' && d.keyFormula?.id === anchorId ? d.binding : undefined
    explorerStore.create(id, spec, compiled, undefined, binding)
    return id
  }, [payload.doc, payload.decision])

  /** fork an explorer and grow its experiment sheet + comparison chart below */
  const createForkShape = useCallback(
    (srcExplorerId: string, anchorId: string, changes: Record<string, number> = {}): string | null => {
      const editor = editorRef.current
      const src = explorerStore.get(srcExplorerId)
      if (!editor || !src) return null
      const newId = explorerStore.nextId()
      explorerStore.fork(srcExplorerId, newId)
      if (Object.keys(changes).length > 0) explorerStore.setParams(newId, changes)
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
        parentId: ids.current.lab,
        props: { anchorId, latex: src.spec.anchor.latex, explorerId: newId, w: 460, h: 380 },
      })
      if (!editor.getShape(ids.current.chart)) {
        editor.createShape({
          id: ids.current.chart,
          type: 'p2l-chart',
          x: (base?.x ?? 900) + 40 + 460 + 70,
          y: (base?.y ?? 90) + 440,
          parentId: ids.current.lab,
          props: { anchorId, w: 480, h: 340 },
        })
      }
      applyLabLayout(editor, ids.current.lab)
      editor.select(expId)
      return newId
    },
    [],
  )

  // ---- initial mount: lab frame + paper inside it ---------------------------
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !size) return
    if (editor.getShape(ids.current.paper)) return
    // the research frame hosts everything that grows afterwards; its
    // onChildrenChange auto-arranges (paper as hero, branches beside it)
    if (!editor.getShape(ids.current.lab)) {
      editor.createShape({
        id: ids.current.lab,
        type: 'p2l-lab',
        x: PAPER_X - 16,
        y: PAPER_Y - 52,
        props: { w: PAPER_W + 32, h: 726 + 52, name: '研究桌面', layout: 'spotlight' },
      })
    }
    editor.createShape({
      id: ids.current.paper,
      type: 'p2l-paper',
      x: PAPER_X,
      y: PAPER_Y,
      parentId: ids.current.lab,
      props: {
        docId: payload.doc.docId,
        page: 1,
        w: PAPER_W,
        h: Math.round((PAPER_W * size.h) / size.w),
        keyAnchorId: keyFormula?.id ?? '',
        highlightAnchorId: '',
      },
    })
    applyLabLayout(editor, ids.current.lab)
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
      const existing = editor.getShape(ids.current.formula) as FormulaShape | undefined
      if (!existing) {
        editor.createShape({
          id: ids.current.formula,
          type: 'p2l-formula',
          x: PAPER_X + PAPER_W + 36,
          y: PAPER_Y + anchor.bbox.y * Math.round((PAPER_W * (size?.h ?? 792)) / (size?.w ?? 612)) - 40,
          parentId: ids.current.lab,
          props: {
            anchorId: e.anchorId,
            latex: anchor.latex ?? '',
            explorerId: '',
            w: 300,
            h: 150,
          },
        })
        applyLabLayout(editor, ids.current.lab)
        editor.zoomToFit({ animation: { duration: 450 } })
      } else if (existing.props.anchorId !== e.anchorId) {
        // a DIFFERENT marker was selected — retarget the lifted formula sheet
        // to the new anchor (it used to keep showing the first formula)
        editor.updateShape({
          id: ids.current.formula,
          type: 'p2l-formula',
          props: { anchorId: e.anchorId, latex: anchor.latex ?? '', explorerId: '' },
        })
        editor.centerOnPoint({ x: existing.x, y: existing.y }, { animation: { duration: 450 } })
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
        parentId: ids.current.lab,
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
          parentId: ids.current.lab,
          props: {
            anchorId: e.anchorId,
            label: `p.${anchor.page} · ${anchor.latex.slice(0, 18)}${anchor.latex.length > 18 ? '…' : ''}`,
            w: 300,
            h: 40,
          },
        })
      }
      applyLabLayout(editor, ids.current.lab)
      // trace binding: experiment paper → the formula it grew from (survives
      // moving either shape; Source button follows it back to the paper)
      editor.createBinding({ type: 'p2l-trace', fromId: expId, toId: fid })
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
          parentId: ids.current.lab,
          props: { anchorId: '', w: 480, h: 340 },
        })
        applyLabLayout(editor, ids.current.lab)
      }
      editor.centerOnPoint({ x: 1140, y: 690 }, { animation: { duration: 450 } })
      return
    }

    if (e.kind === 'source') {
      const anchor = anchorOf(e.anchorId)
      const paper = editor.getShape(ids.current.paper) as PaperShape | undefined
      if (!anchor || !paper) return
      // Lane D: the anchor may live on ANOTHER page — turn the paper to it
      // first, then highlight + centre (Source used to centre on the wrong
      // page's coordinates whenever the anchor was cross-page)
      if (anchor.page !== paper.props.page) {
        editor.updateShape({
          id: ids.current.paper,
          type: 'p2l-paper',
          props: { page: anchor.page },
        })
      }
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

  // ---- agent action helpers (AgentActionUtil port; the same desk paths the
  // UI buttons use — actions never touch the store directly) ------------------
  const agentHelpers = useCallback((): AgentHelpers => {
    const editor = editorRef.current!
    return {
      editor,
      docItems: payload.doc.items.map((i) => ({ id: i.id, latex: i.latex, page: i.page })),
      explorerIds: () => explorerStore.ids(),
      explorerParams: (id) => {
        const ex = explorerStore.get(id)
        if (!ex) return []
        return Object.entries(ex.spec.parameters ?? {}).map(([name, p]) => ({
          name,
          min: (p as { min?: number }).min ?? -10,
          max: (p as { max?: number }).max ?? 10,
        }))
      },
      selectedExplorerId: () => {
        const sel = editor.getSelectedShapes()[0]
        const explorerId = (sel?.props as { explorerId?: string } | undefined)?.explorerId
        return explorerId || agentTarget.current
      },
      play: (anchorId) => {
        // emit the SAME event the Playable marker uses — the handler is the
        // single creation path (no duplicate explorers); 'desk' = accepted
        const anchor = payload.doc.items.find((i) => i.id === anchorId)
        if (!anchor?.latex) return null
        deskBus.emit({ kind: 'play', anchorId, latex: anchor.latex })
        return 'desk'
      },
      fork: (id, changes) => {
        const anchorId = explorerStore.get(id)?.spec.anchor.anchorId ?? ''
        return createForkShape(id, anchorId, changes)
      },
      compare: () => deskBus.emit({ kind: 'compare' }),
    }
  }, [payload.doc.items, ensureExplorer, createForkShape])

  /** browser-side executor for the Research Orchestrator (server/agent.py):
   *  runs the REAL scientific steps on the same engines the UI uses — the
   *  agent only ever receives run ids and measured numbers back. */
  const scientificExecute = useCallback(
    async (args: { deskKind?: string; steps?: Array<Record<string, unknown>> }) => {
      if (args.deskKind && args.deskKind !== 'formula') throw new Error('Wrong experiment adapter')
      const sourceId = agentTarget.current
      if (!sourceId) throw new Error('Select an experiment first')
      const source = explorerStore.get(sourceId)!
      agentState.set({ phase: { kind: 'running', tool: 'formula.plot' }, explorerId: sourceId })
      const result = await executeFormulaSteps(sourceId, args.steps ?? [], {
        fork: (id) => createForkShape(id, explorerStore.get(id)?.spec.anchor.anchorId ?? source.spec.anchor.anchorId ?? ''),
        compare: () => deskBus.emit({ kind: 'compare' }),
      })
      agentTarget.current = result.targetId
      const run = explorerStore.get(result.targetId)?.run
      if (run) agentState.set({ explorerId: result.targetId, phase: { kind: 'computed', runId: run.runId, durationMs: run.durationMs } })
      return result
    },
    [createForkShape],
  )

  const canvasApply = useCallback(
    async (ops: Array<Record<string, unknown>>) => {
      let applied = 0
      for (const o of ops) {
        const op = String(o.op)
        if (!['compare', 'highlight-source', 'fork-paper', 'focus'].includes(op)) throw new Error(`Unknown canvas operation: ${op}`)
        if (op === 'compare') {
          deskBus.emit({ kind: 'compare' })
          applied++
        } else if (op === 'highlight-source' && o.anchorId) {
          deskBus.emit({ kind: 'source', anchorId: String(o.anchorId) })
          applied++
        } else if (op === 'fork-paper') {
          const created = createForkShape(agentTarget.current ?? '', payload.decision.keyFormula?.id ?? '')
          if (created) applied++
        } else if (op === 'focus') {
          const editor = editorRef.current
          const chart = editor?.getShape(ids.current.chart)
          if (editor && chart) editor.centerOnPoint({ x: chart.x + 240, y: chart.y + 170 }, { animation: { duration: 400 } })
          applied++
        }
      }
      return { applied }
    },
    [createForkShape, payload.decision.keyFormula?.id],
  )

  const runAskImpl = useCallback(async () => {
    const q = ask.trim()
    if (!q) return
    // canvas intents first (agent action registry — AgentActionUtil port):
    // 聚焦/并排/网格/自由/展开实验 are desk operations, not formula math
    const canvasAction = (() => {
      if (/并排|排成一行|row/.test(q)) return { type: 'arrange_lab', mode: 'row' } as const
      if (/网格|grid/.test(q)) return { type: 'arrange_lab', mode: 'grid' } as const
      if (/自由|free/.test(q)) return { type: 'arrange_lab', mode: 'free' } as const
      if (/聚焦|放大主实验|spotlight/.test(q)) return { type: 'focus_shape' } as const
      if (/展开实验|从论文展开/.test(q)) {
        return { type: 'create_experiment', anchorId: payload.decision.keyFormula?.id ?? '' } as const
      }
      return null
    })()
    if (canvasAction) {
      const out = await runAgentAction(agentHelpers(), canvasAction as never)
      message(out.ok ? `Agent 动作：${out.label ?? canvasAction.type}` : `动作被拒绝：${out.reason ?? '校验失败'}`)
      if (out.ok) setAsk('')
      return
    }
    const selected = editorRef.current?.getOnlySelectedShape()
    const selectedId = selected?.type === 'p2l-experiment' ? (selected.props as { explorerId: string }).explorerId : null
    const available = explorerStore.ids().filter((id) => explorerStore.get(id)?.spec.anchor.docId === payload.doc.docId)
    const firstId = selectedId ?? (available.length === 1 ? available[0] : null)
    if (!firstId) {
      message('请选中一张实验纸，再提问')
      return
    }
    agentTarget.current = firstId
    const src = explorerStore.get(firstId)!
    const paramNames = src.spec.parameters.map((p) => p.name)
    const context: DeskAgentContext = {
      deskKind: 'formula',
      paperTitle: payload.doc.title,
      params: paramNames,
      paramValues: { ...src.params },
      anchorId: src.spec.anchor.anchorId ?? null,
      selectedRunId: src.run?.runId ?? null,
    }
    agentState.set({ phase: { kind: 'plan', goal: q, skill: 'formula.plot' }, explorerId: firstId, observation: null, plan: null })
    try {
      // Research Orchestrator on the server (AgentScope/Qwen or deterministic
      // SOP) — computation always comes back to THIS browser.
      await runAgentTurn(q, context, agentSession.current, {
        scientificExecute,
        canvasApply,
        onEvent: (e) => {
          if (e.type === 'plan_created' && e.plan) {
            agentState.set({
              phase: { kind: 'plan', goal: e.plan.goal, skill: e.plan.skill },
              plan: e.plan,
            })
            message(`PlayPlan：${e.plan.goal}`)
          } else if (e.type === 'tool_started') {
            agentState.set({ phase: { kind: 'running', tool: e.tool ?? '' } })
          } else if (e.type === 'experiment_completed') {
            agentState.set({
              phase: { kind: 'computed', runId: e.runId ?? '', durationMs: e.durationMs ?? 0 },
            })
          } else if (e.type === 'observation_ready') {
            agentState.set({ observation: e.text ?? null })
            message(e.text ?? '实验完成')
          }
        },
      })
      setAsk('')
      return
    } catch (err) {
      // Never repeat a partially executed tool sequence as a new local fork.
      if (!(err instanceof TypeError)) {
        agentState.set({ phase: { kind: 'error', message: err instanceof Error ? err.message : String(err) } })
        message(err instanceof Error ? err.message : String(err))
        return
      }
      // server unreachable → deterministic local planner (same action grammar)
      agentState.reset()
    }

    const cfg = llmConfigFromEnv()
    const actions = await planFormulaActions(q, paramNames, cfg ? async (qq) =>
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
        .then((c) => Array.isArray(c) ? c : (c as { actions?: unknown[] })?.actions ?? null)
    : undefined)
    if (!actions) {
      message('没听懂 — 试试「如果 a 增大一倍会怎样？」「把 b 设为 3」')
      return
    }
    const opNames = { fork: 'experiment.fork', set: 'formula.set', scale: 'formula.scale', rerun: 'formula.plot', compare: 'experiment.compare' }
    await scientificExecute({ deskKind: 'formula', steps: actions.map((a) => ({ ...a, op: opNames[a.op] })) })
    setAsk('')
    message(`Agent：${actions.map((a) => (a.param ? `${a.op} ${a.param}${a.value ? (a.op === 'scale' ? '×' : '=') + a.value : ''}` : a.op)).join(' → ')}`)
  }, [ask, message, payload.decision.keyFormula?.id, payload.doc.title, createForkShape, scientificExecute, canvasApply, agentHelpers])

  const runAsk = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    setAsking(true)
    try { await runAskImpl() } catch (err) { message(err instanceof Error ? err.message : String(err)) }
    finally { busy.current = false; setAsking(false) }
  }, [runAskImpl, message])

  return (
    <DeskContext.Provider value={payload}>
      <div className="desk-root" ref={deskRootRef}>
        {/* one shared Canvas for every Run-driven 3D paper on the desk */}
        <Desk3DOverlay rootRef={deskRootRef} />
        <Tldraw
          shapeUtils={deskShapeUtils}
          bindingUtils={deskBindingUtils}
          onMount={(editor: Editor) => {
            editorRef.current = editor
            // debug/e2e handle — camera moves for verification scripts only
            ;(window as unknown as { __deskEditor?: Editor }).__deskEditor = editor
            ;(window as unknown as { __explorerStore?: typeof explorerStore }).__explorerStore =
              explorerStore
            // agent action surface (headless evidence + future LLM backends)
            ;(window as unknown as { __P2L_ACTIONS__?: { run(a: unknown): Promise<{ ok: boolean; reason?: string }> } }).__P2L_ACTIONS__ = {
              run: (a) => runAgentAction(agentHelpers(), a as never),
            }
          }}
        >
          <div className="desk-topbar">
            <span className="desk-topbar-title">{payload.fileName}</span>
            <span className="desk-topbar-meta">
              {payload.doc.engine} v{payload.doc.doclingVersion} · {payload.doc.items.length} items ·{' '}
              {payload.doc.pages.length} pages
            </span>
            {payload.decision.status === 'ok' && payload.decision.adapter === 'kakeya' && (
              <button type="button" className="desk-btn desk-btn-play" onClick={() => deskBus.emit({ kind: 'goto-kakeya' })}>
                → 打开 3D Kakeya Lab
              </button>
            )}
            {payload.decision.status === 'ok' && payload.decision.adapter === 'kakeya' && (
              <button
                type="button"
                className="desk-btn"
                data-testid="grow-3d"
                onClick={() => {
                  const editor = editorRef.current
                  if (!editor) return
                  if (editor.getShape(ids.current.run3d)) {
                    message('3D 实验纸已在桌面上')
                    return
                  }
                  editor.createShape({
                    id: ids.current.run3d,
                    type: 'p2l-3d',
                    x: PAPER_X + PAPER_W + 60,
                    y: PAPER_Y + 40,
                    parentId: ids.current.lab,
                    props: { title: 'Kakeya 3D（Run 驱动 · 拖管族反写 packing）', w: 380, h: 320 },
                  })
                  applyLabLayout(editor, ids.current.lab)
                  message('3D 实验纸已长出 — 画面由 kakeya.geometry Run 驱动，拖动管族反写参数')
                }}
              >
                ◈ 长出 3D 实验纸
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
            <button type="button" className="desk-btn desk-btn-play" disabled={asking} onClick={() => void runAsk()}>
              {asking ? '实验执行中' : '运行'}
            </button>
          </div>
          {note && <div className="desk-note">{note}</div>}
          {payload.decision.status === 'needs-info' && (
            <div className="desk-note" data-testid="needs-info">
              ⚠ 该论文的实验缺少必要条件，需先补充（不会套用通用 Demo）：
              <ul>
                {payload.decision.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          )}
          {payload.decision.status === 'out-of-scope' && (
            <div className="desk-note" data-testid="out-of-scope">
              ✖ {payload.decision.reason}
            </div>
          )}
          {payload.decision.status === 'ok' && payload.decision.adapter === 'ode' && (
            <>
              <button
                type="button"
                className="desk-btn desk-btn-play"
                data-testid="grow-ode"
                onClick={() => {
                  const editor = editorRef.current
                  const d = payload.decision
                  if (!editor || d.status !== 'ok' || d.adapter !== 'ode') return
                  if (editor.getShape(ids.current.runOde)) {
                    message('ODE 相平面实验纸已在桌面上')
                    return
                  }
                  const sys = d.binding.system!
                  const initial = d.binding.conditions.find((c) => c.kind === 'initial') as { values: Record<string, number> } | undefined
                  const rhs = sys.equations.map((e) => e.latex.slice(e.latex.indexOf('=') + 1).trim()) as [string, string]
                  const odeId = odePhaseStore.nextId()
                  try {
                    odePhaseStore.create(odeId, {
                      states: sys.states,
                      rhs,
                      initial: [Number(initial?.values[sys.states[0]]), Number(initial?.values[sys.states[1]])],
                    })
                  } catch (err) {
                    message(`ODE 实验创建失败：${err instanceof Error ? err.message : err}`)
                    return
                  }
                  editor.createShape({
                    id: ids.current.runOde,
                    type: 'p2l-ode',
                    x: PAPER_X + PAPER_W + 60,
                    y: PAPER_Y + 40,
                    parentId: ids.current.lab,
                    props: {
                      odeId,
                      title: `${sys.states.join('–')} 相平面（论文方程 · 拖初值释放）`,
                      w: 560,
                      h: 430,
                    },
                  })
                  applyLabLayout(editor, ids.current.lab)
                  message('ODE 实验纸已长出 — 论文右端编译执行，拖初始点释放即精确 RK4')
                }}
              >
                ◈ 长出 ODE 相平面实验纸
              </button>
              <div className="desk-note" data-testid="ode-pending">
                该论文已绑定为 ODE 相平面实验（状态{' '}
                {payload.decision.binding.system?.states.join('/')}，初值{' '}
                {Object.entries((payload.decision.binding.conditions.find((c) => c.kind === 'initial') as { values: Record<string, number> } | undefined)?.values ?? {}).map(([k, v]) => `${k}(0)=${v}`).join('、') || '待定'}）。
              </div>
            </>
          )}
          <AgentPhaseStrip />
        </Tldraw>
      </div>
    </DeskContext.Provider>
  )
}
