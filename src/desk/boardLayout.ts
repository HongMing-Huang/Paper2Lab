// Board layouts for the research desk — pure arrange functions, ported from
// tldraw v5.5.0 apps/examples frame-layouts/BoardLayouts.ts (adapted for
// Paper2Lab's paper/experiment/chart children; tldraw SDK license applies to
// the derived pattern — production use needs the SDK license).
//
// The layout is a PURE function over child boxes: no editor access, so it is
// unit-testable and reusable. Modes:
//   row       — all children equal height, left→right
//   grid      — banded reading order, √n columns
//   spotlight — FIRST child enlarged (main experiment), branches stacked beside
import type { TLShapeId } from '@tldraw/tldraw'

export const BOARD_PADDING = 16
export const BOARD_GAP = 12
export const BOARD_HEADER_HEIGHT = 36

const CARD_HEIGHT = 150
export const HERO_HEIGHT = 300
const THUMBNAIL_HEIGHT = 96

export type BoardLayoutMode = 'free' | 'row' | 'grid' | 'spotlight'

/** A child's box, relative to the board's content area. */
export interface LayoutBox {
  id: TLShapeId
  x: number
  y: number
  w: number
  h: number
}

export interface BoardLayout {
  label: string
  /** `null` arranges nothing, so the board behaves like a plain frame. */
  arrange: ((children: LayoutBox[]) => { boxes: LayoutBox[]; w: number; h: number }) | null
}

const midX = (box: LayoutBox) => box.x + box.w / 2
const midY = (box: LayoutBox) => box.y + box.h / 2

/** Scale a box to a target height, keeping its aspect ratio. */
const toHeight = (box: LayoutBox, h: number) => ({ ...box, w: (box.w / box.h) * h, h })

export const BOARD_LAYOUTS: Record<BoardLayoutMode, BoardLayout> = {
	free: {
		label: '自由',
		arrange: null,
	},
	row: {
		label: '并排',
		arrange(children) {
			let x = 0
			const boxes = [...children]
				.sort((a, b) => midX(a) - midX(b))
				.map((box) => {
					const next = { ...toHeight(box, CARD_HEIGHT), x, y: 0 }
					x += next.w + BOARD_GAP
					return next
				})
			return { boxes, w: children.length ? x - BOARD_GAP : 0, h: children.length ? CARD_HEIGHT : 0 }
		},
	},
	grid: {
		label: '网格',
		arrange(children) {
			if (!children.length) return { boxes: [], w: 0, h: 0 }
			const cells = children.map((box) => toHeight(box, CARD_HEIGHT))
			const cellW = Math.max(...cells.map((box) => box.w))
			// Read the cards in rows: group them into horizontal bands, then left to right
			const band = (box: LayoutBox) => Math.round(midY(box) / (CARD_HEIGHT + BOARD_GAP))
			const sorted = cells.sort((a, b) => band(a) - band(b) || midX(a) - midX(b))
			const columns = Math.ceil(Math.sqrt(sorted.length))
			const rows = Math.ceil(sorted.length / columns)
			const boxes = sorted.map((box, i) => ({
				...box,
				x: (i % columns) * (cellW + BOARD_GAP) + (cellW - box.w) / 2,
				y: Math.floor(i / columns) * (CARD_HEIGHT + BOARD_GAP),
			}))
			return {
				boxes,
				w: columns * cellW + (columns - 1) * BOARD_GAP,
				h: rows * CARD_HEIGHT + (rows - 1) * BOARD_GAP,
			}
		},
	},
	spotlight: {
		label: '聚焦',
		arrange(children) {
			if (!children.length) return { boxes: [], w: 0, h: 0 }
			const [first, ...rest] = [...children].sort((a, b) => midX(a) - midX(b))
			const hero = toHeight(first, HERO_HEIGHT)
			const thumbnails = rest
				.sort((a, b) => midY(a) - midY(b))
				.map((box) => toHeight(box, THUMBNAIL_HEIGHT))

			const stackH =
				thumbnails.length * THUMBNAIL_HEIGHT + Math.max(0, thumbnails.length - 1) * BOARD_GAP
			const h = Math.max(HERO_HEIGHT, stackH)
			const stackW = thumbnails.length ? Math.max(...thumbnails.map((box) => box.w)) : 0

			let y = (h - stackH) / 2
			const boxes = [{ ...hero, x: 0, y: (h - HERO_HEIGHT) / 2 }]
			for (const thumbnail of thumbnails) {
				boxes.push({ ...thumbnail, x: hero.w + BOARD_GAP, y })
				y += thumbnail.h + BOARD_GAP
			}

			return { boxes, w: hero.w + (thumbnails.length ? BOARD_GAP + stackW : 0), h }
		},
	},
}
