// p2l-lab — the research-desk frame that auto-arranges its children
// (paper page, formula, experiments, charts), ported from the tldraw v5.5.0
// frame-layouts example: onChildrenChange recomputes the layout, drops and
// drags animate it, and only 'free' mode allows manual resize.
import {
  BaseFrameLikeShapeUtil,
  EASINGS,
  Editor,
  Group2d,
  HTMLContainer,
  RecordProps,
  Rectangle2d,
  T,
  TLShape,
  TLShapeId,
  TLShapePartial,
  TLDragShapesOutInfo,
  track,
  useEditor,
  useValue,
} from '@tldraw/tldraw'
import { BOARD_HEADER_HEIGHT, BOARD_LAYOUTS, BOARD_PADDING, type BoardLayoutMode } from './boardLayout'

declare module '@tldraw/tldraw' {
  export interface TLGlobalShapePropsMap {
    'p2l-lab': {
      w: number
      h: number
      name: string
      layout: BoardLayoutMode
    }
  }
}

export type LabFrameShape = TLShape<'p2l-lab'>

const EPSILON = 0.01

export class LabFrameShapeUtil extends BaseFrameLikeShapeUtil<LabFrameShape> {
  static override type = 'p2l-lab' as const
  static override props: RecordProps<LabFrameShape> = {
    w: T.nonZeroNumber,
    h: T.nonZeroNumber,
    name: T.string,
    layout: T.literalEnum('free', 'row', 'grid', 'spotlight'),
  }

  override getDefaultProps(): LabFrameShape['props'] {
    return { w: 320, h: 240, name: '研究桌面', layout: 'spotlight' }
  }

  override canReceiveNewChildrenOfType(shape: LabFrameShape, type: TLShape['type']) {
    if (shape.isLocked) return false
    return (
      type === 'p2l-paper' ||
      type === 'p2l-formula' ||
      type === 'p2l-experiment' ||
      type === 'p2l-chart' ||
      type === 'p2l-source'
    )
  }

  override canResize(shape: LabFrameShape) {
    return shape.props.layout === 'free'
  }

  override hideResizeHandles(shape: LabFrameShape) {
    return shape.props.layout !== 'free'
  }

  override canResizeChildren() {
    return false
  }

  override getGeometry(shape: LabFrameShape) {
    return new Group2d({
      children: [
        new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: false }),
        new Rectangle2d({ width: shape.props.w, height: BOARD_HEADER_HEIGHT, isFilled: true, isLabel: true }),
      ],
    })
  }

  override onChildrenChange(shape: LabFrameShape) {
    if (this.editor.isIn('select.translating')) return
    return getLabLayoutChanges(this.editor, shape)
  }

  override onDropShapesOver(shape: LabFrameShape) {
    animateLabLayout(this.editor, shape.id)
  }

  override onDragShapesOut(shape: LabFrameShape, shapes: TLShape[], info: TLDragShapesOutInfo) {
    super.onDragShapesOut(shape, shapes, info)
    animateLabLayout(this.editor, shape.id)
  }

  override component(shape: LabFrameShape) {
    return <LabFrameComponent shape={shape} />
  }

  override getText(shape: LabFrameShape) {
    return shape.props.name
  }

  override getIndicatorPath(shape: LabFrameShape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }
}

/** compute the layout changes for one frame (pure editor read → partials) */
export function getLabLayoutChanges(editor: Editor, frame: LabFrameShape): TLShapePartial[] {
  const children = editor
    .getSortedChildIdsForParent(frame.id)
    .map((id) => editor.getShape(id))
    .filter((child): child is TLShape => !!child)
    .map((child) => ({ child, size: editor.getShapeGeometry(child).bounds }))

  const byId = new Map(children.map((entry) => [entry.child.id, entry]))
  const originX = BOARD_PADDING
  const originY = BOARD_HEADER_HEIGHT + BOARD_PADDING

  const layout = BOARD_LAYOUTS[frame.props.layout]
  if (!layout || !layout.arrange) return []

  const result = layout.arrange(
    children.map(({ child, size }) => ({
      id: child.id,
      x: child.x - originX,
      y: child.y - originY,
      w: size.width,
      h: size.height,
    })),
  )
  if (!result) return []

  const changes: TLShapePartial[] = []
  for (const box of result.boxes) {
    const { child, size } = byId.get(box.id)!
    const x = originX + box.x
    const y = originY + box.y
    const moved = Math.abs(child.x - x) > EPSILON || Math.abs(child.y - y) > EPSILON
    const resized =
      Math.abs(size.width - box.w) > EPSILON || Math.abs(size.height - box.h) > EPSILON
    if (!moved && !resized) continue
    changes.push({
      id: child.id,
      type: child.type,
      x,
      y,
      ...(resized && { props: { w: box.w, h: box.h } }),
    } as TLShapePartial)
  }

  if (
    Math.abs(frame.props.w - result.w - 2 * BOARD_PADDING) > EPSILON ||
    Math.abs(frame.props.h - result.h - BOARD_HEADER_HEIGHT - BOARD_PADDING * 2) > EPSILON
  ) {
    changes.push({
      id: frame.id,
      type: frame.type,
      props: { w: result.w + 2 * BOARD_PADDING, h: result.h + BOARD_HEADER_HEIGHT + BOARD_PADDING * 2 },
    })
  }

  return changes
}

export function applyLabLayout(editor: Editor, frameId: TLShapeId) {
  const frame = editor.getShape(frameId) as LabFrameShape | undefined
  if (frame) editor.updateShapes(getLabLayoutChanges(editor, frame))
}

export function animateLabLayout(editor: Editor, frameId: TLShapeId) {
  const frame = editor.getShape(frameId) as LabFrameShape | undefined
  if (!frame) return
  editor.animateShapes(getLabLayoutChanges(editor, frame), {
    animation: { duration: 220, easing: EASINGS.easeInOutCubic },
  })
}

const LabFrameComponent = track(function LabFrameComponent({ shape }: { shape: LabFrameShape }) {
  const editor = useEditor()
  const count = useValue('lab child count', () => editor.getSortedChildIdsForParent(shape.id).length, [editor, shape.id])
  return (
    <HTMLContainer className="lab-frame" style={{ width: shape.props.w, height: shape.props.h }}>
      <div className="lab-frame__header" style={{ height: BOARD_HEADER_HEIGHT }} onPointerDown={(e) => e.stopPropagation()}>
        <span className="lab-frame__name">{shape.props.name}</span>
        <span className="lab-frame__badge">
          {BOARD_LAYOUTS[shape.props.layout].label} · {count}
        </span>
        <span className="lab-frame__modes" style={{ display: 'flex', gap: 4 }}>
          {(['free', 'row', 'grid', 'spotlight'] as BoardLayoutMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`lab-frame__mode${shape.props.layout === mode ? ' is-active' : ''}`}
              data-layout-mode={mode}
              onClick={() => {
                editor.updateShape({ id: shape.id, type: 'p2l-lab', props: { layout: mode } })
                // layout re-runs through onChildrenChange; force it for mode
                // switches where children did not move between the two modes
                const frame = editor.getShape(shape.id) as LabFrameShape | undefined
                if (frame) editor.updateShapes(getLabLayoutChanges(editor, frame))
              }}
            >
              {BOARD_LAYOUTS[mode].label}
            </button>
          ))}
        </span>
      </div>
    </HTMLContainer>
  )
})
