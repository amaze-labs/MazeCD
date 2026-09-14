#!/usr/bin/env node
// Boots the whole MazeCD dev harness -- stub ArgoCD, the real mazecd binary,
// the Vite dev server -- logs in through the real login screen, and
// screenshots five screens at iPhone 15 Pro size. Run as `npm run shoot`
// from web/. Everything it starts is killed on exit, success or failure.
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const devDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(devDir, '..')
const webDir = path.join(root, 'web')
const binDir = path.join(devDir, '.bin')
const shotsDir = path.join(devDir, 'shots')

const MAZECD_ADDR = '127.0.0.1:8080'
const VITE_PORT = 5173
const DEV_PASSWORD = 'harness-dev-password'

mkdirSync(binDir, { recursive: true })
mkdirSync(shotsDir, { recursive: true })

const children = []
function trackedSpawn(cmd, args, opts) {
  const child = spawn(cmd, args, opts)
  children.push(child)
  return child
}

async function cleanup() {
  for (const child of children.reverse()) {
    if (child.exitCode !== null || child.killed) continue
    child.kill('SIGTERM')
  }
  // Give them a moment to exit, then insist.
  await sleep(500)
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill('SIGKILL')
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitForHttp(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let lastErr
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status === 404) return
    } catch (err) {
      lastErr = err
    }
    await sleep(150)
  }
  throw new Error(`timed out waiting for ${url}: ${lastErr}`)
}

function run(cmd, args, opts) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited ${res.status}`)
  }
}

async function main() {
  console.log('== building stubargo and mazecd ==')
  run('go', ['build', '-o', path.join(binDir, 'stubargo'), './dev/stubargo'], { cwd: root })
  run('go', ['build', '-o', path.join(binDir, 'mazecd'), './cmd/mazecd'], { cwd: root })

  console.log('== hashing the dev password ==')
  const hashRes = spawnSync(path.join(binDir, 'mazecd'), ['hash'], {
    input: DEV_PASSWORD + '\n',
    encoding: 'utf8',
  })
  if (hashRes.status !== 0) {
    throw new Error(`mazecd hash failed: ${hashRes.stderr}`)
  }
  const passwordHash = hashRes.stdout.trim()
  const sessionKey = randomBytes(32).toString('base64')

  console.log('== starting stub ArgoCD (dev/stubargo) ==')
  trackedSpawn(path.join(binDir, 'stubargo'), [], { cwd: root, stdio: 'inherit' })
  await Promise.all(
    [9081, 9082, 9083].map((p) => waitForHttp(`http://127.0.0.1:${p}/api/v1/session/userinfo`)),
  )

  console.log('== starting mazecd against the stub ==')
  trackedSpawn(path.join(binDir, 'mazecd'), ['serve'], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      MAZECD_CONFIG: path.join(devDir, 'config.yaml'),
      MAZECD_PASSWORD_HASH: passwordHash,
      MAZECD_SESSION_KEY: sessionKey,
    },
  })
  await waitForHttp(`http://${MAZECD_ADDR}/api/version`)

  // The Vite dev server, not the built PWA: it already proxies /api to
  // MAZECD_ADDR (see web/vite.config.ts), needs no build step, and skips
  // the PWA service worker entirely -- one less thing that can serve stale
  // content and make two runs of this script disagree.
  console.log('== starting the Vite dev server ==')
  trackedSpawn(
    path.join(webDir, 'node_modules', '.bin', 'vite'),
    ['--port', String(VITE_PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: webDir, stdio: 'inherit' },
  )
  await waitForHttp(`http://127.0.0.1:${VITE_PORT}/`)

  console.log('== driving the browser ==')
  // playwright lives in web/node_modules (it is web's devDependency); a
  // plain `import('playwright')` would resolve relative to this file's
  // ancestors, not web/, so require it explicitly from there.
  const require = createRequire(path.join(webDir, 'package.json'))
  const { chromium, devices } = require('playwright')
  const iphone = devices['iPhone 15 Pro']
  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: iphone.userAgent,
  })
  const page = await context.newPage()

  const base = `http://127.0.0.1:${VITE_PORT}`
  const shot = (name) => page.screenshot({ path: path.join(shotsDir, name) })

  await page.goto(base)
  await page.locator('input[type="password"]').fill(DEV_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('heading', { name: 'Applications' }).waitFor()
  // Let the two 8s-poll queries (apps, instances) resolve fully.
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
  await page.getByRole('button', { name: /healthy/ }).click()
  await page.waitForTimeout(200)
  await shot('06-apps-list-healthy.png')

  await page.goto(`${base}/settings`)
  await page.getByRole('heading', { name: 'Settings' }).waitFor()
  await page.getByText('Connected').first().waitFor()
  await shot('05-settings.png')

  await browser.close()
  console.log(`== done: screenshots in ${shotsDir} ==`)
}

main()
  .then(() => cleanup())
  .catch(async (err) => {
    console.error(err)
    await cleanup()
    process.exitCode = 1
  })

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await cleanup()
    process.exit(1)
  })
}
