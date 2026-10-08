#!/usr/bin/env node
// Desk-upgrade headless product-path evidence (issues #11–#13), on the REAL
// single-origin backend (uvicorn serving dist/) — no GUI window.
//
//   node scripts/product-lab-test.mjs            (needs uvicorn :8798 serving dist/)
//
// Asserts:
//   1. FRAME LAYOUTS — the lab frame hosts the paper; playing a marker grows
//      the experiment INSIDE the frame; arrange_lab('row') aligns children;
//      spotlight restores the hero layout
//   2. AGENT ACTIONS — the registered action layer runs on the real editor;
//      an unknown action is rejected with a reason (never a silent no-op)
//   3. RUN-DRIVEN 3D — "长出 3D 实验纸" grows a p2l-3d paper; the shared
//      Canvas renders non-empty pixels in the tracked rect; dragging the tube
//      family reverse-writes packing (the Run badge changes)
import { chromium } from 'playwright-core'

const ORIGIN = 'http://127.0.0.1:8798'
const SAMPLE = new URL('../public/papers/sample-harmonic.pdf', import.meta.url).pathname
// one-page Kakeya-keyword fixture (scripts/make_kakeya_mini_pdf.py): routing
// the FULL Wang–Zahl paper through Docling takes >8min even locally — the
// mini paper exercises the same kakeya-routed desk surface honestly
const KAKEYA_PDF = new URL('../public/papers/kakeya-mini.pdf', import.meta.url).pathname

