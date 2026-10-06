// App shell: clean home → (a) ingest desk for any uploaded PDF (tldraw),
// (b) the dedicated Wang–Zahl Kakeya lab (Paper Mode + xyflow canvas, v1–v4).
import { useCallback, useState } from 'react'
import { DeskCanvas } from './canvas/DeskCanvas'
import { Home } from './desk/Home'
import { PaperDesk } from './desk/PaperDesk'
import { PhysicsLab } from './physics/view/PhysicsLab'
import type { DeskPayload } from './desk/context'
import type { IngestedDoc } from './ingest/doclingSchema'
import type { AdapterDecision } from './skills/adapterRouter'

type Route =
  | { kind: 'home' }
  | { kind: 'kakeya' }
  | { kind: 'physics' }
  | { kind: 'desk'; payload: DeskPayload }

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
  const onHome = useCallback(() => setRoute({ kind: 'home' }), [])

  if (route.kind === 'home') return <Home onDesk={onDesk} onKakeya={onKakeya} onPhysics={onPhysics} />
  if (route.kind === 'kakeya') return <DeskCanvas onExit={onHome} />
  if (route.kind === 'physics') return <PhysicsLab onExit={onHome} />
  return <PaperDesk payload={route.payload} onOpenKakeya={onKakeya} />
}
