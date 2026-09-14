import { Link } from 'react-router-dom'
import { Component, TriangleAlert } from 'lucide-react'
import type { App } from '../api/types'
import { InstancePill, Revision, tint } from './ui'
import { bucketOf, surfaceOf, tinted } from '../lib/fleet'
import { stateStyle } from '../lib/status'
import { ago } from '../lib/ago'

/**
 * One application, one card — as a grid with three fixed tracks, so the same
 * fact sits at the same x on all ninety-nine rows and an eye runs down one
 * column instead of reading every row whole.
 *
 *   ┌──────┬────────────────────────────────┬──────┐
 *   │  4m  │ photo-library-ml                      │  14  │
 *   │      │ ⚠ Degraded  home  ledger  0af…│  ⚠ 2 │
 *   └──────┴────────────────────────────────┴──────┘
 *     age            name / meta             resources
 *
 * **The age is the largest thing on the row.** On a fleet list a name is an
 * address, not news: you already know which application you came for, or you
 * typed it into the search box, and ninety-nine names are a directory. The
 * one fact that separates "this is fine" from "go and look" — and that
 * nothing else on the row reports — is how long ago ArgoCD last acted on it.
 * A degraded border beside `4m` is a sync that just failed; the same border
 * beside `26d` is something that has been quietly broken for a month. Those
 * are different emergencies and neither the badge, the border nor the health
 * message can tell them apart. That is the number worth the type.
 *
 * Large is not the same as loud. The age is drawn in muted grey on every row,
 * resting or not, so ninety-one healthy applications read as a calm column of
 * times rather than as ninety-one alarms; the colour on a row belongs to the
 * border and to the state word, which are the things that actually mean
 * something is wrong. And the age is deliberately not tinted by state: this
 * is when the last *operation* finished, not how long the application has
 * been degraded, and colouring it red would claim a duration ArgoCD never
 * reported.
 *
 * Both numeric columns are fixed-width and `tabular-nums`, so `4m` and `26d`
 * occupy the same space and the column does not dance from one row to the
 * next. What a row cannot know it says so: an application with no operation
 * ever recorded gets a placed dash in the rule colour rather than a zero, and
 * an instance that reported no resource list at all gets the same mark rather
 * than a fabricated "0 resources".
 *
 * The border carries state, the way `.treno.parte` does on the board this is
 * modelled after: every card reserves the same 1px so nothing changes height
 * when a state arrives, and only its colour moves. The state *word* stays,
 * because colour alone is not information for everyone — but it is now flat
 * text beside its icon rather than a filled pill, since a filled pill inside
 * a card that is already outlined in the same colour says one thing twice.
 *
 * The resting application still says nothing it does not have to: no state
 * word, no unhealthy count, no health message. It carries twice the facts it
 * did and stays quiet.
 */
export function AppRow({ app, color }: { app: App; color: string }) {
  const bucket = bucketOf(app)
  const state = stateStyle(bucket)
  const Icon = state.icon
  const muted = tinted(bucket) ? 'text-muted-tint' : 'text-muted'
  const resting = bucket === 'Healthy' && app.sync === 'Synced'
  const when = ago(app.operationFinishedAt)
  // The project earns its place only when it is not already on the row: a
  // "home" chip beside the word "home" is the duplication this rebuild
  // exists to remove, and most fleets name at least one project after the
  // instance it lives on.
  const project = app.project === app.instance ? '' : app.project
  const unhealthy = app.unhealthyResources ?? 0

  return (
    <Link
      to={`/apps/${encodeURIComponent(app.instance)}/${encodeURIComponent(app.name)}`}
      className={`grid grid-cols-[3.25rem_minmax(0,1fr)_2.25rem] items-center gap-x-2.5 rounded-card border px-2.5 py-1.5 ${surfaceOf(bucket)}`}
      style={{
        // Full status colour only for the two buckets that need acting on --
        // the same predicate the tinted ground uses, so the two never
        // disagree. At full strength a Suspended or an Unknown card drew the
        // brightest outline on the screen for a state nobody has to do
        // anything about, which inverts the one rule this design has.
        borderColor: resting
          ? 'var(--color-rule)'
          : tinted(bucket)
            ? state.color
            : tint(state.color, 45),
      }}
    >
      {when ? (
        <time
          dateTime={app.operationFinishedAt}
          title={`last operation finished ${when.long}`}
          className={`col-start-1 row-span-2 text-right text-[20px] leading-none font-semibold tabular-nums ${muted}`}
        >
          {when.short}
        </time>
      ) : (
        <span
          title="ArgoCD has no operation recorded for this application"
          className="col-start-1 row-span-2 text-right text-[20px] leading-none text-rule"
        >
          –
        </span>
      )}

      <h2 className="t-name col-start-2 row-start-1 truncate text-[15px]">{app.name}</h2>

      <div className="col-start-2 row-start-2 mt-0.5 flex min-w-0 items-center gap-1.5">
        {!resting && (
          <span
            className="flex shrink-0 items-center gap-1 text-[12px] font-medium"
            style={{ color: state.color }}
          >
            <Icon size={13} strokeWidth={2.4} className={state.spin ? 'spin' : ''} aria-hidden="true" />
            {state.label}
          </span>
        )}
        <InstancePill name={app.instance} color={color} />
        <span className={`min-w-0 flex-1 truncate text-[12px] ${muted}`}>{project}</span>
        <Revision sha={app.revision} className={muted} />
      </div>

      {/* The count is a fixed-width field, `.scarto`'s trick: shrink-wrapped,
          `4` pushed its mark 8px further right than `19` did and the marks
          drew a ragged edge down the column; stretched across the track
          instead, the mark and its number drifted apart far enough to stop
          reading as one thing. A minimum width on the digits alone holds the
          column straight and keeps the pair together. */}
      <div className="col-start-3 row-span-2 tabular-nums">
        {app.totalResources === undefined ? (
          <span
            title="this instance reported no resource list for this application"
            className="block text-right text-[13px] text-rule"
          >
            –
          </span>
        ) : (
          <>
            <span
              title={`${app.totalResources} resources`}
              className={`flex items-center justify-end gap-1 text-[13px] leading-tight ${muted}`}
            >
              <Component size={11} strokeWidth={2.2} aria-hidden="true" />
              <span className="min-w-[1.3rem] text-right">{app.totalResources}</span>
            </span>
            {unhealthy > 0 && (
              <span
                title={`${unhealthy} of them not healthy`}
                className="flex items-center justify-end gap-1 text-[11px] leading-tight font-semibold text-degraded"
              >
                <TriangleAlert size={11} strokeWidth={2.4} aria-hidden="true" />
                <span className="min-w-[1.3rem] text-right">{unhealthy}</span>
              </span>
            )}
          </>
        )}
      </div>

      {app.healthMessage && (
        <p
          className={`col-start-2 col-span-2 mt-1.5 line-clamp-2 text-[13px] leading-snug ${
            bucket === 'Degraded' ? 'text-text-degraded' : 'text-muted-tint'
          }`}
        >
          {app.healthMessage}
        </p>
      )}
    </Link>
  )
}
