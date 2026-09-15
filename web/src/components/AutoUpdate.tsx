import { useEffect } from 'react'
import { watchForUpdates } from '../lib/update'

/**
 * A new build is applied the moment it is known about, with nothing to tap.
 * This used to be a toast that waited for a tap while a sheet was open; on
 * the owner's phone it waited on every deploy, and the owner would rather
 * lose an open sheet than be asked. The worker reloads on its own when it
 * activates a new build; this covers the version poll, for a client with no
 * worker in control.
 */
export function AutoUpdate() {
  useEffect(() => watchForUpdates((apply) => apply()), [])
  return null
}
