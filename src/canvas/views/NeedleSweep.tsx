// Act 1 of the Kakeya paper: a unit needle rotating and leaving a swept
// region. The swept area is MEASURED (rasterised coverage grid), not quoted.
import { useEffect, useRef, useState } from 'react'

const GRID = 96 // coverage grid resolution (unit box is [-0.75, 0.75]²)
const BOX = 1.5 // demo configuration: world span
const NEEDLE_HALF = 0.25 // demo configuration: needle half-length in frame

export { GRID, BOX, NEEDLE_HALF }

export function NeedleSweep({
  size = 260,
  speed = 0.35,
  needleRadius = 0.012,
}: {
  size?: number
  speed?: number
  needleRadius?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gridRef = useRef<Uint8Array>(new Uint8Array(GRID * GRID))
  const angleRef = useRef(0)
  const [swept, setSwept] = useState(0)
  const [running, setRunning] = useState(true)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const grid = gridRef.current
    const box = BOX
    const toPx = (w: number) => ((w + box / 2) / box) * size
    const half = NEEDLE_HALF

    let raf = 0
    let last = performance.now()
    let acc = 0

    const rasterSegment = (ax: number, ay: number, bx: number, by: number) => {
      const r = needleRadius
      const cell = box / GRID
      const i0 = Math.max(0, Math.floor(((Math.min(ax, bx) - r) + box / 2) / cell))
      const i1 = Math.min(GRID - 1, Math.ceil(((Math.max(ax, bx) + r) + box / 2) / cell))
      const j0 = Math.max(0, Math.floor(((Math.min(ay, by) - r) + box / 2) / cell))
      const j1 = Math.min(GRID - 1, Math.ceil(((Math.max(ay, by) + r) + box / 2) / cell))
      const dx = bx - ax
      const dy = by - ay
      const len2 = dx * dx + dy * dy || 1e-12
      for (let i = i0; i <= i1; i++) {
        const wx = (i + 0.5) * cell - box / 2
        for (let j = j0; j <= j1; j++) {
          const wy = (j + 0.5) * cell - box / 2
          let t = ((wx - ax) * dx + (wy - ay) * dy) / len2
          t = Math.max(0, Math.min(1, t))
          const qx = wx - (ax + t * dx)
          const qy = wy - (ay + t * dy)
          if (qx * qx + qy * qy <= r * r) grid[j * GRID + i] = 1
        }
      }
    }

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const prev = angleRef.current
      angleRef.current += running ? speed * dt : 0
      const a = angleRef.current
      // Lane D: the needle spans −half→+half (see the draw call below) — the
      // measured sweep must cover the WHOLE needle's motion, not just the tip
      // chord. Raster the full needle at intermediate angles between frames;
      // the swept sector is then what the counter actually counts.
      if (running) {
        const SUB = 6
        for (let s = 0; s <= SUB; s++) {
          const ang = prev + ((a - prev) * s) / SUB
          const c = Math.cos(ang) * half
          const si = Math.sin(ang) * half
          rasterSegment(-c, -si, c, si)
        }
      }

      // draw
      ctx.clearRect(0, 0, size, size)
      // swept region: grid cells covered so far
      ctx.fillStyle = 'rgba(47, 93, 138, 0.16)'
      const cell = size / GRID
      for (let i = 0; i < GRID; i++) {
        for (let j = 0; j < GRID; j++) {
          if (grid[j * GRID + i]) ctx.fillRect(i * cell, j * cell, cell + 0.5, cell + 0.5)
        }
      }
      // frame box
      ctx.strokeStyle = 'rgba(107, 97, 84, 0.35)'
      ctx.strokeRect(0.5, 0.5, size - 1, size - 1)
      // needle
      ctx.strokeStyle = '#9a3b2e'
      ctx.lineWidth = 2.4
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(toPx(-Math.cos(a) * half), toPx(-Math.sin(a) * half))
      ctx.lineTo(toPx(Math.cos(a) * half), toPx(Math.sin(a) * half))
      ctx.stroke()

      acc += dt
      if (acc > 0.25) {
        acc = 0
        let count = 0
        for (let k = 0; k < grid.length; k++) count += grid[k]
        setSwept((count / grid.length) * box * box)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [size, speed, running, needleRadius])

  return (
    <div className="needle-sweep nodrag nowheel">
      <canvas ref={canvasRef} style={{ width: size, height: size }} />
      <div className="needle-sweep-bar">
        <button type="button" className="toggle" onClick={() => setRunning((r) => !r)}>
          {running ? '⏸ 暂停' : '▶ 旋转'}
        </button>
        <button
          type="button"
          className="toggle"
          onClick={() => {
            gridRef.current.fill(0)
            angleRef.current = 0
          }}
        >
          ↺ 重置
        </button>
        <span className="needle-metric">
          swept 面积（栅格实测）= <strong>{swept.toFixed(4)}</strong> / {(BOX * BOX).toFixed(2)}
        </span>
      </div>
    </div>
  )
}
