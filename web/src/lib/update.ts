import { registerSW } from 'virtual:pwa-register'

/**
 * A build labelled `dev` is a local build, and an empty server version means
 * the check itself failed: neither must trigger a reload, or the app would
 * reload in a loop.
 */
export function isStale(serverVersion: string, bundleVersion: string): boolean {
  if (!serverVersion || bundleVersion === 'dev' || serverVersion === 'dev') return false
  return serverVersion !== bundleVersion
}

/**
 * A reload already attempted for this exact server version must not repeat.
 * Without this circuit breaker, a deployment where the binary and the bundle
 * can never agree (a CI step that updates one but not the other) would
 * reload forever instead of settling on a stale-but-working app -- and a
 * loop is strictly worse than the staleness this module exists to prevent.
 */
export function shouldReload(
  serverVersion: string,
  bundleVersion: string,
  alreadyReloadedFor: string | null,
): boolean {
  return isStale(serverVersion, bundleVersion) && serverVersion !== alreadyReloadedFor
}

export const RELOAD_KEY = 'mazecd:reloaded-for-version'

/**
 * Offers a reload only when `shouldReload` allows it, and records the server
 * version in `sessionStorage` only at the moment the reload is actually
 * applied -- never merely offered. A reload the user (or the auto-apply
 * timer) never actually makes must not block a future re-offer of that same
 * version, e.g. after a rollback. Storage failures fail toward not reloading
 * -- skipping the offer, or refusing to apply -- never toward reloading
 * without a way to remember it, which would risk the very loop this exists
 * to prevent. Offering the same version repeatedly (a poll tick while the
 * toast is already standing) is harmless: it just re-arms an equivalent
 * apply function.
 *
 * `reload` is how the new build is actually brought in. A plain
 * location.reload() is only right when no service worker is in control: the
 * version poll usually wins the race against the worker's own update, and
 * reloading while the old worker still serves the precached shell returns
 * the same stale bundle -- after which the circuit breaker suppresses this
 * watcher for that version for good. The caller passes an apply that
 * activates the waiting worker when there is a registration.
 */
export function checkVersion(
  serverVersion: string,
  bundleVersion: string,
  onAvailable: (apply: () => void) => void,
  reload: () => void = () => window.location.reload(),
): void {
  let alreadyReloadedFor: string | null
  try {
    alreadyReloadedFor = sessionStorage.getItem(RELOAD_KEY)
  } catch {
    return // Storage unavailable: don't offer a reload we can't remember making.
  }
  if (!shouldReload(serverVersion, bundleVersion, alreadyReloadedFor)) return

  onAvailable(() => {
    try {
      sessionStorage.setItem(RELOAD_KEY, serverVersion)
    } catch {
      return // Couldn't record the attempt: don't reload rather than risk a loop.
    }
    reload()
  })
}

/**
 * Three independent mechanisms keep a client from getting stuck on an old
 * build: the service worker's own update check, an explicit periodic check on
 * load / foreground / every minute, and a comparison against the version the
 * server reports.
 */
export function watchForUpdates(onAvailable: (apply: () => void) => void): () => void {
  // registerSW's onRegisteredSW fires once the registration promise resolves
  // -- asynchronously, and possibly after this effect has already been torn
  // down (React StrictMode mounts, cleans up, and remounts synchronously,
  // well before that promise settles). Without this flag, a teardown that
  // lands first clears nothing (there is nothing yet to clear), and the
  // interval and listener onRegisteredSW then sets up outlive it forever.
  let cancelled = false
  let swTimer: number | undefined
  let onSWVisible: (() => void) | undefined
  let swRegistration: ServiceWorkerRegistration | undefined

  const applySW = registerSW({
    onNeedRefresh() {
      onAvailable(() => applySW(true))
    },
    onRegisteredSW(_url, registration) {
      if (cancelled || !registration) return
      swRegistration = registration
      const check = () => {
        if (navigator.onLine) void registration.update().catch(() => {})
      }
      check()
      swTimer = window.setInterval(check, 60_000)
      onSWVisible = () => {
        if (document.visibilityState === 'visible') check()
      }
      document.addEventListener('visibilitychange', onSWVisible)
    },
  })

  const pollVersion = async () => {
    try {
      const res = await fetch('/api/version', { cache: 'no-store', credentials: 'same-origin' })
      const body = (await res.json()) as { version?: string }
      // With a worker registered, hand off to it: it activates the waiting
      // build and reloads once, instead of reloading into the shell the old
      // worker is still serving. location.reload() stays the fallback for
      // the case this poll genuinely exists for -- no worker at all.
      checkVersion(body.version ?? '', __BUILD_VERSION__, onAvailable, () =>
        swRegistration ? applySW(true) : window.location.reload(),
      )
    } catch {
      // Offline or mid-deploy: the next tick tries again.
    }
  }
  void pollVersion()
  const versionTimer = window.setInterval(pollVersion, 60_000)
  const onVisible = () => {
    if (document.visibilityState === 'visible') void pollVersion()
  }
  document.addEventListener('visibilitychange', onVisible)

  return () => {
    cancelled = true
    window.clearInterval(versionTimer)
    document.removeEventListener('visibilitychange', onVisible)
    if (swTimer !== undefined) window.clearInterval(swTimer)
    if (onSWVisible) document.removeEventListener('visibilitychange', onSWVisible)
  }
}
