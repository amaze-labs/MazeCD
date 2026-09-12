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

const RELOAD_KEY = 'mazecd:reloaded-for-version'

/**
 * Three independent mechanisms keep a client from getting stuck on an old
 * build: the service worker's own update check, an explicit periodic check on
 * load / foreground / every minute, and a comparison against the version the
 * server reports.
 */
export function watchForUpdates(onAvailable: (apply: () => void) => void): () => void {
  let swTimer: number | undefined
  let onSWVisible: (() => void) | undefined

  const applySW = registerSW({
    onNeedRefresh() {
      onAvailable(() => applySW(true))
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return
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
      const serverVersion = body.version ?? ''

      let alreadyReloadedFor: string | null
      try {
        alreadyReloadedFor = sessionStorage.getItem(RELOAD_KEY)
      } catch {
        return // Storage unavailable: don't reload rather than risk a loop we can't suppress.
      }
      if (!shouldReload(serverVersion, __BUILD_VERSION__, alreadyReloadedFor)) return

      try {
        sessionStorage.setItem(RELOAD_KEY, serverVersion)
      } catch {
        return // Couldn't record the attempt: don't reload rather than risk a loop.
      }
      onAvailable(() => window.location.reload())
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
    window.clearInterval(versionTimer)
    document.removeEventListener('visibilitychange', onVisible)
    if (swTimer !== undefined) window.clearInterval(swTimer)
    if (onSWVisible) document.removeEventListener('visibilitychange', onSWVisible)
  }
}
