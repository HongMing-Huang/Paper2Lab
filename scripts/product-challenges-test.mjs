#!/usr/bin/env node
// Challenges product-path evidence (real page, REAL MOUSE, no GUI window):
//   1. three level tabs switch; goal + budget render
//   2. projectile: drag angle + speed with real mouse, fire → real compute
//      via the backend engine → hit feedback + trajectory SVG + score
//   3. pendulum: wrong length → measured-period mismatch feedback; retry
//      with the matching length → match + best record improves
//   4. tubes: per-cluster sliders → measured volume feedback
//   5. agent tries the SAME level (shared budget decrements, history grows)
import { chromium } from 'playwright-core'

const ORIGIN = 'http://127.0.0.1:8787'

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

const failures = []
const log = (m) => console.log(m)

async function dragSlider(page, testId, targetValue) {
  const el = page.locator(`[data-testid="${testId}"] input[type="range"]`)
  const box = await el.boundingBox()
  // read min/max/step from the element to compute the pixel position
  const { min, max } = await el.evaluate((n) => ({ min: Number(n.min), max: Number(n.max) }))
  const frac = (targetValue - min) / (max - min)
  const x = box.x + box.width * frac
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y, { steps: 1 }) // real pointer drag to the target
  await page.mouse.up()
}

async function main() {
  if (!(await waitApi())) {
    console.error('FAIL: backend not reachable on :8787')
    process.exit(1)
  }
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-gpu-sandbox'],
  })
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  const consoleErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  try {
    await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' })
    await page.locator('button.home-challenges').click()
    await page.waitForSelector('[data-testid="fire"]', { timeout: 30000 })
    log('[chal] lab booted (projectile default)')

    // 1. level tabs
    for (const k of ['pendulum', 'tubes', 'projectile']) {
      await page.locator(`[data-testid="level-${k}"]`).click()
      await page.waitForTimeout(150)
    }
    const budget0 = await page.evaluate(() => window.__P2L_CHALLENGE__.budget())
    log(`[chal] tabs switch ok; budget=${budget0}`)

    // 2. projectile hit with real-mouse slider drags
    await dragSlider(page, 'param-angleDeg', 45)
    await dragSlider(page, 'param-speed', 15)
    await page.locator('[data-testid="fire"]').click()
    await page.waitForSelector('[data-testid="projectile-svg"]', { timeout: 120000 })
    const fb1 = await page.locator('[data-testid="feedback"]').textContent()
    log(`[chal] projectile feedback: ${fb1}`)
    if (!/命中/.test(fb1 ?? '')) failures.push(`projectile did not hit: ${fb1}`)
    const st1 = await page.evaluate(() => ({ attempts: window.__P2L_CHALLENGE__.attempts(), best: window.__P2L_CHALLENGE__.best(), solved: window.__P2L_CHALLENGE__.solved() }))
    log(`[chal] state: attempts=${st1.attempts} best=${st1.best} solved=${st1.solved}`)
    if (st1.attempts !== 1 || st1.best < 1000 || !st1.solved) failures.push(`projectile state wrong: ${JSON.stringify(st1)}`)
    // the trajectory SVG carries sampled points from the real run
    const pathLen = await page.locator('[data-testid="projectile-svg"] path').first().getAttribute('d')
    if (!pathLen || pathLen.length < 200) failures.push('trajectory path too small — not real sampled data')

    // 3. pendulum retry loop (miss → adjust → match)
    await page.locator('[data-testid="level-pendulum"]').click()
    await dragSlider(page, 'param-length', 0.5)
    await page.locator('[data-testid="fire"]').click()
    await page.waitForSelector('[data-testid="pendulum-svg"]', { timeout: 120000 })
    const fbMiss = await page.locator('[data-testid="feedback"]').textContent()
    log(`[chal] pendulum miss: ${fbMiss}`)
    if (!/差 0\.|改杆长再试/.test(fbMiss ?? '')) failures.push(`pendulum should mismatch at L=0.5: ${fbMiss}`)
    // retry with the matching length
    await dragSlider(page, 'param-length', 0.994)
    await page.locator('[data-testid="fire"]').click()
    await page.waitForTimeout(1500)
    const fbHit = await page.locator('[data-testid="feedback"]').textContent()
    log(`[chal] pendulum retry: ${fbHit}`)
    if (!/匹配/.test(fbHit ?? '')) failures.push(`pendulum retry did not match: ${fbHit}`)
    const history = await page.locator('[data-testid="attempt-history"]').textContent()
    if (!/👤/.test(history ?? '')) failures.push('attempt history missing user records')

    // 4. tubes with per-cluster sliders
    await page.locator('[data-testid="level-tubes"]').click()
    for (let i = 0; i < 4; i++) await dragSlider(page, `param-offset-${i}`, 1)
    await page.locator('[data-testid="fire"]').click()
    await page.waitForSelector('[data-testid="tubes-bars"]', { timeout: 120000 })
    const fbTubes = await page.locator('[data-testid="feedback"]').textContent()
    log(`[chal] tubes: ${fbTubes}`)
    if (!/⋃T|预算/.test(fbTubes ?? '')) failures.push(`tubes feedback missing volume: ${fbTubes}`)

    // 5. agent tries the same level — shared budget
    const bBefore = await page.evaluate(() => window.__P2L_CHALLENGE__.budget())
    await page.locator('[data-testid="agent-try"]').click()
    await page.waitForTimeout(2500)
    const bAfter = await page.evaluate(() => window.__P2L_CHALLENGE__.budget())
    const histNow = await page.locator('[data-testid="attempt-history"]').textContent()
    log(`[chal] agent try: budget ${bBefore}→${bAfter}; history has agent=${/🤖/.test(histNow ?? '')}`)
    if (bAfter !== bBefore - 1) failures.push(`agent attempt did not share the budget: ${bBefore}→${bAfter}`)
    if (!/🤖/.test(histNow ?? '')) failures.push('agent attempt missing from history')

    if (consoleErrors.length) {
      failures.push(`console errors: ${consoleErrors.slice(0, 3).join(' | ')}`)
    } else {
      log('[chal] console: 0 errors')
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
  console.log('\nPASS: challenges product path (three levels · real-mouse params · engine compute · retry · shared budget)')
}

main()
