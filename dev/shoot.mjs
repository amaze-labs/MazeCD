#!/usr/bin/env node
// Boots the whole MazeCD dev harness (see dev/harness.mjs), logs in through
// the real login screen, and screenshots every screen at iPhone 15 Pro size —
// once in the dark theme and once in the light one. Run as `npm run shoot`
// from web/. Everything it starts is killed on exit, success or failure.
//
// Two things this does that a screenshot script usually does not.
//
// **Both themes, every screen.** The light theme is driven through
// `prefers-color-scheme` on the browser context, which is the same input a
// real phone gives the app — not a switch the harness flips — so what comes
// out is what an operator standing in the sun would actually get. A theme
// nobody rendered is what this project has shipped and regretted before.
//
// **The states that have no fixture.** The stub answers in single-digit
// milliseconds and always succeeds, so the skeleton, the empty list, the
// unreachable instance and the failed load would never appear on their own —
// and a state nobody has ever seen is not a state anyone can trust. Rather
// than teach the stub to misbehave (it is shared with `npm run live`, where
// its honesty is the point), those four are forced at the browser's network
// layer: the responses the server would give are given by `page.route`, which
// is the same JSON arriving over the same fetch. The live streams are aborted
// alongside, because `lib/live.ts` would otherwise write the real fleet back
// into the cache and undo the fixture a second later.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { base, boot, devDir, guard, phone, signIn, sleep } from './harness.mjs'

const shotsDir = path.join(devDir, 'shots')

/** Hold a response back so the loading state is on screen long enough to see
 * and to photograph. */
const stall = (page, pattern, ms) =>
  page.route(pattern, async (route) => {
    await sleep(ms)
    await route.continue()
  })

/** Answer a request with fixed JSON, the way the server would. */
const serve = (page, pattern, body, status = 200) =>
  page.route(pattern, (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }),
  )

/** Every live stream dead, so a fixture is not overwritten by the real fleet
 * arriving on a watch a moment later. */
const muteStreams = (page) => page.route('**/stream/**', (route) => route.abort())

