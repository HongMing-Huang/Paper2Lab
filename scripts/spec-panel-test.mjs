#!/usr/bin/env node
// paper→model product-path evidence: upload the REAL SIR paper (精读 Docling),
// open the 理解卡, click「构建模型并求解」, and assert the CALCULATED result
// table appears with all three states (S/I/R) and a run badge — the full
// comprehension→build→solve chain on the real product, no synthetic routes.
import { chromium } from 'playwright-core'

const ORIGIN = 'http://127.0.0.1:8787'
const PAPER = new URL('../public/papers/ode-sir-three-state.pdf', import.meta.url).pathname

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

const main = async () => {
  if (!(await waitApi())) { console.error('backend not up'); process.exit(1) }
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  const consoleErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  page.on('pageerror', (e) => consoleErrors.push(String(e)))
  let code = 0
  try {
    await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' })
    await page.locator('button.home-drop').waitFor({ timeout: 30000 })
    await page.locator('[data-testid="parse-mode"] button').filter({ hasText: '精读定位' }).click()
    const chooserP = page.waitForEvent('filechooser')
    await page.locator('button.home-drop').click()
    const chooser = await chooserP
    await chooser.setFiles([PAPER])
    // CLI-151: the study space opens first; full parse → desk is explicit
    await page.getByTestId('study-full-parse').click()
    await page.waitForSelector('.desk-topbar-meta', { timeout: 480000 })
    console.log('[desk] up — opening 理解卡')

    await page.locator('[data-testid="toggle-spec"]').click()
    await page.locator('[data-testid="spec-panel"]').waitFor({ timeout: 10000 })
    const eqCount = await page.locator('.spec-eq').count()
    console.log(`[spec] equations listed: ${eqCount} (expect 6 = 3 governing + 3 initials)`)
    if (eqCount < 6) code = 1

    await page.locator('[data-testid="build-model"]').click()
    await page.locator('[data-testid="model-result"]').waitFor({ timeout: 60000 })
    const badge = await page.locator('.spec-run-badge').textContent()
    const rows = await page.locator('[data-testid="model-result"] tbody tr').count()
    const rowText = await page.locator('[data-testid="model-result"] tbody').textContent()
    console.log(`[model] badge: ${badge?.trim()}`)
    console.log(`[model] state rows: ${rows} (expect 3)`)
    console.log(`[model] rows: ${rowText?.replace(/\s+/g, ' ').slice(0, 160)}`)
    if (rows !== 3 || !badge?.includes('CALCULATED')) code = 1
  } catch (e) {
    console.error('FAIL:', e.message?.slice(0, 400))
    code = 1
  } finally {
    if (consoleErrors.length) { console.log('console errors:', consoleErrors.slice(0, 5)); code = 1 }
    await browser.close()
  }
  process.exit(code)
}

main()
