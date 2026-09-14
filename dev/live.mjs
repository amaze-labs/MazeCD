#!/usr/bin/env node
// Proves MazeCD updates live rather than by polling. Boots the same harness
// `npm run shoot` uses (dev/harness.mjs) and drives it with Playwright:
//
//   1. the list changes on its own, with no /api/apps request in between
//   2. the resource tree changes on its own, with no resource-tree fetch
//   3. hiding the document closes every stream; showing it reopens them
//   4. one instance's stream dying leaves the other two updating, the list
//      intact, and the dead one reconnecting on a backoff rather than a loop
//   5. a reconnect after a long blackout shows the world as it is now
//
// Run as `npm run live` from web/. The stub flips one application per
// instance between Healthy and Progressing every five seconds, which is the
// change every check below is watching for.
import { base, boot, guard, phone, signIn, sleep, stubHealth } from './harness.mjs'

let failures = 0
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`)
  if (!ok) failures++
}

/** Runs one numbered section. A locator that times out (a re-anchor gone
 * stale, a regression in the UI) used to throw straight out of `main`: the
 * checks it was about to make never printed a line at all, and the run died
 * silently in a flood of teardown noise -- which is exactly how checks 3-5
 * went unrun for three commits without anyone raising an eyebrow. Catching
 * here turns that into an explicit FAIL for every check the section owns, and
 * lets the sections after it still run. */
async function step(names, fn) {
  try {
    await fn()
  } catch (err) {
    const msg = err instanceof Error ? err.message.split('\n')[0] : String(err)
    for (const name of names) check(name, false, `section threw before this could be observed: ${msg}`)
  }
}

/** Waits for `read()` to return something different from `before`. */
async function waitForChange(read, before, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const now = await read()
    if (now !== before) return { changed: true, after: now, ms: timeoutMs - (deadline - Date.now()) }
    await sleep(200)
  }
  return { changed: false, after: before, ms: timeoutMs }
}

/** Waits for `read()` to keep returning `want`, or gives up. */
async function waitUntil(read, want, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const now = await read()
    if (now === want || Date.now() > deadline) return now
    await sleep(100)
  }
}

async function main() {
  await boot()

  console.log('\n== driving the browser ==')
  const { browser, page } = await phone()

  // Every request the page makes, timestamped, so a claim of "nothing was
  // fetched in between" can be checked rather than asserted.
  const log = []
  const isStream = (url) => url.includes('/stream/')
  // Streams still in flight. A full page navigation kills its requests without
  // Playwright ever reporting them finished, so the set is cleared with the
  // document it belonged to -- otherwise every `goto` would leak a phantom
  // connection into the count.
  const open = new Set()
  page.on('request', (r) => {
    log.push({ t: Date.now(), url: r.url() })
    if (isStream(r.url())) open.add(r)
  })
  page.on('requestfinished', (r) => open.delete(r))
  page.on('requestfailed', (r) => open.delete(r))
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) open.clear()
  })
  const openStreams = () => open.size

  const since = (t, re) => log.filter((r) => r.t >= t && re.test(r.url))
  const setVisibility = (state) =>
    page.evaluate((s) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s })
      document.dispatchEvent(new Event('visibilitychange'))
    }, state)

  await signIn(page)
  // By href, not by a heading: the mockup-B port (2b0b4c9) set an application's
  // name in a span rather than an <h2>, and this locator had been silently
  // timing out ever since. The row's own link target is the one thing about it
  // that a visual pass cannot change.
  const row = (name) => page.locator(`a[href$="/${name}"]`)
  const grafana = row('grafana')
  await grafana.waitFor()
  await sleep(1500) // let the initial /api/apps and the three streams settle

  // ---- 1. the list updates with no poll ---------------------------------
  await step(['the application list changes on its own', 'and nothing was polled in between'], async () => {
    const before = await grafana.innerText()
    const t0 = Date.now()
    const listChange = await waitForChange(() => grafana.innerText(), before, 12_000)
    const pollsDuring = since(t0, /\/api\/apps/)
    check(
      'the application list changes on its own',
      listChange.changed,
      `"${before.replace(/\n/g, ' | ')}"  ->  "${listChange.after.replace(/\n/g, ' | ')}"  after ${listChange.ms}ms`,
    )
    check(
      'and nothing was polled in between',
      pollsDuring.length === 0,
      `${pollsDuring.length} /api/apps requests in those ${listChange.ms}ms; ` +
        `${since(t0, /\/stream\/applications/).length} stream connections opened`,
    )
  })

  // ---- 2. the resource tree updates with no poll ------------------------
  await step(
    ['the resource tree changes on its own', 'and the tree was never refetched in between'],
    async () => {
      await grafana.click()
      await page.waitForURL(/\/apps\/home\/grafana/)
      // The Grouped/Tree tablist renders exactly one panel below it; see
      // AppDetailScreen, where `role="tabpanel"` was added because a tablist
      // pointing at nothing is a real accessibility gap, not a favour to this
      // script. Waiting for it directly replaces a text match against
      // "resources" that the mockup-B port (2b0b4c9) put a number ahead of,
      // which stopped the old regex ever matching the label again.
      const panel = page.locator('#tabpanel')
      await panel.waitFor()
      await sleep(1500)
      const treeBefore = await panel.innerText()
      const t1 = Date.now()
      const treeChange = await waitForChange(() => panel.innerText(), treeBefore, 12_000)
      const treePolls = since(t1, /resource-tree/).filter((r) => !isStream(r.url))
      const progressingNodes = (s) => (s.match(/Progressing/g) ?? []).length
      check(
        'the resource tree changes on its own',
        treeChange.changed,
        `${progressingNodes(treeBefore)} Progressing resources -> ` +
          `${progressingNodes(treeChange.after)} after ${treeChange.ms}ms`,
      )
      check(
        'and the tree was never refetched in between',
        treePolls.length === 0,
        `${treePolls.length} plain resource-tree fetches; ` +
          `${since(t1, /stream\/applications\/grafana\/resource-tree/).length} tree stream connections opened`,
      )
    },
  )

  await page.goto(base)
  await grafana.waitFor()
  await sleep(1500)

  // ---- 3. a hidden document holds no connections ------------------------
  let frozen = ''
  await step(['hiding the document closes every stream', 'and nothing updates while hidden'], async () => {
    const openWhileVisible = openStreams()
    await setVisibility('hidden')
    const openWhileHidden = await waitUntil(openStreams, 0, 5_000)
    const hiddenText = await grafana.innerText()
    const t2 = Date.now()
    await sleep(8_000) // more than one 5s cycle of the stub
    const quiet = await waitForChange(() => grafana.innerText(), hiddenText, 0)
    check(
      'hiding the document closes every stream',
      openWhileVisible === 3 && openWhileHidden === 0,
      `${openWhileVisible} open while visible (one per instance) -> ${openWhileHidden} while hidden; ` +
        `${since(t2, /\/stream\//).length} stream connections opened in the 8s after hiding`,
    )
    check(
      'and nothing updates while hidden',
      !quiet.changed && since(t2, /\/api\/apps/).length === 0,
      `row text unchanged for 8s, ${since(t2, /\/api\/apps/).length} polls in that time`,
    )
    frozen = hiddenText
  })

  // ---- 5. a reconnect shows now, not then --------------------------------
  await step(['a reconnect after a blackout shows the current world, not the stale one'], async () => {
    // Still hidden: wait until the frozen row actually disagrees with the
    // stub, so what follows is a demonstrably stale view being corrected
    // rather than one that happened to be right.
    const agrees = (shown, health) => shown.includes('Progressing') === (health === 'Progressing')
    // Wait for the *moment* the stub flips away from what the frozen row says,
    // not merely for a disagreement: caught at the end of a phase there would
    // be only milliseconds before the stub flipped back and agreed by accident.
    let truth = await stubHealth('home', 'grafana')
    const staleBy = Date.now()
    while (Date.now() - staleBy < 15_000) {
      await sleep(150)
      const now = await stubHealth('home', 'grafana')
      const flipped = now !== truth
      truth = now
      if (flipped && !agrees(frozen, now)) break
    }
    const wentStale = !agrees(frozen, truth)
    const staleTruth = truth

    const t3 = Date.now()
    await setVisibility('visible')
    const reopened = await waitUntil(openStreams, 3, 5_000)
    let agreed = false
    let shown = ''
    while (Date.now() - t3 < 6_000 && !agreed) {
      truth = await stubHealth('home', 'grafana')
      shown = await grafana.innerText()
      agreed = agrees(shown, truth)
      if (!agreed) await sleep(200)
    }
    check(
      'a reconnect after a blackout shows the current world, not the stale one',
      wentStale && agreed && shown !== frozen && reopened === 3,
      `hidden, the row still read "${frozen.replace(/\n/g, ' | ')}" while the stub had moved to ` +
        `${staleTruth}; ${reopened} streams reopened and ${Date.now() - t3}ms later the row read ` +
        `"${shown.replace(/\n/g, ' | ')}" against a stub saying ${truth}`,
    )
  })

  // ---- 4. one instance drops, the other two carry on --------------------
  await step(
    [
      "one instance's stream dying leaves the other two updating",
      'and it never blanks the list',
      'and the dead instance reconnects on a backoff, not in a loop',
    ],
    async () => {
      await page.route('**/api/i/home/stream/**', (r) => r.abort())
      // The route only applies to new requests, so force home to reconnect into it.
      await setVisibility('hidden')
      await waitUntil(openStreams, 0, 5_000)
      await setVisibility('visible')
      const t4 = Date.now()
      await sleep(2_000) // past the reconnect replay, so what follows is a live change

      const others = { orders: row('grafana-orders'), utility: row('vault') }
      const startText = {
        orders: await others.orders.innerText(),
        utility: await others.utility.innerText(),
      }
      const [ordersChange, utilityChange] = await Promise.all([
        waitForChange(() => others.orders.innerText(), startText.orders, 12_000),
        waitForChange(() => others.utility.innerText(), startText.utility, 12_000),
      ])
      const changed = { orders: ordersChange, utility: utilityChange }
      const rows = await page.locator('a[href^="/apps/"]').count()
      // Watch home retry for a fixed window, or the count means nothing.
      await sleep(Math.max(0, 15_000 - (Date.now() - t4)))
      const homeAttempts = since(t4, /\/api\/i\/home\/stream\//).length
      check(
        "one instance's stream dying leaves the other two updating",
        changed.orders.changed && changed.utility.changed,
        `orders/grafana-orders changed after ${changed.orders.ms}ms, ` +
          `utility/vault after ${changed.utility.ms}ms, while every home stream request was aborted`,
      )
      check(
        'and it never blanks the list',
        rows === 99,
        `${rows} application rows still rendered with home's stream dead`,
      )
      check(
        'and the dead instance reconnects on a backoff, not in a loop',
        homeAttempts > 0 && homeAttempts < 12,
        `${homeAttempts} home stream attempts in ${Math.round((Date.now() - t4) / 1000)}s ` +
          `(backoff is 1s, 2s, 5s, 15s, 30s)`,
      )
    },
  )

  await browser.close()
  console.log(`\n== ${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`} ==`)
  if (failures > 0) process.exitCode = 1
}

guard(main)
