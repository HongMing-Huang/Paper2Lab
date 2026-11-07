#!/usr/bin/env node
// M7 headless product-path evidence: multi-formula selection + multi-page
// paper on the REAL desk (no GUI window, no synthetic routes).
//
//   node scripts/product-formula-test.mjs      (needs uvicorn :8787 serving dist/)
//
// Asserts:
//   1. TWO Playable markers appear (both formulas on page 1 are plottable)
//   2. clicking marker #2 (damped u(t)=e^{-t}cos(ωt)) plays THAT formula
//   3. page pager 1/2 exists; turning to page 2 changes the paper pixels
//      and page 2 carries no formula markers
// Exit 0 = all evidence green.
import { chromium } from 'playwright-core'

const ORIGIN = 'http://127.0.0.1:8787'
const SAMPLE = new URL('../public/papers/sample-harmonic.pdf', import.meta.url).pathname

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
    console.error('FAIL: backend not reachable on :8787 (uvicorn server.main:app --port 8787)')
    process.exit(1)
  }
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  })
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  const failures = []
  const consoleErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  page.on('pageerror', (e) => consoleErrors.push(String(e)))
  try {
    // upload the real PDF through the real home dropzone (single origin)
    await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' })
    await page.locator('button.home-drop').waitFor({ timeout: 30000 })
    // this test asserts the 精读 (Docling) path — the home default is now the
    // VLM fast path, which (correctly) errors in CI without a provider
    await page.locator('[data-testid="parse-mode"] button').filter({ hasText: '精读定位' }).click()
    const chooserP = page.waitForEvent('filechooser')
    await page.locator('button.home-drop').click()
    const chooser = await chooserP
    await chooser.setFiles([SAMPLE])
    // CLI-151: a dropped PDF opens the paper study space first; the full
    // parse → experiment desk is its explicit action
    await page.getByTestId('study-full-parse').click()
    // REAL Docling parse on the shared CI runner takes >180s (2-page PDF,
    // CPU OCR+layout); locally ~45s warm. 480s keeps CI honest without
    // flaking — the pipeline is genuine compute, not a mocked instant.
    await page.waitForSelector('.desk-playable-marker', { timeout: 480000 })

    // 1. TWO Playable markers on page 1
    const markers = page.locator('.desk-playable-marker')
    const count = await markers.count()
    console.log(`[m7] Playable markers on page 1: ${count}`)
    if (count !== 2) failures.push(`expected 2 Playable markers (both formulas), got ${count}`)

    // 2. play the SECOND formula (damped) and verify it is NOT the sine
    // (markers can sit outside the auto-fit viewport; DOM click is faithful —
    // the handler is the product's own onClick)
    await page.evaluate(() => {
      const markers = Array.from(document.querySelectorAll('.desk-playable-marker'))
      markers[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForTimeout(700)
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('▶ Play'))
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForSelector('.desk-sheet-experiment', { timeout: 20000 })
    await page.waitForTimeout(2500)
    const exp = await page.evaluate(() => {
      const sheet = document.querySelector('.desk-sheet-experiment')
      return {
        formulaText: sheet?.querySelector('.desk-formula')?.textContent ?? sheet?.textContent?.slice(0, 120) ?? '',
        badge: sheet?.querySelector('.desk-run-badge')?.textContent?.slice(0, 130) ?? '',
      }
    })
    console.log(`[m7] second-formula experiment: ${JSON.stringify(exp).slice(0, 160)}`)
    const hasDamped = /e\s*−?\s*t|e\^|cos/i.test(exp.formulaText)
    if (!hasDamped) failures.push(`second marker did not play the damped formula — formula text: ${exp.formulaText.slice(0, 80)}`)
    // run provenance: badge carries LOCAL CALC + the real engine + a run id
    if (!/LOCAL CALC/.test(exp.badge) || !exp.badge.includes('cortex-ce')) {
      failures.push(`second-formula run lacks provenance — badge: ${exp.badge}`)
    }

    // 3. multi-page: pager exists; page 2 pixels differ from page 1
    const pager = page.locator('.desk-paper-pager')
    if (!(await pager.count())) {
      failures.push('multi-page pager not rendered (sample PDF has 2 pages)')
    } else {
      const label = await pager.locator('.desk-paper-page-label').textContent()
      console.log(`[m7] pager label: ${label}`)
      // pixel evidence via canvas readback (works regardless of tldraw viewport)
      const pixelHash = () =>
        page.evaluate(() => {
          const c = document.querySelector('.desk-paper-sheet canvas')
          if (!c) return null
          const probe = document.createElement('canvas')
          probe.width = 64
          probe.height = 80
          const ctx = probe.getContext('2d')
          ctx.drawImage(c, 0, 0, 64, 80)
          const d = ctx.getImageData(0, 0, 64, 80).data
          let sum = 0
          let sumSq = 0
          let dark = 0
          const n = d.length / 4
          for (let i = 0; i < d.length; i += 4) {
            const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
            sum += lum
            sumSq += lum * lum
            if (lum < 128) dark++
          }
          return { mean: sum / n, std: Math.sqrt(Math.max(0, sumSq / n - (sum / n) ** 2)), dark, n }
        })
      const hash1 = await pixelHash()
      await page.evaluate(() => {
        const pager = document.querySelector('.desk-paper-pager')
        const next = Array.from(pager?.querySelectorAll('button') ?? []).find((b) => b.textContent?.includes('›'))
        next?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await page.waitForTimeout(1500)
      const label2 = await pager.locator('.desk-paper-page-label').textContent()
      const hash2 = await pixelHash()
      console.log(`[m7] after turn: ${label2}, pixels ${JSON.stringify(hash1)} → ${JSON.stringify(hash2)}`)
      if (label2?.trim() !== '2 / 2') failures.push(`pager did not advance to page 2 (label=${label2})`)
      if (!hash1 || !hash2) failures.push('paper canvas readback failed')
      else if (Math.abs(hash1.mean - hash2.mean) < 0.5 && hash1.dark === hash2.dark) {
        failures.push('page turn did not change the paper pixels')
      }
      // page 2 has no formulas → markers disappear
      const markers2 = await page.locator('.desk-playable-marker').count()
      console.log(`[m7] markers on page 2: ${markers2}`)
      if (markers2 !== 0) failures.push(`page 2 should have no formula markers, got ${markers2}`)
    }

    if (consoleErrors.length) failures.push(`console errors: ${consoleErrors.slice(0, 3).join(' | ')}`)
    else console.log('[m7] console: 0 errors')
  } catch (err) {
    failures.push(`harness error: ${err?.message ?? err}`)
  } finally {
    await browser.close()
  }
  if (failures.length) {
    console.error('\nFAIL:\n' + failures.map((f) => `  ✗ ${f}`).join('\n'))
    process.exit(1)
  }
  console.log('\nPASS: multi-formula selection + multi-page paper on the real product path')
}
main()
