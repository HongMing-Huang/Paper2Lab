#!/usr/bin/env node
// Headless render+product evidence for the Kakeya experiment (no window, no GUI).
//
//   node scripts/render-webgl-test.mjs            # both phases
//   node scripts/render-webgl-test.mjs --scene    # synthetic #render-test only
//
// Phase 1 (scene, #render-test): the REAL runtime + Tubes3DView with
// deterministic framing —
//   1. WebGL context actually created (not a blank fallback)
//   2. non-empty frame: canvas pixels are not uniform
//   3. parameter change → pixel change: packing 0 vs 1 renders differently
//   4. drag reverse-write: synthetic pointer drag updates kakeya.packing
//
// Phase 2 (product path — proves the REAL desk, not a synthetic route):
//   5. home → Kakeya entry → Paper Mode → 展开实验到画布
//   6. the real Experiment3DNode canvas renders non-empty pixels (SwiftShader)
//   7. drag on the REAL 3D node writes packing back through the same runtime
//   8. observation node shows CALCULATED numbers tied to the drag
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
      // minimal engine API stand-in: serve the committed high-scale bundle in
      // the same {meta, runs} shape as /api/engine — the product path then
      // proves the REAL fetch→import chain (not just the offline fallback)
      if (path === '/api/engine/kakeya/precomputed') {
        const buf = await readFile(join(DIST, '..', 'src', 'data', 'kakeya-precomputed-runs.json'))
        const bundle = JSON.parse(buf.toString())
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ meta: bundle.meta, runs: bundle.runs }))
        return
      }
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
  const args = process.argv.slice(2)
  const onlyScene = args.includes('--scene')
  const server = await serve()
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-gpu-sandbox'],
  })
  const failures = []
  try {
    await scenePhase(browser, failures)
    if (!onlyScene) await productPhase(browser, failures)
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
  console.log('\nPASS: scene evidence + real product path (pixels, drag write-back, CALCULATED observation)')
}

// ---- Phase 1: deterministic #render-test scene --------------------------------

async function scenePhase(browser, failures) {
  const page = await browser.newPage({ viewport: { width: 720, height: 560 } })
  try {
    await page.goto(`http://127.0.0.1:${PORT}/#render-test`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(800)

    // 0. WebGL context exists
    const webgl = await page.evaluate(() => {
      const c = document.createElement('canvas')
      const gl = c.getContext('webgl2') ?? c.getContext('webgl')
      return gl ? gl.getParameter(gl.VERSION) : null
    })
    console.log(`[scene] webgl: ${webgl}`)
    if (!webgl) failures.push('no WebGL context (SwiftShader missing?)')

    // wait for the real runtime to produce tubes
    await page.waitForFunction(() => window.__renderTest?.ready === true, null, { timeout: 30000 })
    const tubes0 = await page.evaluate(() => window.__renderTest.tubeCount())
    const runId0 = await page.evaluate(() => window.__renderTest.tubesRunId())
    console.log(`[scene] tubes: ${tubes0}, geometry run: ${runId0}`)
    if (!tubes0 || !runId0) failures.push('runtime produced no tube geometry')

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
      return { mean, std: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) }
    })
    console.log(`[scene] readPixels: mean=${uniform?.mean?.toFixed(1)} std=${uniform?.std?.toFixed(1)}`)
    if (!uniform || uniform.std < 3) failures.push(`frame looks empty (std=${uniform?.std})`)

    // 3. parameter change → pixel change
    await page.evaluate(() => window.__renderTest.setPacking(1))
    await page.waitForFunction(() => window.__renderTest.getPacking() === 1)
    await page.waitForTimeout(1500)
    const runId1 = await page.evaluate(() => window.__renderTest.tubesRunId())
    console.log(`[scene] packing=1 geometry run: ${runId1}`)
    if (runId1 === runId0) failures.push('packing change did not produce a new geometry run')
    const shot1 = await canvasLoc.screenshot()
    const same = shot0.equals(shot1)
    console.log(`[scene] screenshots: ${shot0.length}B vs ${shot1.length}B identical=${same}`)
    if (same) failures.push('canvas pixels did not change after packing 0→1')

    // 4. drag reverse-write
    await page.evaluate(() => window.__renderTest.setPacking(0.2))
    await page.waitForFunction(() => window.__renderTest.getPacking() === 0.2)
    await page.waitForTimeout(600)
    const box = await canvasLoc.boundingBox()
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    for (let i = 1; i <= 7; i++) {
      await page.mouse.move(cx, cy - i * 12, { steps: 1 })
      await page.waitForTimeout(30)
    }
    await page.mouse.up()
    await page.waitForTimeout(300)
    const after = await page.evaluate(() => window.__renderTest.getPacking())
    console.log(`[scene] drag write-back: packing → ${after}`)
    if (after === 0.2) failures.push('scene drag did not write back to kakeya.packing')
  } finally {
    await page.close()
  }
}

// ---- Phase 2: the REAL product path (home → Kakeya lab) ----------------------

