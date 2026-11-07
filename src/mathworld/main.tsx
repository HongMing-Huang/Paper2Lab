// MathWorld page entry (CLI-129) — mounted by /mathworld.html only; the main
// Paper2Lab app (index.html → src/main.tsx) is untouched.
// Routes: /mathworld.html          → formula/ode/kakeya worlds (App.tsx)
//         /mathworld.html#needle   → 搬针过弯 needle game (NeedleApp.tsx)
import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import 'mathlive/static.css'
import 'mathlive/fonts.css'
import './mathworld.css'
import { NeedleApp, needleHost } from './NeedleApp'
import { host, tunables } from './host'

// the formula/ode/kakeya page rides behind a lazy boundary: a mid-edit state
// of that (integration-owner) module can never take the needle game down
const MathWorldApp = lazy(() => import('./App').then((m) => ({ default: m.MathWorldApp })))

// The same action entry the page uses, exposed for automation and a future
// agent: there is no second, privileged path (no preview scoring, no direct
// state writes — commit() validates, computes real runs and judges).
const api = {
  state: () => host.getSession(),
  preview: () => host.getPreview(),
  worlds: () => host.catalog.map((c) => ({ file: c.file, id: c.world?.id ?? null, errors: c.errors ?? null })),
  load: async (id: string) => {
    const w = host.catalog.find((c) => c.world?.id === id)?.world
    return w ? host.activate(w, 'catalog') : { ok: false as const, errors: [`未知世界 ${id}`] }
  },
  tunables: () => {
    const s = host.getSession()
    return s ? tunables(s.world) : []
  },
  previewParams: (patch: Record<string, number>) => host.preview(patch),
  dragCurveHandle: (id: string, y: number) => host.dragCurveHandle(id, y),
  release: () => host.commitPreview('agent'),
  commit: (patch: Record<string, number>, expectedRevision?: number) => host.commit(patch, {
    expectedRevision: typeof expectedRevision === 'number' ? expectedRevision : undefined,
    actor: 'agent',
  }),
  reset: () => host.reset(),
  undo: () => host.undo(),
  replay: (attemptIdx: number) => host.replay(attemptIdx),
  exitReplay: () => host.exitReplay(),
  /** CLI-112 context for a director/agent: the frozen world revision
   *  (content digest), the run the current committed state rests on, and the
   *  game history (attempts + assessments + run ids) — all read-only */
  context: () => {
    const s = host.getSession()
    if (!s) return null
    const ev = s.committed?.evidence
    const selectedRunId = ev ? (ev.kind === 'kakeya' ? ev.measureRunId : ev.kind === 'ode' ? ev.solveRunId : ev.curveRunId) : null
    return {
      worldId: s.world.id,
      worldRevision: s.worldDigest,
      paperRef: s.world.paperRef ?? null,
      revision: s.revision,
      phase: s.phase,
      selectedRunId,
      history: s.attempts.map((a) => ({ seq: a.seq, actor: a.actor, status: a.status, outcome: a.assessment?.outcome ?? null, runIds: a.runIds, at: a.at })),
    }
  },
  save: () => host.exportSave(),
  /** diagnostic entry the editor UI itself uses — same validation path */
  tryWorld: (raw: unknown) => host.activate(raw, 'edited'),
  importSave: (text: string) => host.importSave(text, 'file'),
  // ---- needle game (CLI-129 搬针过弯): same-entry agent surface ----
  needle: {
    state: () => needleHost.getSession(),
    act: (id: string, expectedRevision?: number) => needleHost.act(id, {
      expectedRevision: typeof expectedRevision === 'number' ? expectedRevision : undefined,
      actor: 'agent',
    }),
    undo: () => needleHost.undo(),
    reset: () => needleHost.reset(),
    solve: () => needleHost.solve(),
    /** solve an arbitrary model (level proposals / editor verification) — same transition */
    solveFor: (model: unknown) => needleHost.solveFor(model as import('./needle/model').NeedleModel),
    /** validate + activate an arbitrary world JSON (same path the editor uses).
     *  Provenance honesty: anything not byte-identical to a shipped sample is
     *  relabelled 'edited' — an agent must not ship edits as dev samples. */
    tryWorld: (raw: unknown) => {
      const w = structuredClone(raw) as { id?: string; origin?: { kind?: string; note?: string } }
      const shipped = ['l-corridor']
      if (w && (!shipped.includes(w.id ?? '') || w.origin?.kind === 'edited')) {
        w.origin = { kind: 'edited', note: `经 __mathworld.tryWorld 进入的世界定义（id=${w.id ?? '?'}），未经来源确认` }
      }
      return needleHost.activate(w, 'edited')
    },
    verifyOwnPath: () => needleHost.verifyOwnPath(),
    save: () => needleHost.exportSave(),
    importSave: (text: string) => needleHost.importSave(text, 'file'),
  },
}
;(window as unknown as { __mathworld: typeof api }).__mathworld = api

const needle = location.hash === '#needle'
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {needle ? <NeedleApp /> : (
      <Suspense fallback={<div className="mw-boot">加载世界…</div>}>
        <MathWorldApp />
      </Suspense>
    )}
  </StrictMode>,
)
