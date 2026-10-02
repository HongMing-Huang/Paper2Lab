#!/usr/bin/env node
// Headless WebGL render evidence for the Kakeya 3D scene (no window, no GUI).
//
//   node scripts/render-webgl-test.mjs
//
// Serves the built dist/ statically, launches system Chrome headless with
// SwiftShader (CPU WebGL), loads #render-test — the REAL runtime + Tubes3DView
// — and asserts:
//   1. WebGL context actually created (not a blank fallback)
//   2. non-empty frame: canvas pixels are not uniform
//   3. parameter change → pixel change: packing 0 vs 1 renders differently
//   4. drag reverse-write: synthetic pointer drag on the scene updates the
//      kakeya.packing runtime parameter (UI⇄model)
// Exit code 0 = all evidence green.
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from 'playwright-core'

const DIST = new URL('../dist/', import.meta.url).pathname
const PORT = 8923
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
}

function serve() {
  const server = createServer(async (req, res) => {
    try {
      let path = req.url?.split('?')[0] ?? '/'
      if (path === '/') path = '/index.html'
      const file = join(DIST, path)
      const st = await stat(file)
      if (!st.isFile()) throw new Error('not a file')
      const buf = await readFile(file)
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
      res.end(buf)
    } catch {
      res.writeHead(404).end()
    }
  })
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)))
}

function pixelStats(buffer) {
  // PNG bytes → crude liveness stats over raw bytes is unreliable; instead we
  // compare screenshot buffers directly (identity) and hash-diff ratio.
  return buffer
}

async function main() {
  const server = await serve()
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-gpu-sandbox'],
  })
  const page = await browser.newPage({ viewport: { width: 720, height: 560 } })
  const failures = []
  try {
    await page.goto(`http://127.0.0.1:${PORT}/#render-test`, { waitUntil: 'networkidle' })

    // 0. WebGL context exists
    const webgl = await page.evaluate(() => {
      const c = document.createElement('canvas')
      const gl = c.getContext('webgl2') ?? c.getContext('webgl')
      return gl ? gl.getParameter(gl.VERSION) : null
    })
    console.log(`webgl: ${webgl}`)
    if (!webgl) failures.push('no WebGL context (SwiftShader missing?)')

    // wait for the real runtime to produce tubes
    await page.waitForFunction(() => window.__renderTest?.ready === true, null, { timeout: 30000 })
    const tubes0 = await page.evaluate(() => window.__renderTest.tubeCount())
    const runId0 = await page.evaluate(() => window.__renderTest.tubesRunId())
    console.log(`tubes: ${tubes0}, geometry run: ${runId0}`)
    if (!tubes0 || !runId0) failures.push('runtime produced no tube geometry')

    // settle a few frames with spin=0 (deterministic orientation)
    await page.waitForTimeout(1200)

    const canvasLoc = page.locator('.tubes3d canvas').first()
    await canvasLoc.waitFor({ state: 'visible', timeout: 15000 })

    // 1+2. non-empty frame
    const shot0 = await canvasLoc.screenshot()
    const uniform = await page.evaluate(() => {
      const c = document.querySelector('.tubes3d canvas')
      const gl = c.getContext('webgl2') ?? c.getContext('webgl')
      if (!gl) return null
      const w = 120, h = 80
      const px = new Uint8Array(w * h * 4)
      gl.readPixels(Math.floor(gl.drawingBufferWidth / 2 - w / 2), Math.floor(gl.drawingBufferHeight / 2 - h / 2), w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
      let sum = 0, sumSq = 0
      for (let i = 0; i < px.length; i += 4) {
        const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
        sum += lum; sumSq += lum * lum
      }
      const n = px.length / 4
      const mean = sum / n
      return { mean, std: Math.sqrt(Math.max(0, sumSq / n - mean * mean)), sample: px.slice(0, 16) }
    })
    console.log(`readPixels: mean=${uniform?.mean?.toFixed(1)} std=${uniform?.std?.toFixed(1)}`)
    if (!uniform || uniform.std < 3) failures.push(`frame looks empty (std=${uniform?.std})`)

    // 3. parameter change → pixel change
    await page.evaluate(() => window.__renderTest.setPacking(1))
    await page.waitForFunction(() => window.__renderTest.getPacking() === 1)
    await page.waitForTimeout(1500) // geometry cell recompute + settle
    const runId1 = await page.evaluate(() => window.__renderTest.tubesRunId())
    console.log(`packing=1 geometry run: ${runId1}`)
    if (runId1 === runId0) failures.push('packing change did not produce a new geometry run')
    const shot1 = await canvasLoc.screenshot()
    const same = shot0.equals(shot1)
    const size0 = shot0.length, size1 = shot1.length
    console.log(`screenshots: shot0=${size0}B shot1=${size1}B identical=${same}`)
    if (same) failures.push('canvas pixels did not change after packing 0→1')

    // 4. drag reverse-write: reset packing away from the ceiling first
    await page.evaluate(() => window.__renderTest.setPacking(0.2))
    await page.waitForFunction(() => window.__renderTest.getPacking() === 0.2)
    await page.waitForTimeout(600)
    const before = await page.evaluate(() => window.__renderTest.getPacking())
    const box = await canvasLoc.boundingBox()
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    // drag up (clientY decreases ⇒ packing increases per UI⇄model contract)
    for (let i = 1; i <= 7; i++) {
      await page.mouse.move(cx, cy - i * 12, { steps: 1 })
      await page.waitForTimeout(30)
    }
    await page.mouse.up()
    await page.waitForTimeout(300)
    const after = await page.evaluate(() => window.__renderTest.getPacking())
    console.log(`drag write-back: packing ${before} → ${after}`)
    if (after === before) failures.push('scene drag did not write back to kakeya.packing')

    // console errors?
    const errors = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  } catch (err) {
    failures.push(`harness error: ${err?.message ?? err}`)
  } finally {
    await browser.close()
    server.close()
  }

  if (failures.length) {
    console.error('\nFAIL:\n' + failures.map((f) => `  ✗ ${f}`).join('\n'))
    process.exit(1)
  }
  console.log('\nPASS: non-empty WebGL frame · packing→pixel change · drag→param reverse write')
}
main()
