// Inline draggable parameter chip — parameters live INSIDE formulas and
// experiment sheets (no dashboard panel). Drag horizontally to change the
// value; every change goes through the reactive runtime (single source of
// truth), so the drag→preview→exact pipeline is automatic.
import { useCallback, useRef, useState } from 'react'
import { useRuntime } from '../../runtime/react'

export function ParamChip({
  label,
  paramId,
  read,
  min,
  max,
  step,
  digits = 2,
  display,
}: {
  label: string
  paramId: string
  read: () => number
  min: number
  max: number
  step: number
  digits?: number
  display?: (v: number) => string
}) {
  const rt = useRuntime()
  const [dragging, setDragging] = useState(false)
  const state = useRef({ startX: 0, startValue: 0 })

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation()
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      state.current = { startX: e.clientX, startValue: read() }
      setDragging(true)
    },
    [read],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return
      const dx = e.clientX - state.current.startX
      const raw = state.current.startValue + dx * step
      const snapped = Math.round(raw / step) * step
      const v = Math.min(max, Math.max(min, snapped))
      if (v !== read()) rt.setParam(paramId, v)
    },
    [dragging, rt, paramId, read, min, max, step],
  )

  const onPointerUp = useCallback(() => setDragging(false), [])

  return (
    <span
      className={`param-chip nodrag nowheel${dragging ? ' dragging' : ''}`}
      title={`拖动调整 ${label}（${min} … ${max}）`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="slider"
      aria-label={label}
      aria-valuenow={read()}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onKeyDown={(e) => {
        const cur = read()
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') rt.setParam(paramId, Math.max(min, cur - step))
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') rt.setParam(paramId, Math.min(max, cur + step))
      }}
    >
      <span className="param-chip-label">{label}</span>
      <span className="param-chip-value">{display ? display(read()) : read().toFixed(digits)}</span>
    </span>
  )
}
