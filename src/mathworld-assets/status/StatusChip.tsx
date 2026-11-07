// Status chip — plain-DOM badge for game state, usable inside or outside a
// Canvas (game window places it in its own HUD/layout). Styles are inline:
// this window must not touch global stylesheets. It mirrors the badge
// language already on the desk (badge-calculated / badge-paper / dashed
// AI_INFERENCE) so states read consistently. Text is display-only.
import type { CSSProperties, ReactNode } from 'react'
import { INK, INK_SOFT, INK_BLUE, PAPER, RULE, VERMILION, type MathworldStatus } from '../palette'

const CHIP: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '2px 8px',
  borderRadius: 3,
  border: '1px solid',
  fontSize: 11,
  lineHeight: '15px',
  fontVariantNumeric: 'tabular-nums',
  letterSpacing: 0.2,
}

const STATE_STYLE: Record<MathworldStatus, CSSProperties> = {
  idle: { color: INK_SOFT, borderColor: 'rgba(107,97,84,0.5)', background: 'rgba(107,97,84,0.06)' },
  computing: { color: INK_SOFT, borderColor: 'rgba(107,97,84,0.5)', background: 'rgba(107,97,84,0.08)', borderStyle: 'dashed' },
  ok: { color: INK_BLUE, borderColor: 'rgba(47,93,138,0.5)', background: 'rgba(47,93,138,0.06)' },
  fail: { color: VERMILION, borderColor: 'rgba(154,59,46,0.5)', background: 'rgba(154,59,46,0.06)' },
}

const DOT_COLOR: Record<MathworldStatus, string> = {
  idle: INK_SOFT,
  computing: INK_SOFT,
  ok: INK_BLUE,
  fail: VERMILION,
}

const DEFAULT_LABEL: Record<MathworldStatus, string> = {
  idle: '待验证',
  computing: '计算中…',
  ok: '通过',
  fail: '未通过',
}

/** small ink dot; blinks only in the 'computing' state (presentation) */
function ChipDot({ state }: { state: MathworldStatus }) {
  const pulse = state === 'computing'
  const style: CSSProperties = {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: DOT_COLOR[state],
    flex: 'none',
    ...(pulse ? { animation: 'p2l-asset-chip-pulse 1.1s ease-in-out infinite' } : {}),
  }
  return <span style={style} />
}

export function StatusChip({
  state,
  label,
  children,
}: {
  state: MathworldStatus
  /** override the default Chinese label; pass '' to render no text */
  label?: string
  /** optional extra content (e.g. metric text) rendered after the label */
  children?: ReactNode
}) {
  return (
    <span style={{ ...CHIP, ...STATE_STYLE[state] }}>
      <ChipDot state={state} />
      {label !== undefined ? label : DEFAULT_LABEL[state]}
      {children != null ? <span style={{ opacity: 0.8 }}>{children}</span> : null}
    </span>
  )
}

// ---------------------------------------------------------------- DOM styles
// Injected once per page (idempotent) — keeps every style this library needs
// inside the library, since global stylesheets are outside our write scope.
const STYLE_ID = 'p2l-mathworld-assets-styles'
const STYLE_CSS = `
@keyframes p2l-asset-chip-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
.p2l-asset-error-note {
  border-left: 2.5px solid ${VERMILION};
  background: rgba(154,59,46,0.045);
  color: ${INK};
  font-size: 12.5px;
  font-style: italic;
  line-height: 1.5;
  padding: 8px 10px;
  margin: 4px 0 10px;
}
.p2l-asset-divider { border: none; border-top: 1px dashed ${RULE}; margin: 8px 0; }
.p2l-asset-caption { font-size: 11px; color: ${INK_SOFT}; }
.p2l-asset-paper-plain { background: ${PAPER}; }
`

export function injectMathworldAssetStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = STYLE_CSS
  document.head.appendChild(el)
}
