// Phase-plane lab (#24): vector field + draggable initial state + trajectory
// + time series. The vector field is a PRESENTATION of the compiled paper
// kernels (same Cortex path the executor uses); the committed trajectory and
// both time curves come from the ONE ode.phase ExperimentRun. Drag = local
// coarse preview (same kernels); release = exact run through the unified
// executor (#23 contract).
import { useEffect, useMemo, useRef, useState } from 'react'
import JXG from 'jsxgraph'
import { odePhaseStore, type OdePhaseExperiment } from './odePhaseStore'

const BOUND = 3.2
/** registered config (#24): vector-field arrow grid density per axis */
const VF_GRID = 11

export function PhasePlaneChart({ experiment, width, height }: { experiment: OdePhaseExperiment; width: number; height: number }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<JXG.Board | null>(null)
  const trajRef = useRef<Array<JXG.GeometryElement>>([])
  const vfArrowsRef = useRef<Array<JXG.GeometryElement>>([])
  const pointRef = useRef<JXG.Point | null>(null)
  const dragRef = useRef<{ user0: [number, number]; client: [number, number] } | null>(null)
  const [dragging, setDragging] = useState(false)

  const kernels = odePhaseStore.kernelsOf(experiment.id)
  const traj = experiment.status === 'stale' && experiment.preview
    ? experiment.preview
    : experiment.run?.result ?? experiment.preview

  const initial = experiment.preview && dragging ? experiment.preview.initial : experiment.initial

  // board (once) — vector field arrows drawn from the compiled paper kernels
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const b = JXG.JSXGraph.initBoard(host, {
      boundingbox: [-BOUND, BOUND, BOUND, -BOUND],
      axis: true,
      showCopyright: false,
      showNavigation: false,
      keepaspectratio: true,
      pan: { enabled: false },
      zoom: { factorX: 1, factorY: 1, wheel: false },
      registerEvents: true,
    })
    boardRef.current = b
    return () => {
      boardRef.current = null
      pointRef.current = null
      vfArrowsRef.current = []
      JXG.JSXGraph.freeBoard(b)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // vector field (static per experiment — the paper's model itself)
  useEffect(() => {
    const b = boardRef.current
    const k = kernels
    if (!b || !k) return
    for (const a of vfArrowsRef.current) {
      try {
        ;(b.removeObject as (el: JXG.GeometryElement) => void)(a)
      } catch {
        /* already freed */
      }
    }
    vfArrowsRef.current = []
    for (let i = 0; i < VF_GRID; i++) {
      for (let j = 0; j < VF_GRID; j++) {
        const x = -BOUND + (2 * BOUND * (i + 0.5)) / VF_GRID
        const y = -BOUND + (2 * BOUND * (j + 0.5)) / VF_GRID
        const dx = k.f0(x, y)
        const dy = k.f1(x, y)
        const norm = Math.hypot(dx, dy)
        if (!Number.isFinite(norm) || norm < 1e-9) continue
        const len = ((2 * BOUND) / VF_GRID) * 0.42
        const ax = (dx / norm) * len
        const ay = (dy / norm) * len
        vfArrowsRef.current.push(
          b.create('arrow', [[x - ax / 2, y - ay / 2], [x + ax / 2, y + ay / 2]], {
            strokeColor: 'rgba(138,127,112,0.35)',
            strokeWidth: 1,
            highlight: false,
            lastArrow: true,
          }) as unknown as JXG.GeometryElement,
        )
      }
    }
    b.update()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experiment.id, kernels?.f0, kernels?.f1])

  // trajectory + initial point (rebuild on run/preview identity)
  useEffect(() => {
    const b = boardRef.current
    if (!b) return
    for (const c of trajRef.current) {
      try {
        ;(b.removeObject as (el: JXG.GeometryElement) => void)(c)
      } catch {
        /* already freed */
      }
    }
    trajRef.current = []
    if (traj) {
      const isPreview = 'initial' in traj
      trajRef.current.push(
        b.create(
          'curve',
          [traj.s0, traj.s1],
          { strokeColor: isPreview ? '#8a7f70' : '#2f5a8f', strokeWidth: 2, dash: isPreview ? 2 : 0, highlight: false },
        ) as unknown as JXG.GeometryElement,
      )
    }
    if (!pointRef.current) {
      const pt = b.create('point', [initial[0], initial[1]], {
        name: `${experiment.states[0]}₀,${experiment.states[1]}₀`,
        size: 4,
        fillColor: '#b3542e',
        strokeColor: '#b3542e',
        showInfobox: false,
        highlight: true,
      }) as unknown as JXG.Point
      pointRef.current = pt
    } else {
      pointRef.current.moveTo([initial[0], initial[1]])
    }
    b.update()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traj, initial[0], initial[1]])

  // drag the initial point (React synthetic events; JXG board only renders)
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const b = boardRef.current
    const node = pointRef.current?.rendNode as SVGElement | undefined
    if (!b || !node) return
    const r = node.getBoundingClientRect()
    const dx = e.clientX - (r.x + r.width / 2)
    const dy = e.clientY - (r.y + r.height / 2)
    if (dx * dx + dy * dy > 20 * 20) return
    e.stopPropagation()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic events carry no active pointer */
    }
    dragRef.current = { user0: [initial[0], initial[1]], client: [e.clientX, e.clientY] }
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    const b = boardRef.current
    if (!d || !b) return
    e.stopPropagation()
    const [, ymin, , ymax] = b.getBoundingBox()
    const h = b.canvasHeight || hostRef.current?.clientHeight || 1
    const unitPerPx = (ymax - ymin) / h
    const x = Math.max(-BOUND, Math.min(BOUND, d.user0[0] + (e.clientX - d.client[0]) * unitPerPx))
    const y = Math.max(-BOUND, Math.min(BOUND, d.user0[1] - (e.clientY - d.client[1]) * unitPerPx))
    odePhaseStore.setPreviewInitial(experiment.id, x, y)
  }
  const onPointerUp = () => {
    const wasDragging = dragRef.current !== null
    dragRef.current = null
    setDragging(false)
    if (wasDragging) void odePhaseStore.release(experiment.id)
  }

  const timeCurves = useMemo(() => {
    if (!traj) return null
    const isPreview = 'initial' in traj
    const n = traj.t.length
    if (n < 2) return null
    const maxT = traj.t[n - 1]
    const maxAbs = Math.max(1, ...traj.s0.map(Math.abs), ...traj.s1.map(Math.abs))
    const path = (series: number[]) =>
      series
        .map((v, i) => `${((traj.t[i] / maxT) * 100).toFixed(2)},${(50 - (v / (maxAbs * 1.15)) * 45).toFixed(2)}`)
        .join(' ')
    return { isPreview, s0: path(traj.s0), s1: path(traj.s1), maxAbs, maxT }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traj])

  return (
    <div className="ode-phase" data-run-id={experiment.run?.runId ?? ''} data-testid="ode-phase">
      <div
        ref={hostRef}
        className="desk-chart"
        style={{ width, height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className="ode-phase-side">
        {timeCurves && (
          <>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="ode-time-chart" data-testid="ode-time-s0">
              <polyline points={timeCurves.s0} fill="none" stroke="#2f5a8f" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
              <text x="2" y="8" fontSize="5" fill="#2f5a8f">{experiment.states[0]}(t)</text>
            </svg>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="ode-time-chart" data-testid="ode-time-s1">
              <polyline points={timeCurves.s1} fill="none" stroke="#5c7a52" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
              <text x="2" y="8" fontSize="5" fill="#5c7a52">{experiment.states[1]}(t)</text>
            </svg>
          </>
        )}
        <div className="ode-phase-meta">
          <span className={`desk-run-badge ${experiment.status === 'resolved' ? 'st-resolved' : 'st-computing'}`}>
            {experiment.status === 'computing' ? 'LOCAL COMPUTE…' : timeCurves?.isPreview || dragging ? 'preview（拖动中）' : `CALCULATED · run …${experiment.run?.runId.slice(-6) ?? '—'}`}
          </span>
          {experiment.run?.result?.period0 != null && (
            <span>周期 ≈ {experiment.run.result.period0.toFixed(3)}（s₀ 上升过零中位数）</span>
          )}
          <span>初值 {experiment.states[0]}={experiment.initial[0].toFixed(2)} · {experiment.states[1]}={experiment.initial[1].toFixed(2)} · 已释放 {experiment.history.length} 次</span>
          {experiment.error && <span className="ode-error">{experiment.error}</span>}
        </div>
      </div>
    </div>
  )
}
