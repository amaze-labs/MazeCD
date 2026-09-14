import { Link } from 'react-router-dom'
import type { App } from '../api/types'
import { InstancePill, Revision, StatusBadge } from './ui'
import { bucketOf, surfaceOf, tinted } from '../lib/fleet'

/**
 * One application, one card, every fact exactly once.
 *
 * A resting application — Healthy and Synced — carries no badge at all. Its
 * quietness is the signal. Ninety-one green badges down a screen made the
 * only saturated thing on every card the loudest thing on the screen, which
 * is the exact inverse of the rule this design is built on: broken comes
 * forward, fine recedes. A badge now appears only when something is worth
 * looking at, which is what makes it worth looking at.
 *
 * When there is a badge it is the bucket, not the raw health field, so it
 * matches the counter chip that filtered the list to this card: an
 * application that is both degraded and out of sync is counted once, badged
 * once, and the detail screen is where both states are spelled out.
 *
 * The third line is ArgoCD's own `status.health.message` and nothing else. A
 * card with no message from ArgoCD stays two lines rather than printing a
 * sentence that only restates the badge.
 *
 * The namespace is dropped when it repeats the application name, which is
 * the common case for a chart deployed into its own namespace. Printing the
 * name twice on one card is exactly what this rebuild set out to stop.
 */
export function AppRow({ app, color }: { app: App; color: string }) {
  const bucket = bucketOf(app)
  const muted = tinted(bucket) ? 'text-muted-tint' : 'text-muted'
  const ns = app.destNamespace || app.project
  const where = ns === app.name ? '' : ns
  const resting = bucket === 'Healthy' && app.sync === 'Synced'
  return (
    <Link
      to={`/apps/${encodeURIComponent(app.instance)}/${encodeURIComponent(app.name)}`}
      className={`block rounded-card px-3 py-1.5 ${surfaceOf(bucket)}`}
    >
      <h2 className="t-name truncate text-[16px]">{app.name}</h2>
      <div className="mt-1 flex items-center gap-1.5">
        {!resting && <StatusBadge state={bucket} size="sm" />}
        <InstancePill name={app.instance} color={color} />
        <span className={`min-w-0 flex-1 truncate text-[12px] ${muted}`}>{where}</span>
        <Revision sha={app.revision} className={muted} />
      </div>
      {app.healthMessage && (
        <p
          className={`mt-1 line-clamp-2 text-[13px] leading-snug ${
            bucket === 'Degraded' ? 'text-text-degraded' : 'text-muted-tint'
          }`}
        >
          {app.healthMessage}
        </p>
      )}
    </Link>
  )
}
