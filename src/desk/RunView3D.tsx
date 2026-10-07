// Drei View on the research desk (pmndrs/drei View portal pattern): ONE
// shared Canvas fixed over the desk; every 3D experiment paper registers a
// tracked <div>, and a <View> renders the REAL kakeya.geometry Run inside
// that div's screen rect — the 3D follows the paper's position and size as
// the lab frame rearranges it. Dragging the family reverse-writes the
// packing parameter into the SAME reactive runtime the hero demo uses
// (UI⇄model); every number on the paper comes from an ExperimentRun.
import { useEffect, useRef, useState, type RefObject } from 'react'
import { Canvas } from '@react-three/fiber'
import { View } from '@react-three/drei'
import { TubesScene } from '../canvas/views/Tubes3DView'
import { kakeya, tubesRunCell, voxelCell, pPacking } from '../paper/kakeyaGraph'
import { Interactive } from './shapes'
import type { CellSnapshot } from '../runtime/cell'
import type { Tube3 } from '../kakeya/tubes'
import type { VoxelResult } from '../kakeya/voxels3d'
import type { ExperimentRun } from '../experiments/protocol'

/** subscribe to a kakeya runtime cell WITHOUT a React provider (desk path) */
function useKakeyaCell<T>(cellId: string): CellSnapshot<T> | undefined {
  const [snap, setSnap] = useState<CellSnapshot<T> | undefined>(() => kakeya.get(cellId) as CellSnapshot<T>)
  useEffect(() => {
    const bump = () => setSnap({ ...(kakeya.get(cellId) as CellSnapshot<T>) })
    bump()
    return kakeya.subscribe(cellId, bump)
  }, [cellId])
  return snap
}

// ---- tracked-element registry (shapeId → live DOM node) ----------------------
const trackedViews = new Map<string, HTMLElement>()
export function trackRunView3D(shapeId: string, el: HTMLElement | null) {
  if (el) trackedViews.set(shapeId, el)
  else trackedViews.delete(shapeId)
}

/** the in-shape host: tracked div + Run badges + drag write-back */
export function RunView3DHost({ shapeId }: { shapeId: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const tubes = useKakeyaCell<ExperimentRun<Tube3[]>>(tubesRunCell.id)
  const vox = useKakeyaCell<ExperimentRun<VoxelResult>>(voxelCell.id)
  const dragState = useRef<{ y: number; packing: number } | null>(null)

  useEffect(() => {
    trackRunView3D(shapeId, ref.current)
    return () => trackRunView3D(shapeId, null)
  }, [shapeId])

  const run = tubes?.value
  const metrics = vox?.value?.result
  return (
    <div className="run3d-host">
      {/* Interactive wrapper = the tldraw 5 pattern for hit-testable shape
          content (bare shape HTML is pointer-transparent to the canvas) */}
      <Interactive className="run3d-interactive">
        <div
          ref={ref}
          className="run3d-track nodrag nowheel grabbable"
          title="Run 驱动的 3D（kakeya.geometry）— 在管族上上下拖动 = 反写 packing（与 Hero Demo 同一 Runtime）"
          onPointerDown={(e) => {
            e.stopPropagation()
            const p = (kakeya.get(pPacking.id).value as number) ?? 0
            dragState.current = { y: e.clientY, packing: p }
            try {
              ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            } catch {
              /* synthetic events carry no active pointer */
            }
          }}
          onPointerMove={(e) => {
            const s = dragState.current
            if (!s) return
            const dy = e.clientY - s.y // drag up ⇒ pack
            const v = Math.min(1, Math.max(0, s.packing - dy / 140))
            kakeya.setParam(pPacking.id, Math.round(v * 20) / 20)
          }}
          onPointerUp={() => {
            dragState.current = null
          }}
          onPointerCancel={() => {
            dragState.current = null
          }}
        />
      </Interactive>
      <div className="run3d-caption">
        <span className="badge-calc">CALCULATED</span>{' '}
        {run ? `${run.engine}@${run.engineVersion} · run …${run.runId.slice(-4)}` : 'computing…'}
        {metrics ? ` · |⋃T|=${metrics.occupiedVolume.toFixed(4)} · max m=${metrics.maxMultiplicity}` : ''}
      </div>
    </div>
  )
}

/** one 3D scene per tracked paper — each View subscribes to ITS OWN cell
 *  snapshot (#33): the old overlay read ONE global kakeya run and fed every
 *  view with it, so multiple 3D papers were copies of a single experiment.
 *  Views whose element left the DOM or collapsed are not rendered. */
function KakeyaExperimentView({ el }: { el: HTMLElement }) {
  const tubes = useKakeyaCell<ExperimentRun<Tube3[]>>(tubesRunCell.id)
  const visible = el.isConnected && el.offsetWidth > 0 && el.offsetHeight > 0
  if (!visible) return null
  return (
    <>
      <ambientLight intensity={0.75} />
      <directionalLight position={[3, 5, 4]} intensity={1.1} />
      <directionalLight position={[-4, -2, -3]} intensity={0.35} />
      <TubesScene tubes={runTubes(tubes)} showVoxels={false} spin={0.22} />
    </>
  )
}

/** one shared Canvas over the whole desk — renders a <View> per tracked paper */
export function Desk3DOverlay({ rootRef }: { rootRef: RefObject<HTMLDivElement | null> }) {
  const [entries, setEntries] = useState<Array<[string, HTMLElement]>>([])

  useEffect(() => {
    const sync = () => setEntries([...trackedViews.entries()])
    sync()
    const t = window.setInterval(sync, 500) // layout/camera changes republish rects
    return () => window.clearInterval(t)
  }, [])

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
        {entries.map(([id, el]) => (
          <View key={id} track={{ current: el }}>
            <KakeyaExperimentView el={el} />
          </View>
        ))}
      </Canvas>
    </div>
  )
}

function runTubes(snap: CellSnapshot<ExperimentRun<Tube3[]>> | undefined): Tube3[] {
  const run = snap?.value
  // tubes live in the run's result envelope (kakeya.geometry)
  return (run?.result as unknown as Tube3[] | undefined) ?? []
}
