#!/usr/bin/env node
// Boots the whole MazeCD dev harness (see dev/harness.mjs), logs in through
// the real login screen, and screenshots five screens at iPhone 15 Pro size.
// Run as `npm run shoot` from web/. Everything it starts is killed on exit,
// success or failure.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { base, boot, devDir, guard, phone, signIn } from './harness.mjs'

const shotsDir = path.join(devDir, 'shots')
mkdirSync(shotsDir, { recursive: true })

async function main() {
  await boot()

  console.log('== driving the browser ==')
  const { browser, page } = await phone()
  const shot = (name) => page.screenshot({ path: path.join(shotsDir, name) })

  await signIn(page)
  await page.getByText('Connected').first().waitFor({ state: 'attached' }).catch(() => {})
  await page.waitForTimeout(300)

  await shot('01-apps-list-top.png')

  const degradedRow = page.locator('a', { hasText: 'photo-library-ml' })
  await degradedRow.scrollIntoViewIfNeeded()
  await page.waitForTimeout(150)
  await shot('02-apps-list-degraded-row.png')

  await degradedRow.click()
  await page.waitForURL(/\/apps\//)
  await page.getByText(/resources$/).waitFor()
  await page.getByText('photo-library-ml-7d9f8b6b8-x2k9v').first().waitFor()
  await shot('03-app-detail-tree.png')

  await page.locator('button', { hasText: 'photo-library-ml-7d9f8b6b8-x2k9v' }).first().click()
  await page.getByRole('dialog').waitFor()
  await page.getByText('GET /healthz').first().waitFor()
  await shot('04-app-detail-sheet.png')

  // 90 of 99 applications are healthy, so the quiet card is the one the
  // list is mostly made of: capture it, and prove the counter chips filter.
  await page.goto(base)
  await page.getByRole('heading', { name: 'Applications' }).waitFor()
  await page.getByRole('button', { name: /healthy/i }).click()
  await page.waitForTimeout(200)
  await shot('06-apps-list-healthy.png')

  await page.goto(`${base}/settings`)
  await page.getByRole('heading', { name: 'Settings' }).waitFor()
  await page.getByText('Connected').first().waitFor()
  await shot('05-settings.png')

  await browser.close()
  console.log(`== done: screenshots in ${shotsDir} ==`)
}

guard(main)
