// Formula with draggable parameter chips embedded *inside* the typeset
// formula. The semantic split (params vs independent vs output) comes from
// Cortex (src/formula/analyze.ts); the latex segmentation below is a
// display-layer operation only — segment boundaries never feed computation.
import { useCallback, useRef, useState } from 'react'
import { convertLatexToMarkup } from 'mathlive'
import type { ParamSpec } from '../formula/analyze'
import { explorerStore } from './explorerStore'
import { useExplorer } from './context'

export function DeskParamChip({
  explorerId,
  param,
}: {
  explorerId: string
  param: ParamSpec
}) {
  const explorer = useExplorer(explorerId)
  const [dragging, setDragging] = useState(false)
  const state = useRef({ startX: 0, startValue: 0 })
  const read = () => explorer?.params[param.name] ?? param.default

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation()
      try {
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      } catch {
        /* synthetic events in tests carry no active pointer */
      }
      state.current = { startX: e.clientX, startValue: read() }
      setDragging(true)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [explorerId],
  )
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return
      const dx = e.clientX - state.current.startX
      const raw = state.current.startValue + dx * param.step
      const snapped = Math.round(raw / param.step) * param.step
      const v = Math.min(param.max, Math.max(param.min, snapped))
      if (v !== read()) explorerStore.setParams(explorerId, { [param.name]: v })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dragging, explorerId],
  )
  const onPointerUp = useCallback(() => setDragging(false), [])

  return (
    <span
      className={`desk-chip${dragging ? ' dragging' : ''}`}
      title={`拖动调整 ${param.name}（${param.min} … ${param.max}）`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="slider"
      aria-label={param.name}
      aria-valuenow={read()}
      tabIndex={0}
      onKeyDown={(e) => {
        const cur = read()
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown')
          explorerStore.setParams(explorerId, { [param.name]: Math.max(param.min, cur - param.step) })
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp')
          explorerStore.setParams(explorerId, { [param.name]: Math.min(param.max, cur + param.step) })
      }}
    >
      <span className="desk-chip-name">{param.name}</span>
      <span className="desk-chip-value">{read().toFixed(2)}</span>
    </span>
  )
}

type Segment = { latex: string } | { chip: ParamSpec }

/**
 * Split display latex at standalone param tokens. A token qualifies when the
 * preceding character is neither a letter nor a backslash (keeps `\cos`/the
 * letters inside commands intact); multi-letter bare sequences are products
 * of single variables, so consuming left-to-right is correct.
 */
export function splitLatexByParams(latex: string, params: ParamSpec[]): Segment[] {
  const names = params.map((p) => p.name)
  const out: Segment[] = []
  let buf = ''
  for (let i = 0; i < latex.length; ) {
    const prev = i > 0 ? latex[i - 1] : ''
    const okBoundary = !/[a-zA-Z\\]/.test(prev)
    const hit = okBoundary ? names.find((n) => latex.startsWith(n, i)) : undefined
    if (hit) {
      if (buf) out.push({ latex: buf })
      buf = ''
      out.push({ chip: params.find((p) => p.name === hit)! })
      i += hit.length
    } else {
      buf += latex[i]
      i++
    }
  }
  if (buf) out.push({ latex: buf })
  return out
}

/** the formula as the paper shows it, with live chips where the params sit */
export function FormulaWithChips({
  latex,
  params,
  explorerId,
}: {
  latex: string
  params: ParamSpec[]
  explorerId: string
}) {
  const segments = splitLatexByParams(latex, params)
  return (
    <span className="desk-formula">
      {segments.map((seg, i) =>
        'chip' in seg ? (
          <DeskParamChip key={i} explorerId={explorerId} param={seg.chip} />
        ) : (
          <span
            key={i}
            className="desk-formula-static"
            // convertLatexToMarkup emits MathLive's own trusted markup
            dangerouslySetInnerHTML={{ __html: convertLatexToMarkup(seg.latex) }}
          />
        ),
      )}
    </span>
  )
}
