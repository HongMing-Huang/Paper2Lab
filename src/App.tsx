// App shell: clean home → (a) ingest desk for any uploaded PDF (tldraw),
// (b) the dedicated Wang–Zahl Kakeya lab (Paper Mode + xyflow canvas, v1–v4).
// The three labs + the desk load LAZILY (React.lazy): tldraw, xyflow,
// three/R3F, cortex and mujoco weigh ~10MB combined and used to ship in ONE
// chunk — first paint on the home page paid for every desktop at once.
import { Suspense, lazy, useCallback, useState } from 'react'
import { Home } from './desk/Home'
import type { DeskPayload } from './desk/context'
import type { IngestedDoc } from './ingest/doclingSchema'
import type { AdapterDecision } from './skills/adapterRouter'

const DeskCanvas = lazy(() => import('./canvas/DeskCanvas').then((m) => ({ default: m.DeskCanvas })))
const PaperDesk = lazy(() => import('./desk/PaperDesk').then((m) => ({ default: m.PaperDesk })))
const PhysicsLab = lazy(() => import('./physics/view/PhysicsLab').then((m) => ({ default: m.PhysicsLab })))
const ChallengesLab = lazy(() => import('./challenges/ChallengesLab').then((m) => ({ default: m.ChallengesLab })))

type Route =
  | { kind: 'home' }
  | { kind: 'kakeya' }
  | { kind: 'physics' }
  | { kind: 'challenges' }
  | { kind: 'desk'; payload: DeskPayload }

function LabLoading({ label }: { label: string }) {
  return (
    <div className="app-lab-loading">
      <span className="home-spin">◌</span> {label}引擎加载中…
    </div>
  )
}

export function App() {
  const [route, setRoute] = useState<Route>({ kind: 'home' })

  const onDesk = useCallback(
    (file: File, pdfUrl: string, doc: IngestedDoc, decision: AdapterDecision) => {
      setRoute({
        kind: 'desk',
        payload: { doc, pdfUrl, fileName: file.name, decision },
      })
    },
    [],
  )
  const onKakeya = useCallback(() => setRoute({ kind: 'kakeya' }), [])
  const onPhysics = useCallback(() => setRoute({ kind: 'physics' }), [])
  const onChallenges = useCallback(() => setRoute({ kind: 'challenges' }), [])
  const onHome = useCallback(() => setRoute({ kind: 'home' }), [])

  if (route.kind === 'home') return <Home onDesk={onDesk} onKakeya={onKakeya} onPhysics={onPhysics} onChallenges={onChallenges} />
  if (route.kind === 'kakeya')
    return (
      <Suspense fallback={<LabLoading label="Kakeya " />}>
        <DeskCanvas onExit={onHome} />
      </Suspense>
    )
  if (route.kind === 'physics')
    return (
      <Suspense fallback={<LabLoading label="Physics " />}>
        <PhysicsLab onExit={onHome} />
      </Suspense>
    )
  if (route.kind === 'challenges')
    return (
      <Suspense fallback={<LabLoading label="Challenges " />}>
        <ChallengesLab onExit={onHome} />
      </Suspense>
    )
  return (
    <Suspense fallback={<LabLoading label="研究桌面" />}>
      <PaperDesk payload={route.payload} onOpenKakeya={onKakeya} />
    </Suspense>
  )
}
