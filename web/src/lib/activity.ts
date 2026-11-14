import type { App } from '../api/types'

/**
 * The fleet's last operations as a feed: what changed, and when.
 *
 * ArgoCD keeps one operation per application in `status.operationState` — the
 * last one — so this is not a history, it is the most recent thing that
 * happened to each application, newest first. That is exactly what "what
 * changed since yesterday?" needs, and it comes out of the list MazeCD already
 * holds, without a request per application.
 */
export type Entry = {
  app: App
  /** When it finished, or when it started for one still running. */
  at: number
  phase: string
  running: boolean
  failed: boolean
  /** Started by ArgoCD itself, rather than by a person. */
  automated: boolean
}

export function toEntries(apps: App[]): Entry[] {
  const out: Entry[] = []
  for (const app of apps) {
    const phase = app.operationPhase ?? ''
    const running = phase === 'Running' || phase === 'Terminating'
    const when = running ? app.operationStartedAt : app.operationFinishedAt
    const at = when ? Date.parse(when) : NaN
    if (Number.isNaN(at)) continue
    out.push({
      app,
      at,
      phase,
      running,
      failed: phase === 'Failed' || phase === 'Error',
      automated: app.operationInitiator === 'automated',
    })
  }
  return out.sort((a, b) => b.at - a.at || a.app.name.localeCompare(b.app.name))
}

const DAY = 86_400_000
const startOfDay = (t: number) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** The heading a day's entries sit under, in the phone's own time zone:
 * Today, Yesterday, a weekday for the rest of the week, then a date. */
export function dayLabel(at: number, now: number = Date.now()): { title: string; date: string } {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY)
  const d = new Date(at)
  const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toLowerCase()
  if (days <= 0) return { title: 'Today', date }
  if (days === 1) return { title: 'Yesterday', date }
  if (days < 7) return { title: d.toLocaleDateString('en-GB', { weekday: 'long' }), date: date.replace(/^\w+ /, '') }
  return { title: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }), date: String(d.getFullYear()) }
}

/** Entries grouped under their day, in order. */
export function byDay(entries: Entry[], now: number = Date.now()) {
  const groups: { key: number; label: { title: string; date: string }; entries: Entry[] }[] = []
  for (const e of entries) {
    const key = startOfDay(e.at)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.entries.push(e)
    else groups.push({ key, label: dayLabel(e.at, now), entries: [e] })
  }
  return groups
}
