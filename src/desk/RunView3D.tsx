// Drei View on the research desk (pmndrs/drei View portal pattern): ONE
// shared Canvas fixed over the desk; every 3D experiment paper registers a
// tracked <div>, and a <View> renders THAT EXPERIMENT's kakeya.geometry run
// inside the div's screen rect. #51 P0-D: papers no longer share the hero
// demo's global tubesRunCell — each p2l-3d shape owns its params/runs
// (run3dStore); dragging reverse-writes THAT experiment's packing (preview
// during drag is presentation-only, exact on release = its own runs).
import { useEffect, useRef, useState, type RefObject } from 'react'
import { Canvas } from '@react-three/fiber'
import { View } from '@react-three/drei'
import { TubesScene } from '../canvas/views/Tubes3DView'
import { Interactive } from './shapes'
import {
  commitPacking,
  endPreview,
  getRun3D,
  listRun3D,
  metricsOf,
  previewTubes,
  setPreviewPacking,
  subscribeRun3D,
  tubesOf,
} from './run3dStore'
import type { Tube3 } from '../kakeya/tubes'

/** re-render on any experiment change (per-shape state lives in the store) */
function useRun3DVersion(): number {
  const [v, setV] = useState(0)
  useEffect(() => subscribeRun3D(() => setV((n) => n + 1)), [])
  return v
}

// ---- tracked-element registry (shapeId → live DOM node) ----------------------
const trackedViews = new Map<string, HTMLElement>()
export function trackRunView3D(shapeId: string, el: HTMLElement | null) {
  if (el) trackedViews.set(shapeId, el)
  else trackedViews.delete(shapeId)
}

/** the in-shape host: tracked div + THIS experiment's badges + drag write-back */
export function RunView3DHost({ shapeId }: { shapeId: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const version = useRun3DVersion()
  const dragState = useRef<{ y: number; packing: number } | null>(null)

  useEffect(() => {
    trackRunView3D(shapeId, ref.current)
    return () => trackRunView3D(shapeId, null)
  }, [shapeId])

  void version // subscription drives re-render; data read synchronously below
  const exp = getRun3D(shapeId)
  const metrics = metricsOf(exp)

  return (
    <div className="run3d-host">
      {/* Interactive wrapper = the tldraw 5 pattern for hit-testable shape
          content (bare shape HTML is pointer-transparent to the canvas) */}
      <Interactive className="run3d-interactive">
        <div
          ref={ref}
          className="run3d-track nodrag nowheel grabbable"
          title="本实验纸自己的 kakeya.geometry Run — 上下拖动反写该实验的 packing（互不影响其他实验纸/主 Demo）"
          onPointerDown={(e) => {
            e.stopPropagation()
            const p = exp?.previewPacking ?? exp?.params.packing ?? 0
            dragState.current = { y: e.clientY, packing: p }
            try {
              ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            } catch {
              /* synthetic events carry no active pointer */
            }
          }}
          onPointerMove={(e) => {
            const s = dragState.current
            if (!s || !exp) return
            const dy = e.clientY - s.y // drag up ⇒ pack
            const v = Math.min(1, Math.max(0, s.packing - dy / 140))
            setPreviewPacking(shapeId, Math.round(v * 20) / 20)
          }}
          onPointerUp={() => {
            const s = dragState.current
            dragState.current = null
            if (s && exp && exp.previewPacking != null) {
              void commitPacking(shapeId, exp.previewPacking) // exact: this experiment's own runs
            } else {
              endPreview(shapeId)
            }
          }}
          onPointerCancel={() => {
            dragState.current = null
            endPreview(shapeId)
          }}
        />
      </Interactive>
      <div className="run3d-caption">
        {exp?.previewPacking != null ? (
          <span className="badge-preview">preview</span>
        ) : (
          <span className="badge-calc">CALCULATED</span>
        )}{' '}
        {exp?.status === 'computing'
          ? 'computing…'
          : exp?.runId
            ? `per-exp run …${exp.runId.slice(-4)} · packing=${exp.params.packing.toFixed(2)}`
            : 'waiting for run'}
        {metrics ? ` · |⋃T|=${metrics.occupiedVolume.toFixed(4)} · max m=${metrics.maxMultiplicity}` : ''}
        {exp?.status === 'error' ? ` · ✖ ${exp.error}` : ''}
      </div>
    </div>
  )
}

/** one 3D scene per tracked paper — renders THAT experiment's tubes (its own
 * run; drag preview shown affine-interpolated, presentation-only) */
function KakeyaExperimentView({ shapeId, el }: { shapeId: string; el: HTMLElement }) {
  const version = useRun3DVersion()
  void version
  const visible = el.isConnected && el.offsetWidth > 0 && el.offsetHeight > 0
  if (!visible) return null
  const exp = getRun3D(shapeId)
  const base = tubesOf(exp)
  const tubes: Tube3[] = exp?.previewPacking != null ? previewTubes(base, exp.previewPacking) : base
  return (
    <>
      <ambientLight intensity={0.75} />
      <directionalLight position={[3, 5, 4]} intensity={1.1} />
      <directionalLight position={[-4, -2, -3]} intensity={0.35} />
      {tubes.length > 0 && <TubesScene tubes={tubes} showVoxels={false} spin={0.22} />}
    </>
  )
}

/** one shared Canvas over the whole desk — renders a <View> per tracked paper */
export function Desk3DOverlay({ rootRef }: { rootRef: RefObject<HTMLDivElement | null> }) {
  const [entries, setEntries] = useState<Array<[string, HTMLElement]>>([])
  const version = useRun3DVersion()
  void version // store changes re-render so newly initialised experiments appear

  useEffect(() => {
    const sync = () => {
      setEntries([...trackedViews.entries()])
    }
    sync()
    const t = window.setInterval(sync, 500) // layout/camera changes republish rects
    return () => window.clearInterval(t)
  }, [])

  const known = new Set(listRun3D().map((e) => e.shapeId))

  return (
    <div className="desk3d-overlay" aria-hidden="true">
      <Canvas
        frameloop="always"
        dpr={[1, 2]}
        camera={{ position: [1.55, 1.25, 1.55], fov: 38 }}
        eventPrefix="client"
        eventSource={rootRef.current ?? undefined}
        gl={{ antialias: true, alpha: true }}
        style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1 }}
      >
        {entries.map(([id, el]) =>
          known.has(id) ? (
            <View key={id} track={{ current: el }}>
              <KakeyaExperimentView shapeId={id} el={el} />
            </View>
          ) : null,
        )}
      </Canvas>
    </div>
  )
}
