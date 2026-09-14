#!/usr/bin/env node
// Proves the one thing MazeCD must do before any feature: a client that is
// already open picks up a new build when the deployment is replaced under it.
// Run as `npm run redeploy` from web/. Needs Docker; everything it builds and
// starts is removed on the way out.
//
// This cannot be a unit test, and that is the point. The failure it exists to
// catch -- a waiting service worker that is told to activate and never does,
// because the *active* one is still piping MazeCD's never-ending ArgoCD watch
// streams and Chromium will not activate over a worker that still has work --
// only exists when there is a real worker, real streams and two real builds.
// Every unit test in web/src/lib/update.test.ts passed while a running client
// stayed on the old bundle indefinitely.
//
// So: two images from this working tree at two different VERSIONs, the first
// one running, a signed-in client open against it with its streams up, then
// the container replaced by the second image on the same port and the same
// session key. What the open client is *executing* is read off the hashed
// module script in its own document, which differs between the two builds.
//
// Two things a container makes awkward, both handled below. dev/stubargo
// binds 127.0.0.1, so nothing outside its own network namespace can reach it:
// the app container joins the stub's namespace rather than the other way
// round, and the port is published on the stub. And port 8080 is usually
// already taken by a dev mazecd, so this asks the kernel for a free one.
import { createServer } from 'node:net'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { cleanup, devDir, phone, root, sleep } from './harness.mjs'

const STUB = 'mazecd-redeploy-stub'
const NET = 'mazecd-redeploy-net' // the stub container: also the network namespace
const APP = 'mazecd-redeploy-app'
const IMAGE = 'mazecd-redeploy'
const PASSWORD = 'redeploy-check-password'
const SESSION_KEY = 'cmVkZXBsb3ktY2hlY2stc2Vzc2lvbi1rZXktMzJieXRlcw=='
const workDir = path.join(devDir, '.bin', 'redeploy')

