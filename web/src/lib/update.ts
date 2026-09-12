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
 * Three independent mechanisms keep a client from getting stuck on an old
 * build: the service worker's own update check, an explicit periodic check on
 * load / foreground / every minute, and a comparison against the version the
 * server reports.
 */
export function watchForUpdates(onAvailable: (apply: () => void) => void): () => void {
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
      const timer = window.setInterval(check, 60_000)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
      window.addEventListener('beforeunload', () => window.clearInterval(timer))
    },
  })

  const pollVersion = async () => {
    try {
      const res = await fetch('/api/version', { cache: 'no-store', credentials: 'same-origin' })
      const body = (await res.json()) as { version?: string }
      if (isStale(body.version ?? '', __BUILD_VERSION__)) {
        onAvailable(() => window.location.reload())
      }
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
  }
}
