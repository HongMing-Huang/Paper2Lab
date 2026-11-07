// Shared warm-paper palette for mathworld display components.
// Values mirror src/styles/paper.css (read-only for this window) and the
// ink colours already used by Tubes3DView, so assets sit on the same paper
// without restyling anything. Presentation-only: no game state lives here.

/** base paper & ink tokens (paper.css) */
export const PAPER = '#faf6ee'
export const PAPER_DEEP = '#f2ecdf'
export const INK = '#2b2620'
export const INK_SOFT = '#6b6154'
export const RULE = '#d9d0bf'
export const DOT = '#d8cfc0'

/** annotation accents (paper.css): vermilion = 标注/高亮, blue ink = 计算/图表 */
export const VERMILION = '#9a3b2e'
export const INK_BLUE = '#2f5d8a'

/** warm brass used by desk handles — reserved for "player is here" */
export const BRASS = '#c98a2b'

/** pale wash used behind translucent volumes (Tubes3DView PAPER_BLUE) */
export const PAPER_BLUE = '#dfe8ef'

export type MathworldStatus = 'idle' | 'computing' | 'ok' | 'fail'
