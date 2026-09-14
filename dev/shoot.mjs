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
  await page.getByRole('tab', { name: 'Grouped' }).waitFor()
  await page.getByText('photo-library-ml-7d9f8b6b8-x2k9v').first().waitFor()
  await shot('04-app-detail-grouped.png')

  // The same resources as a hierarchy. Grouping cannot say which Pod belongs
  // to which ReplicaSet, which is the whole reason the tree survived as a
  // mode you switch into.
  await page.getByRole('tab', { name: 'Tree' }).click()
  await page.waitForTimeout(150)
  await shot('04b-app-detail-tree.png')
  await page.getByRole('tab', { name: 'Grouped' }).click()

  // The one action, now with a receipt.
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.getByText('Refresh requested').waitFor()
  await page.waitForTimeout(320) // let the toast finish sliding up
  await shot('05-app-detail-refreshed.png')

  // A Pod, which is also the honest-emptiness case: no kind-specific actions
  // exist for one, and most of a resource tree is Pods, Services and
  // ConfigMaps. The section still appears and says so in a sentence.
  await page.locator('button', { hasText: 'photo-library-ml-7d9f8b6b8-x2k9v' }).first().click()
  await page.getByRole('dialog').waitFor()
  await page.getByText('GET /healthz').first().waitFor()
  await page.getByText('offers no actions').waitFor()
  await shot('06-app-detail-sheet.png')
  await page.getByRole('button', { name: 'Close' }).last().click()

  /** A kind's group in the grouped view, by the band's own `group/kind`. */
  const kindGroup = (kind) => page.locator('section', { has: page.getByText(kind, { exact: true }) })

  // A kind that does offer actions: a Deployment carries restart and pause,
  // plus resume *disabled*, which is the third state — offered for this kind,
  // refused right now. `home` is not marked production, so each of these runs
  // on the tap.
  await kindGroup('apps/Deployment').getByRole('button').first().click()
  await page.getByRole('dialog').waitFor()
  await page.getByText('roll every pod').waitFor()
  await shot('06b-resource-actions.png')
  await page.getByRole('button', { name: 'Close' }).last().click()

  // THE GUARDRAIL. `orders` is the instance marked `production: true` in
  // dev/config.yaml, and the identical restart there asks first rather than
  // firing under the thumb.
  await page.goto(`${base}/apps/orders/orders-worker`)
  await page.getByRole('tab', { name: 'Grouped' }).waitFor()
  await kindGroup('apps/Deployment').getByRole('button').first().click()
  await page.getByRole('dialog').waitFor()
  await page.getByRole('button', { name: /^restart/ }).click()
  await page.getByText(/marked production/).waitFor()
  await shot('06c-resource-action-production.png')
  await page.getByRole('button', { name: 'Close' }).last().click()

  // THE SYNC SHEET, on the application it exists for: doc-archive is
  // OutOfSync *and* manual — nothing will fix it until somebody presses this.
  // Two shots of one sheet, the way the reference screenshots are: what it
  // offers when it opens, and the resource list once it is unfolded. The
  // second is the one that proves the long case is usable on a phone.
  await page.goto(`${base}/apps/home/doc-archive`)
  await page.getByRole('tab', { name: 'Grouped' }).waitFor()
  await page.waitForTimeout(150)
  // The question and the two things that answer it, on one screen: the word
  // OutOfSync boxed as the control it now is, and Sync… beside Refresh.
  await shot('15b-app-detail-outofsync.png')
  await page.getByRole('button', { name: /^Sync/ }).click()
  await page.getByRole('dialog', { name: 'Synchronize' }).waitFor()
  await page.waitForTimeout(150)
  await shot('16-app-detail-sync.png')

  // Prune on: the propagation policy appears under it, and the pinned summary
  // grows the sentence that says this one deletes. It is the destructive
  // configuration of the destructive action, and nothing else photographs it.
  await page.getByRole('checkbox', { name: /^Prune delete/ }).click()
  await page.waitForTimeout(150)
  await shot('16b-app-detail-sync-prune.png')

  await page.getByText('how it applies').click()
  await page.getByText(/of \d+ selected/).click()
  await page.getByRole('dialog').getByRole('checkbox').last().scrollIntoViewIfNeeded()
  await page.waitForTimeout(150)
  await shot('17-app-detail-sync-resources.png')
  await page.getByRole('button', { name: 'Cancel' }).click()

  // THE DIFF, on the same drifted application, reached the way the screen
  // offers it: by pressing the word OutOfSync. Two shots, because the two
  // halves of this sheet are answering different questions -- the changed
  // fields of a resource that exists on both sides, and the two resources
  // that exist on only one, which is the case a field list cannot show and
  // the band has to say in words.
  await page.getByRole('button', { name: 'See what differs from Git' }).click()
  await page.getByRole('dialog', { name: 'What differs' }).waitFor()
  await page.getByText('spec.replicas').waitFor()
  await page.waitForTimeout(150)
  await shot('18-app-detail-diff.png')

  // A resource that exists on only one side: the band says the whole answer,
  // and the fields behind it are what has to be asked for -- nobody reads
  // eight added lines to learn "the cluster does not have this". Unfolded
  // here, with the group of resources that match below it.
  await page.getByText(/all \d+ fields/).first().click()
  await page.getByText('identical').scrollIntoViewIfNeeded()
  await page.waitForTimeout(150)
  await shot('18b-app-detail-diff-one-sided.png')
  await page.getByRole('button', { name: 'Close' }).last().click()

  // The honest empty state: an application with nothing out of sync still
  // gets an answer, and it names what was compared rather than showing a
  // blank panel. grafana on this instance is Synced.
  await page.goto(`${base}/apps/home/grafana`)
  await page.getByRole('button', { name: 'See what differs from Git' }).click()
  await page.getByText('Nothing differs').waitFor()
  await page.waitForTimeout(150)
  await shot('18c-app-detail-diff-identical.png')
  await page.getByRole('button', { name: 'Close' }).last().click()

  // MANIFESTS, from the menu: the inventory first, folded, and then one
  // object. The other manifest view in this app -- a resource's live copy --
  // is a tab in the resource sheet; 06 photographs that one.
  await page.goto(`${base}/apps/home/doc-archive`)
  await page.getByRole('button', { name: 'More' }).click()
  await page.getByRole('button', { name: /^Manifests/ }).click()
  await page.getByRole('dialog', { name: 'Desired manifests' }).waitFor()
  await page.waitForTimeout(150)
  await shot('19-app-detail-manifests.png')

  await page.getByRole('dialog').locator('summary').first().click()
  await page.waitForTimeout(150)
  await shot('19b-app-detail-manifests-open.png')
  await page.getByRole('button', { name: 'Close' }).last().click()

  // 90 of 99 applications are healthy, so the quiet card is the one the
  // list is mostly made of: capture it, and prove the counter chips filter.
  await page.goto(base)
  await page.getByRole('heading', { name: 'Applications' }).waitFor()
  await page.getByRole('button', { name: /healthy/i }).click()
  await page.waitForTimeout(200)
  await shot('07-apps-list-healthy.png')

  // The case the dashed rail exists for: applications that are Healthy and
  // Synced and will still sit drifted until somebody presses something.
  // A dashed rail that only ever appeared beside a red row would prove
  // nothing about whether the texture reads on its own, so this shot is
  // deliberately a mix -- `postgres-orders` and `prometheus` are manual and
  // calm, their neighbours are automatic.
  await page.getByRole('button', { name: /healthy/i }).click()
  await page.getByLabel('Find an application').fill('pro')
  await page.getByLabel('Find an application').blur()
  await page.waitForTimeout(250)
  await shot('07b-apps-list-manual.png')

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
  await page.getByLabel('Find an application').blur()
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
