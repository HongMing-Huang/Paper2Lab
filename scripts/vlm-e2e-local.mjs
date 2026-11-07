#!/usr/bin/env node
// One-off local evidence: the home DEFAULT mode (⚡快速理解 / VLM) end to end
// against a REAL provider — drop a real paper, expect the desk in seconds
// with the「AI 视觉提取」provenance label. Complements product-formula-test
// (which pins the 精读 path); not part of CI (needs provider credentials).
import { chromium } from 'playwright-core'

const ORIGIN = 'http://127.0.0.1:8787'
const SAMPLE = new URL('../public/papers/fit-sine-fit.pdf', import.meta.url).pathname

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
    // DEFAULT mode must be vlm (no click on the selector)
    const vlmActive = await page.locator('[data-testid="parse-mode"] button').filter({ hasText: '快速理解' })
      .evaluate((el) => el.className.includes('active'))
    console.log(`[mode] default 快速理解 active: ${vlmActive}`)
    if (!vlmActive) code = 1

    const t0 = Date.now()
    const chooserP = page.waitForEvent('filechooser')
    await page.locator('button.home-drop').click()
    const chooser = await chooserP
    await chooser.setFiles([SAMPLE])
    // CLI-151: the study space opens first; full parse → desk is explicit
    await page.getByTestId('study-full-parse').click()
    await page.waitForSelector('.desk-topbar-meta', { timeout: 120000 })
    const seconds = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`[vlm] desk appeared in ${seconds}s`)

    const meta = await page.locator('.desk-topbar-meta').textContent()
    console.log(`[vlm] provenance: ${meta}`)
    if (!meta.includes('AI 视觉提取')) code = 1
    if (!meta.includes('qwen3.8-27b@fast-path')) code = 1

    // the desk grew formula paper (Playable marker) — the SAME route chain
    await page.waitForSelector('.desk-playable-marker', { timeout: 60000 })
    console.log('[vlm] Playable marker present — VLM extraction fed the same desk')
  } catch (e) {
    console.error('FAIL:', e.message?.slice(0, 300))
    code = 1
  } finally {
    if (consoleErrors.length) { console.log('console errors:', consoleErrors.slice(0, 5)); code = 1 }
    await browser.close()
  }
  process.exit(code)
}

main()
