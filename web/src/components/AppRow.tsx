import { Link } from 'react-router-dom'
import { CornerDownRight } from 'lucide-react'
import type { App } from '../api/types'
import { AutoMark, Rail, SyncWord } from './ui'
import { healthLoud } from '../lib/fleet'
import { stateStyle } from '../lib/status'
import { ago } from '../lib/ago'
import { shortRev } from '../lib/rev'

/**
 * One application: a rail, then three lines whose right edges align into one
 * column of verdicts running the length of the list — health, then
 * sync-and-auto, then age. On the left: the name, then where it lives, then
 * its numbers. No card, no radius, no shadow, no fill. Rows are parted by one
 * hairline and nothing else.
 *
 *   ▌ photo-library-ml                            Degraded
 *   ▌ home │ personal          ✓ Synced        ⚡
 *   ▌ 0afbe11 │ 20 res │ 1 down          1 day ago
 *   ▌ ↳ readiness probe failed
 *
 * EVERY ROW STATES ALL THREE FACTS — health, sync, auto-sync — including the
 * ninety-one that are fine. What varies is emphasis, not presence: `Healthy`
 * and `Synced` are grey and the auto bolt is a hairline; `Degraded`,
 * `OutOfSync` and the struck bolt of `manual` are the only things that speak.
 * A design that goes silent on the calm case cannot be told apart from one
 * that failed to draw it, and ninety-one green verdicts would emphasise
 * nothing at all.
 *
 * The verdict is *health*, not the triage bucket: `cert-manager` is Healthy
 * and OutOfSync, and those are two independent facts sitting on two lines.
 * The rail agrees with the verdict, because its colour is health too.
 *
 * The reason line is drawn only when health is loud. ArgoCD's message on a
 * resting application qualifies nothing, and a red sentence under a green
 * rail would claim an emergency the data does not report.
 */
export function AppRow({ app }: { app: App }) {
  const s = stateStyle(app.health)
  const loud = healthLoud(app.health)
  const when = ago(app.operationFinishedAt)
  const unhealthy = app.unhealthyResources ?? 0

  return (
    <Link
      to={`/apps/${encodeURIComponent(app.instance)}/${encodeURIComponent(app.name)}`}
      className="flex gap-[13px] border-b border-rule py-3 pr-4 pl-[13px] active:bg-band"
    >
      <Rail health={app.health} auto={app.autoSync} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2.5">
          <span className="t-name truncate text-[15.5px]">{app.name}</span>
          <span
            className={`flex-none text-[13px] whitespace-nowrap ${loud ? 'font-[560]' : 'font-medium text-muted'}`}
            style={loud ? { color: s.color } : undefined}
          >
            {s.label}
          </span>
        </div>

        <div className="t-mono mt-1 flex items-baseline justify-between gap-2.5 text-[11.5px]">
          <span className="truncate text-muted">
            <span className="text-text">{app.instance}</span>
            <i className="sep" aria-hidden="true" />
            {app.project}
          </span>
          <span className="flex flex-none items-center gap-2.5">
            <SyncWord sync={app.sync} />
            <AutoMark auto={app.autoSync} />
          </span>
        </div>

        <div className="t-mono mt-1 flex items-baseline justify-between gap-2.5 text-[11.5px] text-dim">
          <span className="truncate">
            {shortRev(app.revision)}
            {app.totalResources !== undefined && (
              <>
                <i className="sep" aria-hidden="true" />
                {app.totalResources} res
              </>
            )}
            {unhealthy > 0 && (
              <>
                <i className="sep" aria-hidden="true" />
                <span className="text-degraded">{unhealthy} down</span>
              </>
            )}
          </span>
          {when ? (
            <time dateTime={app.operationFinishedAt} className="flex-none">
              {when.long}
            </time>
          ) : (
            <span
              className="flex-none text-rule"
              title="ArgoCD has no operation recorded for this application"
            >
              –
            </span>
          )}
        </div>

        {loud && app.healthMessage && (
          <p
            className="mt-2 flex gap-[7px] text-[11px] leading-[1.35]"
            style={{ color: s.color }}
          >
            <CornerDownRight size={11} strokeWidth={1.2} className="mt-0.5 flex-none" aria-hidden="true" />
            <span className="line-clamp-2">{app.healthMessage}</span>
          </p>
        )}
      </div>
    </Link>
  )
}
