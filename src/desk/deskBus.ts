// Desk event bus: shape-local UI (chips, buttons) emits intents; the PaperDesk
// component owns the editor and turns intents into shape growth/camera moves.
export type DeskEvent =
  | { kind: 'marker-click'; anchorId: string }
  | { kind: 'play'; anchorId: string }
  | { kind: 'fork'; explorerId: string; anchorId: string }
  | { kind: 'compare' }
  | { kind: 'source'; anchorId: string }
  | { kind: 'goto-kakeya' }

type Handler = (e: DeskEvent) => void

const handlers = new Set<Handler>()

export const deskBus = {
  emit(e: DeskEvent) {
    for (const h of handlers) h(e)
  },
  subscribe(h: Handler) {
    handlers.add(h)
    return () => handlers.delete(h)
  },
}
