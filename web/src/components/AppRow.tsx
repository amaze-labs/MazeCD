import { Link } from 'react-router-dom'
import { Check, CornerDownRight, GitCompareArrows } from 'lucide-react'
import type { App } from '../api/types'
import { Badge, Rail, tint } from './ui'
import { bucketOf, healthLoud, verdictOf } from '../lib/fleet'
import { stateStyle } from '../lib/status'
import { ago } from '../lib/ago'
import { shortRev } from '../lib/rev'

/**
 * One application, as one dense row inside the list's card:
 *
 *   ▌ photo-library-ml                              [DEGRADED]
 *   ▌ home/personal · 4007d5e · 10 res · 1 down        ✓   7d
 *   ▌ ↳ readiness probe failed
 *
 * The badge is the verdict, the rail its colour down the left edge, and only
 * a row that needs looking at gets a rail at all — ninety-one healthy rows
 * have none, so the eye slides past them. A degraded row is tinted and
 * carries ArgoCD's reason on a third line; the reason is drawn only when
 * health is loud, because a message on a resting application qualifies
 * nothing.
 *
 * The right edge is one column down the whole list: the sync mark, `manual`
 * when ArgoCD will not reconcile this itself, and how long ago the last
 * operation finished.
 */
export function AppRow({ app }: { app: App }) {
  const bucket = bucketOf(app)
  const verdict = verdictOf(app, bucket)
  const s = stateStyle(verdict)
  const loud = healthLoud(app.health)
  // A running operation has not finished: its age is how long it has been
  // running, which is the more urgent number anyway.
  const running = app.operationPhase === 'Running' || app.operationPhase === 'Terminating'
  const stamp = running ? app.operationStartedAt : app.operationFinishedAt
  const when = ago(stamp)
  const unhealthy = app.unhealthyResources ?? 0
  const degraded = bucket === 'Degraded'

  return (
    <Link
      to={`/apps/${encodeURIComponent(app.instance)}/${encodeURIComponent(app.name)}`}
      className="relative block py-2 pr-3 pl-3.5 active:brightness-[var(--press)] [&+&]:border-t [&+&]:border-rule"
      style={degraded ? { background: `linear-gradient(${tint(s.color, 'var(--tint-row)')}, ${tint(s.color, 'var(--tint-row)')}), var(--color-panel)` } : { background: 'var(--color-panel)' }}
    >
      {bucket !== 'Healthy' && <Rail health={verdict} />}
      <div className="flex items-start gap-2">
        <span className="t-name min-w-0 flex-1 text-[15px] leading-[1.2] [overflow-wrap:anywhere]">
          {app.name}
        </span>
        <Badge state={verdict} className="mt-px" />
      </div>

      <div className="t-mono mt-[3px] flex items-center gap-[5px] text-[10.5px] whitespace-nowrap text-dim">
        <span className="min-w-0 truncate">
          <span className="text-muted">
            {app.instance}/{app.project}
          </span>
          <Dot />
          {shortRev(app.revision)}
          {app.totalResources !== undefined && (
            <>
              <Dot />
              {app.totalResources} res
            </>
          )}
          {unhealthy > 0 && (
            <>
              <Dot />
              <span className="text-degraded">{unhealthy} down</span>
            </>
          )}
        </span>
        <span className="flex-1" />
        {!app.autoSync && <span className="text-text">manual</span>}
        {app.sync === 'OutOfSync' ? (
          <GitCompareArrows size={12} strokeWidth={2.2} className="flex-none text-outofsync" aria-label="out of sync" />
        ) : app.sync === 'Synced' ? (
          <Check size={12} strokeWidth={2.8} className="flex-none text-healthy" aria-label="synced" />
        ) : null}
        {when ? (
          <time dateTime={stamp} title={running ? `running for ${when.long.replace(/ ago$/, '')}` : when.long} className="min-w-[22px] flex-none text-right">
            {when.short}
          </time>
        ) : (
          <span className="min-w-[22px] flex-none text-right text-rule" title="ArgoCD has no finished operation recorded for this application">
            –
          </span>
        )}
      </div>

      {loud && app.healthMessage && (
        <p className="t-mono mt-1 flex gap-[5px] text-[10.5px] leading-[1.35]" style={{ color: s.color }}>
          <CornerDownRight size={12} strokeWidth={2.2} className="mt-px flex-none" aria-hidden="true" />
          <span className="line-clamp-2">{app.healthMessage}</span>
        </p>
      )}
    </Link>
  )
}

/** The separator between two facts on a row. */
function Dot() {
  return (
    <span className="mx-[5px] text-[var(--edge-strong)]" aria-hidden="true">
      ·
    </span>
  )
}
