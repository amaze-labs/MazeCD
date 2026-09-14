import { Link } from 'react-router-dom'
import { TriangleAlert } from 'lucide-react'
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
 *   │  4m  │ photo-library-ml                      │   14 │
 *   │      │ ⚠ Degraded  home  ledger  0af…│  ⚠ 2 │
 *   ├──────┼────────────────────────────────┼──────┤
 *   │  25d │ dns-filter                   │   17 │
 *   │      │ home                    d7d4947│      │
 *   └──────┴────────────────────────────────┴──────┘
 *     age            name / meta             resources
 *
 * **The age is the largest thing on the row — on the rows where it means
 * something.** On a broken application it is the fact that separates "this
 * is fine" from "go and look", and the one nothing else on the row reports:
 * a degraded border beside `4m` is a sync that just failed, the same border
 * beside `26d` is something that has been quietly broken for a month, and
 * neither the badge, the border nor the health message can tell those two
 * emergencies apart. There it is 20px and takes the full text colour.
 *
 * On a resting application the same number qualifies nothing. There is no
 * threshold at which `25d` on a Healthy, Synced application is bad, and
 * ninety-one inert figures in the strongest slot on the row would be the
 * ninety-one green badges this list already deleted, wearing different
 * clothes. So it drops to 13px and to muted, and the name — the thing you
 * actually came for when nothing is wrong — is the largest thing left.
 *
 * That is `.scarto.misura`, whose comment settles it: the same measurement is
 * 12px inside a pill and 17px standing alone, and what decides is whether it
 * is "il numero che si cerca". The column survives the change because the
 * track is fixed and the figures are right-aligned: big or small, every age
 * ends at the same x, and the eye still runs straight down it.
 *
 * The age is never tinted by state, at either size. This is when the last
 * *operation* finished, not how long the application has been degraded, and
 * colouring it red would claim a duration ArgoCD never reported. Weight and
 * size say "read this one"; colour would say something untrue.
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
          className={`col-start-1 row-span-2 text-right leading-none tabular-nums ${
            resting ? `text-[13px] ${muted}` : 'text-[20px] font-semibold text-text'
          }`}
        >
          {when.short}
        </time>
      ) : (
        <span
          title="ArgoCD has no operation recorded for this application"
          className="col-start-1 row-span-2 text-right text-[13px] leading-none text-rule"
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

      {/* The total carries no mark of its own. A glyph repeated on all
          ninety-nine rows says nothing the column's position does not
          already say, and at 11px the one that meant "a resource" read as a
          smudge rather than as a word. Dropping it leaves exactly one mark
          in this column — the triangle on the rows that have something
          wrong — which is what makes that one read as a signal instead of
          as furniture. Both figures are right-aligned to the same edge, so
          the digits line up whether or not the second line is there. */}
      <div className="col-start-3 row-span-2 text-right tabular-nums">
        {app.totalResources === undefined ? (
          <span
            title="this instance reported no resource list for this application"
            className="block text-[13px] text-rule"
          >
            –
          </span>
        ) : (
          <>
            <span
              title={`${app.totalResources} resources`}
              className={`block text-[13px] leading-tight ${muted}`}
            >
              {app.totalResources}
            </span>
            {unhealthy > 0 && (
              <span
                title={`${unhealthy} of them not healthy`}
                className="flex items-center justify-end gap-1 text-[11px] leading-tight font-semibold text-degraded"
              >
                <TriangleAlert size={11} strokeWidth={2.4} aria-hidden="true" />
                {unhealthy}
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
