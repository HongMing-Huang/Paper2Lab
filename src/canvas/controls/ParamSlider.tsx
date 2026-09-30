// Parameter control bound to a runtime param cell — the ONLY way UI changes
// derived state (single source of truth; no peer component is touched here).
import { useRuntime, useCell } from '../../runtime/react'

export function ParamSlider({
  label,
  paramId,
  min,
  max,
  step,
  format,
  hint,
}: {
  label: string
  paramId: string
  min: number
  max: number
  step: number
  format?: (v: number) => string
  hint?: string
}) {
  const rt = useRuntime()
  const snap = useCell<number>(paramId)
  const value = snap.value ?? min
  return (
    <label className="param-row nodrag">
      <span className="param-label">
        {label}
        {hint && <em className="param-hint">{hint}</em>}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => rt.setParam(paramId, parseFloat(e.target.value))}
      />
      <span className={`param-value${snap.stale ? ' is-stale' : ''}`}>
        {format ? format(value) : value.toFixed(2)}
      </span>
    </label>
  )
}

export function ParamToggle({
  label,
  paramId,
  labels,
}: {
  label: string
  paramId: string
  labels?: [string, string]
}) {
  const rt = useRuntime()
  const snap = useCell<number>(paramId)
  const on = (snap.value ?? 0) !== 0
  return (
    <label className="param-row param-toggle nodrag">
      <span className="param-label">{label}</span>
      <button
        type="button"
        className={`toggle ${on ? 'on' : ''}`}
        onClick={() => rt.setParam(paramId, on ? 0 : 1)}
      >
        {labels ? (on ? labels[1] : labels[0]) : on ? '开' : '关'}
      </button>
    </label>
  )
}