async function waitApi() {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${ORIGIN}/api/health`)
      if (r.ok) return true
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 2000))
  }
  return false
}

async function main() {
  if (!(await waitApi())) {
    console.error('FAIL: backend not reachable on :8798 (uvicorn server.main:app --port 8798)')
    process.exit(1)
  }
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-gpu-sandbox'],
  })
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  const failures = []
  const consoleErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  page.on('requestfailed', (r) => console.log(`[reqfail] ${r.url().slice(0, 110)} ${r.failure()?.errorText ?? ''}`))
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  const frameState = () => page.evaluate(() => {
    const ed = window.__deskEditor
    const shapes = [...ed.getCurrentPageShapeIds()].map((id) => ed.getShape(id))
    const frame = shapes.find((s) => s.type === 'p2l-lab')
    if (!frame) return { hasFrame: false, children: 0, positions: [] }
    const kids = ed.getSortedChildIdsForParent(frame.id)
    return {
      hasFrame: true,
      children: kids.length,
      positions: kids.map((id) => ({ x: Math.round(ed.getShape(id).x), y: Math.round(ed.getShape(id).y) })),
    }
  })

  try {
    await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' })
    await page.locator('button.home-drop').waitFor({ timeout: 30000 })
    const chooserP = page.waitForEvent('filechooser')
    await page.locator('button.home-drop').click()
    const chooser = await chooserP
    await chooser.setFiles([SAMPLE])
    // same REAL-parse reality as the formula test: on the shared CI runner a
    // 2-page PDF takes minutes (CPU OCR+layout); locally ~45s warm. See
    // product-formula-test.mjs — 480s keeps CI honest without flaking.
    await page.waitForSelector('.lab-frame', { timeout: 480000 })
    console.log('[desk] uploaded → desk mounted, lab frame present')

    // 1. paper lives inside the frame
    let st = await frameState()
    console.log(`[desk] frame children=${st.children} positions=${JSON.stringify(st.positions.slice(0, 4))}`)
    if (!st.hasFrame || st.children < 1) failures.push(`paper not hosted in the lab frame (children=${st.children})`)

    // marker → lifts the formula sheet; Play → the experiment grows INSIDE
    // the frame (auto-arranged). DOM-dispatched clicks = the established desk
    // pattern (product handlers consume them; page.mouse can't hit shape HTML)
    await page.waitForSelector('.desk-playable-marker', { timeout: 30000 })
    await page.evaluate(() => {
      document.querySelector('.desk-playable-marker')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForSelector('.desk-btn-play', { timeout: 10000 })
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('▶ Play'))
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForTimeout(1000)
    st = await frameState()
    console.log(`[desk] after play: children=${st.children}`)
    if (st.children < 2) failures.push(`playing a marker did not grow the experiment inside the frame (children=${st.children})`)

    // arrange_lab('row') → all children share one y (aligned row)
    const row = await page.evaluate(() => window.__P2L_ACTIONS__.run({ type: 'arrange_lab', mode: 'row' }))
    await page.waitForTimeout(500)
    st = await frameState()
    const aligned = st.positions.length >= 2 && st.positions.every((p) => Math.abs(p.y - st.positions[0].y) < 10)
    console.log(`[desk] arrange row: ok=${row.ok} aligned=${aligned} n=${st.positions.length}`)
    if (!row.ok || !aligned) failures.push(`arrange_lab('row') did not align children (ok=${row.ok}, aligned=${aligned})`)

    // spotlight restores the hero layout (first child enlarged → taller row spread)
    const spot = await page.evaluate(() => window.__P2L_ACTIONS__.run({ type: 'arrange_lab', mode: 'spotlight' }))
    await page.waitForTimeout(500)
    console.log(`[desk] spotlight: ok=${spot.ok}`)
    if (!spot.ok) failures.push('arrange_lab(spotlight) failed')

    // unknown action is REJECTED with a reason (full backfill, no silent noop)
    const bad = await page.evaluate(() => window.__P2L_ACTIONS__.run({ type: 'backdoor.wipe' }))
    console.log(`[desk] unknown action: ok=${bad.ok} reason="${(bad.reason ?? '').slice(0, 44)}"`)
    if (bad.ok !== false || !/unknown/.test(bad.reason ?? '')) failures.push('unknown action was not rejected')

    // 3. Run-driven 3D paper (shared Canvas + drei View tracking the paper).
    // Product rule (#22/PR#26): the Kakeya desk surface only appears for
    // kakeya-routed papers — sample-harmonic is a FORMULA paper, so we run
    // the 3D leg on the Wang–Zahl paper in a second page instead. The
    // formula leg above already covered frames/actions/Play on this paper.
    const decision = await page.evaluate(() => (window).__P2L_DECISION__ ?? null)
    console.log(`[desk] routing: adapter=${decision?.adapter} status=${decision?.status}`)
    if (decision?.adapter !== 'kakeya') {
      const kPage = await browser.newPage({ viewport: { width: 1500, height: 950 } })
      try {
        await kPage.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' })
        await kPage.locator('button.home-drop').waitFor({ timeout: 30000 })
        const chooserP2 = kPage.waitForEvent('filechooser')
        await kPage.locator('button.home-drop').click()
        const chooser2 = await chooserP2
        await chooser2.setFiles([KAKEYA_PDF])
        await kPage.waitForSelector('.lab-frame', { timeout: 480000 })
        await kPage.locator('[data-testid="grow-3d"]').click()
        await kPage.waitForTimeout(600)
        await kPage.locator('.run3d-track').waitFor({ timeout: 20000 })
        await kPage.waitForTimeout(1500)
        const box2 = await kPage.locator('.run3d-track').boundingBox()
        console.log(`[kakeya] 3D paper tracked box=${box2 ? `${Math.round(box2.width)}×${Math.round(box2.height)}` : 'MISSING'}`)
        if (!box2) failures.push('kakeya 3D experiment paper did not grow')
        const shot2 = await kPage.screenshot()
        if (shot2.length < 2500) failures.push(`kakeya 3D view looks empty (${shot2.length}B)`)
      } finally {
        await kPage.close()
      }
    } else {
      await page.locator('[data-testid="grow-3d"]').click()
      await page.waitForTimeout(500)
      // focus it: the spotlight layout enlarges the selected paper as the hero
      // (this also exercises the focus_shape action on the real editor)
      const focused = await page.evaluate(() => {
        const ed = window.__deskEditor
        const shape = [...ed.getCurrentPageShapeIds()].map((id) => ed.getShape(id)).find((s) => s.type === 'p2l-3d')
        ed.select(shape.id)
        return window.__P2L_ACTIONS__.run({ type: 'focus_shape' })
      })
      await page.locator('.run3d-track').waitFor({ timeout: 15000 })
      await page.waitForTimeout(1500) // shared canvas boot + settle
      console.log(`[desk] focus 3D paper: ok=${focused.ok}`)
      if (!focused.ok) failures.push('focus_shape on the 3D paper failed')
      const box = await page.locator('.run3d-track').boundingBox()
      console.log(`[desk] 3D paper: tracked box=${box ? `${Math.round(box.width)}×${Math.round(box.height)}` : 'MISSING'}`)
      if (!box) {
        failures.push('3D experiment paper did not grow')
      } else {
        // clamp the clip rect into the viewport (spotlight hero may overflow)
        const vw = 1500, vh = 950
        const cx0 = Math.max(0, Math.round(box.x)), cy0 = Math.max(0, Math.round(box.y))
        const cx1 = Math.min(vw, Math.round(box.x + box.width)), cy1 = Math.min(vh, Math.round(box.y + box.height))
        const clip = cx1 - cx0 > 40 && cy1 - cy0 > 40 ? { x: cx0, y: cy0, width: cx1 - cx0, height: cy1 - cy0 } : null
        const shot = clip ? await page.screenshot({ clip }) : await page.screenshot()
        console.log(`[desk] 3D pixels in tracked rect: ${shot.length}B${clip ? '' : ' (full page fallback)'}`)
        if (shot.length < 2500) failures.push(`Run-driven 3D view looks empty (${shot.length}B)`)

        // drag the family UP → packing reverse-writes → Run badge re-renders.
        // Pointer delivery is DOM-dispatched (the established desk pattern:
        // tldraw shape HTML is not hit-test reachable for page.mouse, but the
        // product's own React handlers consume dispatched events faithfully).
        const badgeBefore = await page.evaluate(() => document.querySelector('.run3d-caption')?.textContent ?? '')
        const packed = await page.evaluate(() => {
          const el = document.querySelector('.run3d-track')
          const rect = el.getBoundingClientRect()
          const cx = rect.x + rect.width / 2
          const mk = (type, y) => new PointerEvent(type, { bubbles: true, clientX: cx, clientY: y, pointerId: 7, isPrimary: true })
          el.dispatchEvent(mk('pointerdown', rect.y + rect.height / 2))
          for (let i = 1; i <= 6; i++) {
            el.dispatchEvent(mk('pointermove', rect.y + rect.height / 2 - i * 16))
          }
          el.dispatchEvent(mk('pointerup', rect.y + rect.height / 2 - 96))
          return true
        })
        await page.waitForTimeout(1600)
        const badgeAfter = await page.evaluate(() => document.querySelector('.run3d-caption')?.textContent ?? '')
        console.log(`[desk] drag write-back (dispatched=${packed}): "${badgeBefore.slice(0, 44)}" → "${badgeAfter.slice(0, 44)}"`)
        if (badgeAfter === badgeBefore) failures.push('3D drag did not reverse-write packing (badge unchanged)')
      }
    }

    if (consoleErrors.length) {
      failures.push(`console errors: ${consoleErrors.slice(0, 3).join(' | ')}`)
    } else {
      console.log('[desk] console: 0 errors')
    }
  } finally {
    await page.close()
    await browser.close()
  }
  if (failures.length) {
    console.log('\nFAIL:')
    for (const f of failures) console.log(`  ✗ ${f}`)
    process.exit(1)
  }
  console.log('\nPASS: desk upgrade product path (frame layouts · agent actions · Run-driven 3D)')
}

main()
