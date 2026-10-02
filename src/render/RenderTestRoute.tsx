// Headless render-test route (#render-test) — the windowless-WebGL evidence
// harness for the Kakeya 3D scene. Mounts the REAL runtime + Tubes3DView
// (spin=0 for deterministic frames) and exposes a minimal page-level API:
//   window.__renderTest = { ready, getPacking, setPacking, tubeCount }
// scripts/render-webgl-test.mjs drives it with SwiftShader Chrome: asserts a
// non-empty canvas, pixel changes after a packing change, and drag→param
// reverse write-back. Not part of the product surface.
import { useEffect } from 'react'
import { RuntimeProvider, useCell } from '../runtime/react'
import { kakeya, tubesRunCell } from '../paper/kakeyaGraph'
import { Tubes3DView } from '../canvas/views/Tubes3DView'

function Scene() {
  const tubes = useCell(tubesRunCell)
  const list = tubes.value?.result ?? []

  useEffect(() => {
    const api = {
      get ready() {
        return list.length > 0
      },
      getPacking: () => (kakeya.get('kakeya.packing').value as number) ?? 0,
      setPacking: (v: number) => kakeya.setParam('kakeya.packing', v),
      tubeCount: () => list.length,
      tubesRunId: () => tubes.value?.runId ?? null,
    }
    ;(window as unknown as { __renderTest: typeof api }).__renderTest = api
  }, [list, tubes.value?.runId])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#faf6ee' }}>
      <Tubes3DView
        tubes={list}
        spin={0}
        height={520}
        packingDrag
        preserveDrawingBuffer
      />
    </div>
  )
}

export function RenderTestRoute() {
  return (
    <RuntimeProvider runtime={kakeya}>
      <Scene />
    </RuntimeProvider>
  )
}