async function shootTheme(theme) {
  const dir = path.join(shotsDir, theme)
  mkdirSync(dir, { recursive: true })
  console.log(`\n== ${theme} theme ==`)
  const { browser, page } = await phone({ colorScheme: theme })
  const shot = (name) => page.screenshot({ path: path.join(dir, name) })

  await signIn(page)
  await page.getByText('Connected').first().waitFor({ state: 'attached' }).catch(() => {})
  await page.waitForTimeout(300)

  await shot('01-apps-list-top.png')

  const degradedRow = page.locator('a', { hasText: 'photo-library-ml' })
  await degradedRow.scrollIntoViewIfNeeded()
  await page.waitForTimeout(150)
  await shot('02-apps-list-degraded-row.png')

  // A counter chip doing its job. This replaces the legend shot: the ⓘ that
  // explained the two numeric columns is gone, because the columns are now
  // named in a header row above the list, which 01 already photographs.
  // What has no other picture is a *filtering* chip — the one control in the
  // product whose on and off states are told apart by the weight of an
  // outline rather than by a fill, which is exactly the change this pass is
  // about and exactly the kind of state this harness exists to prove.
  await page.goto(base)
  await page.getByRole('heading', { name: 'Applications' }).waitFor()
  await page.getByRole('button', { name: /degraded/i }).click()
  await page.waitForTimeout(250)
  await shot('03-apps-list-filtered.png')
  await page.getByRole('button', { name: /degraded/i }).click()
  await page.waitForTimeout(150)

  await degradedRow.click()
  await page.waitForURL(/\/apps\//)
  await page.getByText(/resources$/).waitFor()
  await page.getByText('photo-library-ml-7d9f8b6b8-x2k9v').first().waitFor()
  await shot('04-app-detail-tree.png')

  // The one action, now with a receipt.
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.getByText('Refresh requested').waitFor()
  await page.waitForTimeout(320) // let the toast finish sliding up
  await shot('05-app-detail-refreshed.png')

  await page.locator('button', { hasText: 'photo-library-ml-7d9f8b6b8-x2k9v' }).first().click()
  await page.getByRole('dialog').waitFor()
  await page.getByText('GET /healthz').first().waitFor()
  await shot('06-app-detail-sheet.png')

  // 90 of 99 applications are healthy, so the quiet card is the one the
  // list is mostly made of: capture it, and prove the counter chips filter.
  await page.goto(base)
  await page.getByRole('heading', { name: 'Applications' }).waitFor()
  await page.getByRole('button', { name: /healthy/i }).click()
  await page.waitForTimeout(200)
  await shot('07-apps-list-healthy.png')

  await page.goto(`${base}/settings`)
  await page.getByRole('heading', { name: 'Settings' }).waitFor()
  await page.getByText('Connected').first().waitFor()
  await shot('08-settings.png')

  // The override, and that it is remembered. Pick the theme this run is *not*
  // in, reload, and shoot: the page comes back in the chosen theme against a
  // phone that still prefers the other one, which is the whole of what the
  // setting claims to do. Then hand it back to the system.
  await page.getByRole('button', { name: theme === 'dark' ? 'Light' : 'Dark' }).click()
  await page.reload()
  await page.getByRole('heading', { name: 'Settings' }).waitFor()
  await page.waitForTimeout(200)
  await shot('15-settings-theme-override.png')
  await page.getByRole('button', { name: 'System' }).click()

  // ---- the states with no fixture ---------------------------------------
  await muteStreams(page)

  // The list, still arriving.
  await stall(page, '**/api/apps', 6_000)
  await page.goto(base)
  await page.getByRole('heading', { name: 'Applications' }).waitFor()
  await page.waitForTimeout(600) // one shimmer pass, so the sweep is mid-travel
  await shot('09-apps-list-loading.png')
  await page.unroute('**/api/apps')

  // The detail, still arriving.
  await stall(page, '**/api/i/*/applications/photo-library-ml*', 6_000)
  await page.goto(`${base}/apps/home/photo-library-ml`)
  await page.getByText('Applications').first().waitFor()
  await page.waitForTimeout(600)
  await shot('10-app-detail-loading.png')
  await page.unroute('**/api/i/*/applications/photo-library-ml*')

  // One instance unreachable: the contract is partial results plus a banner.
  // The list below is short by an instance, not wrong, and the banner is the
  // only thing that can say which one and offer to ask again.
  // Read the real fleet from inside the page, which has the session cookie,
  // then hand back everything except one instance.
  const real = await page.evaluate(() => fetch('/api/apps').then((r) => r.json()))
  const partial = {
    apps: real.apps.filter((a) => a.instance !== 'utility'),
    errors: [
      {
        instance: 'utility',
        message: 'dial tcp 10.4.1.22:443: i/o timeout after 5s',
      },
    ],
  }
  await serve(page, '**/api/apps', partial)
  await page.goto(base)
  await page.getByText('did not answer').waitFor()
  await page.waitForTimeout(200)
  await shot('11-apps-list-unreachable.png')

  // Every instance answered and none of them has anything.
  await serve(page, '**/api/apps', { apps: [], errors: [] })
  await page.goto(base)
  await page.getByText('No applications yet').waitFor()
  await page.waitForTimeout(200)
  await shot('12-apps-list-empty.png')

  // Nothing answered at all.
  await serve(page, '**/api/apps', { error: 'upstream unavailable' }, 502)
  await page.goto(base)
  await page.getByText('could not load the fleet').waitFor()
  await page.waitForTimeout(200)
  await shot('13-apps-list-error.png')

  // A filter that matches nothing, over a real fleet.
  await page.unroute('**/api/apps')
  await page.goto(base)
  await page.getByRole('heading', { name: 'Applications' }).waitFor()
  await page.getByLabel('Find an application').fill('zzzz')
  await page.getByText('Nothing matches this filter').waitFor()
  await page.waitForTimeout(200)
  await shot('14-apps-list-no-match.png')

  await browser.close()
}

async function main() {
  await boot()
  console.log('== driving the browser ==')
  for (const theme of ['dark', 'light']) await shootTheme(theme)
  console.log(`\n== done: screenshots in ${shotsDir}/{dark,light} ==`)
}

guard(main)
