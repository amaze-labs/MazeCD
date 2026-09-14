// The dev harness: stub ArgoCD on three ports, the real mazecd binary against
// it, and the Vite dev server in front. Shared by `npm run shoot` (screenshots)
// and `npm run live` (live-update verification) so there is one way to boot
// the stack and one way to tear it down.
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

export const devDir = path.dirname(fileURLToPath(import.meta.url))
export const root = path.resolve(devDir, '..')
export const webDir = path.join(root, 'web')

const binDir = path.join(devDir, '.bin')
const MAZECD_ADDR = '127.0.0.1:8080'
const VITE_PORT = 5173
const DEV_PASSWORD = 'harness-dev-password'

/** The Vite dev server's origin: what the browser is pointed at. */
export const base = `http://127.0.0.1:${VITE_PORT}`
/** The three stub ArgoCD instances, by name, as ground truth to check against. */
export const stubPorts = { home: 9081, orders: 9082, utility: 9083 }

const children = []
function trackedSpawn(cmd, args, opts) {
  const child = spawn(cmd, args, opts)
  children.push(child)
  return child
}

export async function cleanup() {
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

export function sleep(ms) {
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

/** Builds and starts the whole stack, and waits until every part answers. */
export async function boot() {
  mkdirSync(binDir, { recursive: true })

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

  console.log('== starting stub ArgoCD (dev/stubargo) ==')
  trackedSpawn(path.join(binDir, 'stubargo'), [], { cwd: root, stdio: 'inherit' })
  await Promise.all(
    Object.values(stubPorts).map((p) => waitForHttp(`http://127.0.0.1:${p}/api/v1/session/userinfo`)),
  )

  console.log('== starting mazecd against the stub ==')
  trackedSpawn(path.join(binDir, 'mazecd'), ['serve'], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      MAZECD_CONFIG: path.join(devDir, 'config.yaml'),
      MAZECD_PASSWORD_HASH: hashRes.stdout.trim(),
      MAZECD_SESSION_KEY: randomBytes(32).toString('base64'),
    },
  })
  await waitForHttp(`http://${MAZECD_ADDR}/api/version`)

  // The Vite dev server, not the built PWA: it already proxies /api to
  // MAZECD_ADDR (see web/vite.config.ts), needs no build step, and skips
  // the PWA service worker entirely -- one less thing that can serve stale
  // content and make two runs disagree.
  console.log('== starting the Vite dev server ==')
  trackedSpawn(
    path.join(webDir, 'node_modules', '.bin', 'vite'),
    ['--port', String(VITE_PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: webDir, stdio: 'inherit' },
  )
  await waitForHttp(base)
}

/** playwright lives in web/node_modules (it is web's devDependency); a plain
 * `import('playwright')` would resolve relative to this file's ancestors. */
export function playwright() {
  return createRequire(path.join(webDir, 'package.json'))('playwright')
}

/** A browser context the size and shape of the phone MazeCD is built for.
 * `colorScheme` drives `prefers-color-scheme`, which is the only input the
 * app's default theme has -- so passing 'light' here renders the light theme
 * through exactly the path a real phone uses, rather than through a switch
 * the harness flipped. */
export async function phone({ colorScheme } = {}) {
  const { chromium, devices } = playwright()
  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    colorScheme,
    userAgent: devices['iPhone 15 Pro'].userAgent,
  })
  return { browser, page: await context.newPage() }
}

/** Through the real login screen, to the application list. */
export async function signIn(page) {
  await page.goto(base)
  await page.locator('input[type="password"]').fill(DEV_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('heading', { name: 'Applications' }).waitFor()
}

/** What the stub itself currently says about one application: ground truth. */
export async function stubHealth(instance, name) {
  const res = await fetch(`http://127.0.0.1:${stubPorts[instance]}/api/v1/applications/${name}`)
  return (await res.json()).status.health.status
}

/** Runs `main`, then tears the stack down whatever happened. */
export function guard(main) {
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
}