const docker = (...args) => execFileSync('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
const quietly = (fn) => { try { return fn() } catch { /* already gone */ } }

/** A port nothing is listening on, so a stray dev server cannot fail this. */
function freePort() {
  return new Promise((resolve) => {
    const srv = createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

function build() {
  mkdirSync(workDir, { recursive: true })

  // The stub, as an image, because the app container has to reach it on
  // 127.0.0.1 and that is only true inside one shared network namespace.
  execFileSync('go', ['build', '-o', path.join(workDir, 'stubargo'), './dev/stubargo'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CGO_ENABLED: '0', GOOS: 'linux', GOARCH: process.arch === 'x64' ? 'amd64' : 'arm64' },
  })
  writeFileSync(path.join(workDir, 'Dockerfile'),
    'FROM gcr.io/distroless/static:nonroot\nCOPY stubargo /stubargo\nENTRYPOINT ["/stubargo"]\n')
  docker('build', '-q', '-t', `${STUB}:latest`, workDir)

  // 0.0.0.0, not the 127.0.0.1 of dev/config.yaml: a published port reaches
  // the container from outside, which a loopback listener refuses.
  writeFileSync(path.join(workDir, 'config.yaml'), `listen: "0.0.0.0:8080"
instances:
  - name: home
    url: http://127.0.0.1:9081
    token: stub-dev-token
    color: "#3b82f6"
  - name: orders
    url: http://127.0.0.1:9082
    token: stub-dev-token
    color: "#22c55e"
  - name: utility
    url: http://127.0.0.1:9083
    token: stub-dev-token
    color: "#f59e0b"
`)

  for (const version of ['1.0.0', '1.0.1']) {
    console.log(`== building ${IMAGE}:${version} ==`)
    execFileSync('docker', ['build', '-q', '-f', 'docker/Dockerfile',
      '--build-arg', `VERSION=${version}`, '-t', `${IMAGE}:${version}`, '.'],
      { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] })
  }
}

async function main() {
  build()
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  // The image's own `mazecd hash`, so this needs no local Go build.
  const passwordHash = execFileSync('docker', ['run', '--rm', '-i', `${IMAGE}:1.0.0`, 'hash'],
    { input: PASSWORD + '\n', encoding: 'utf8' }).trim()

  /** Replaces the running container with `version`, the way a deploy does:
   * same port, same session key, so the open client stays signed in. */
  async function deploy(version) {
    quietly(() => docker('rm', '-f', APP))
    docker('run', '-d', '--name', APP, '--network', `container:${NET}`,
      '-e', 'MAZECD_CONFIG=/etc/mazecd/config.yaml',
      '-e', `MAZECD_PASSWORD_HASH=${passwordHash}`,
      '-e', `MAZECD_SESSION_KEY=${SESSION_KEY}`,
      '-v', `${path.join(workDir, 'config.yaml')}:/etc/mazecd/config.yaml:ro`,
      `${IMAGE}:${version}`)
    for (let i = 0; i < 300; i++) {
      try {
        const served = (await (await fetch(`${base}/api/version`)).json()).version
        if (served === version) return
      } catch { /* still starting */ }
      await sleep(100)
    }
    throw new Error(`${IMAGE}:${version} never reported itself on ${base}`)
  }

  /** The hashed module script index.html currently points at: one build's
   * identity, and different between the two because the version is compiled in. */
  async function servedBundle() {
    const html = await (await fetch(`${base}/index.html`, { cache: 'no-store' })).text()
    return html.match(/src="(\/assets\/index-[^"]+\.js)"/)[1]
  }
  /** The one the open page is running, which is the whole question. */
  const runningBundle = (page) =>
    page.evaluate(() => document.querySelector('script[type=module]')?.getAttribute('src')).catch(() => null)

  async function waitForBundle(page, want, limitMs, since) {
    while (Date.now() - since < limitMs) {
      if ((await runningBundle(page)) === want) return ((Date.now() - since) / 1000).toFixed(1)
      await sleep(250)
    }
    return null
  }

  docker('run', '-d', '--name', NET, '-p', `${port}:8080`, `${STUB}:latest`)
  await deploy('1.0.0')
  const oldBundle = await servedBundle()

  const { page } = await phone()
  await page.goto(base)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('heading', { name: 'Applications' }).waitFor()
  // A first visit installs the worker but is not yet controlled by it, and an
  // uncontrolled page cannot be served a stale bundle. Reload until it is --
  // the session is a cookie, so this is still the same signed-in client.
  for (let i = 0; i < 5; i++) {
    await page.reload()
    await page.getByRole('heading', { name: 'Applications' }).waitFor()
    if (await page.evaluate(() => !!navigator.serviceWorker.controller)) break
    await sleep(1000)
  }
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
    throw new Error('no service worker ever took control; there is nothing to test')
  }
  // The streams are what made this fail: give them a moment to be up.
  await page.getByText('Connected').first().waitFor({ state: 'attached' }).catch(() => {})
  console.log(`\n== signed in on 1.0.0, worker in control, running ${oldBundle} ==`)

  const failures = []

  // ---- 1. the deploy, under an open client ------------------------------
  const t0 = Date.now()
  await deploy('1.0.1')
  const newBundle = await servedBundle()
  if (newBundle === oldBundle) throw new Error('both images ship the same bundle; nothing to measure')
  const toast = await page.getByText('A newer build of MazeCD is ready.')
    .waitFor({ timeout: 120_000 })
    .then(() => ((Date.now() - t0) / 1000).toFixed(1), () => null)
  console.log(`1. the toast appeared at ${toast === null ? 'NEVER' : `+${toast}s`}`)
  const applied = await waitForBundle(page, newBundle, 180_000, t0)
  if (applied === null) {
    failures.push(`an open client was still running ${oldBundle} 180s after the deploy`)
    console.log(`   the open client is STILL RUNNING ${await runningBundle(page)}`)
  } else {
    console.log(`   the open client is running the new bundle at +${applied}s`)
  }

  // ---- 2. the case that already worked, and must keep working ------------
  // App closed before the deploy: the old precached shell is served first and
  // the client has to heal itself on its own.
  await page.close()
  await deploy('1.0.0')
  const t1 = Date.now()
  const { page: reopened } = await phone()
  await reopened.goto(base)
  const healed = await waitForBundle(reopened, oldBundle, 60_000, t1)
  if (healed === null) failures.push('a cold open never healed to the deployed bundle')
  console.log(`2. a cold open healed to the deployed bundle at ${healed === null ? 'NEVER' : `+${healed}s`}`)

  // The sessionStorage circuit breaker is not checked here: it needs no
  // container to provoke and web/src/lib/update.test.ts already pins it.

  if (failures.length) {
    for (const f of failures) console.error(`\nFAIL: ${f}`)
    throw new Error(`${failures.length} check(s) failed`)
  }
  console.log('\nBoth hold.')
}

// Containers and images both: this leaves nothing behind on the machine.
async function teardown() {
  await cleanup()
  quietly(() => docker('rm', '-f', APP))
  quietly(() => docker('rm', '-f', NET))
  quietly(() => docker('rmi', '-f', `${IMAGE}:1.0.0`, `${IMAGE}:1.0.1`, `${STUB}:latest`))
}

main()
  .then(teardown)
  .catch(async (err) => {
    console.error(err)
    await teardown()
    process.exitCode = 1
  })
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => { await teardown(); process.exit(1) })
}