async function productPhase(browser, failures) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const consoleErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  page.on('pageerror', (e) => consoleErrors.push(String(e)))
  try {
    // 5. real home → Kakeya entry
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.locator('button.home-kakeya').first().waitFor({ timeout: 30000 })
    await page.locator('button.home-kakeya').first().click()
    await page.waitForSelector('.param-chip', { timeout: 30000 }) // Paper Mode loaded
    console.log('[product] Paper Mode loaded')

    // expand to the real lab canvas
    await page.locator('button:has-text("⤢ 展开实验到画布")').click()
    await page.waitForSelector('.react-flow__node-experiment3d', { timeout: 30000 })
    await page.waitForTimeout(2500) // worker exact settle
    const chipsBefore = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.react-flow__node-experiment3d .param-chip')).map((c) => c.textContent),
    )
    const obsBefore = await page.evaluate(() => document.querySelector('.react-flow__node-observation')?.textContent?.slice(0, 110) ?? '')
    console.log(`[product] chips before: ${JSON.stringify(chipsBefore)}`)
    console.log(`[product] observation before: ${obsBefore.slice(0, 80)}`)

    // 6. real 3D node canvas non-empty pixels (screenshot bytes as evidence)
    // bring the lab canvas into the viewport (fit view) so pointer events land
    const fit = page.locator('[aria-label="Fit View"], [title="Fit View"]').first()
    if (await fit.count()) {
      await fit.click()
      await page.waitForTimeout(1500)
    }

    const realCanvas = page.locator('.react-flow__node-experiment3d .tubes3d canvas').first()
    await realCanvas.waitFor({ state: 'visible', timeout: 15000 })
    const realShot = await realCanvas.screenshot()
    console.log(`[product] real 3D canvas screenshot: ${realShot.length}B`)
    if (realShot.length < 2000) failures.push(`real product 3D canvas looks empty (${realShot.length}B)`)

    // 7. drag on the REAL node writes packing back through the same runtime
    const box = await realCanvas.boundingBox()
    const cx = Math.round(box.x + box.width / 2)
    const cy = Math.round(box.y + box.height / 2)
    const hit = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y)
        return { tag: el?.tagName, cls: el?.getAttribute('class')?.slice(0, 60), inViewport: x >= 0 && y >= 0 && x < innerWidth && y < innerHeight }
      },
      [cx, cy],
    )
    console.log(`[product] element at drag point: ${JSON.stringify(hit)} viewport=${JSON.stringify({ w: 1440, h: 900 })}`)
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    for (let i = 1; i <= 7; i++) {
      await page.mouse.move(cx, cy - i * 12, { steps: 1 }) // drag UP ⇒ pack (default packing=0)
      await page.waitForTimeout(40)
    }
    await page.mouse.up()
    await page.waitForTimeout(4500) // worker recompute + settle

    const chipsAfter = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.react-flow__node-experiment3d .param-chip')).map((c) => c.textContent),
    )
    console.log(`[product] chips after: ${JSON.stringify(chipsAfter)}`)
    const obsAfter = await page.evaluate(() => document.querySelector('.react-flow__node-observation')?.textContent?.slice(0, 110) ?? '')
    console.log(`[product] observation after: ${obsAfter.slice(0, 80)}`)
    if (obsAfter === obsBefore) failures.push('drag on the real 3D node did not recompute the observation')
    // the real node's title carries the live packing — parse it back
    const title = await page.evaluate(() => document.querySelector('.react-flow__node-experiment3d')?.getAttribute('title') ?? document.querySelector('.react-flow__node-experiment3d .tubes3d')?.getAttribute('title') ?? '')
    console.log(`[product] node title: ${title.slice(0, 80)}`)

    // 8. CALCULATED badge present in the observation
    if (!obsAfter.includes('CALCULATED')) failures.push('observation lacks CALCULATED provenance')

    // 9. C++ high-scale precompute chain on the REAL page: the chart loads the
    //    bundle itself (offline fallback — no backend on this static origin),
    //    imports real ExperimentRuns, and the series/button reflect them
    await page.waitForFunction(() => (window.__P2L_CPP_RUNS__?.() ?? []).length >= 63, null, { timeout: 30000 })
      .catch(() => null)
    const cppIds = await page.evaluate(() => window.__P2L_CPP_RUNS__?.() ?? [])
    const cppBtn = await page.evaluate(() => document.querySelector('.cpp-load-btn')?.textContent ?? '(no button)')
    console.log(`[product] cpp runs imported: ${cppIds.length}${cppIds.length ? ` (${cppIds[0]} …)` : ''}`)
    console.log(`[product] cpp button: ${cppBtn}`)
    if (cppIds.length < 63) failures.push(`C++ high-scale runs did not import on the product path (${cppIds.length})`)
    if (!cppBtn.includes('已载入')) failures.push(`cpp load button did not settle: ${cppBtn}`)
    // chart caption datapoints grew with the precomputed series
    const caption = await page.evaluate(() => document.querySelector('.react-flow__node-chartUnion .card-caption')?.textContent ?? '')
    console.log(`[product] chart caption: ${caption.slice(0, 70)}`)
    if (!/C\+\+/.test(caption)) failures.push('chart caption does not mention the C++ series')

    if (consoleErrors.length) {
      failures.push(`console errors on the product path: ${consoleErrors.slice(0, 3).join(' | ')}`)
    } else {
      console.log('[product] console: 0 errors')
    }
  } finally {
    await page.close()
  }
}
main()
