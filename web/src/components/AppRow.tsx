import { Link } from 'react-router-dom'
import { TriangleAlert } from 'lucide-react'
import type { App } from '../api/types'
import { InstancePill, Revision, RowMark, tint } from './ui'
import { bucketOf, surfaceOf, tinted } from '../lib/fleet'
import { stateStyle } from '../lib/status'
import { ago } from '../lib/ago'

/**
 * One application, one card — as a grid with three fixed tracks, so the same
 * fact sits at the same x on all ninety-nine rows and an eye runs down one
 * column instead of reading every row whole.
 *
 *   ┌──────┬────────────────────────────────┬──────┐
 *   │  4m  │ ⚠ photo-library-ml                    │   14 │
 *   │      │ Degraded  home  ledger   0af… │  ⚠ 2 │
 *   ├──────┼────────────────────────────────┼──────┤
 *   │  25d │ ▫ dns-filter                 │   17 │
 *   │      │ home                    d7d4947│      │
 *   └──────┴────────────────────────────────┴──────┘
 *    LAST OP        APPLICATION              RES
 *
 * The three tracks are named once, in a header row above the list, rather
 * than ninety-nine times on the rows or once behind an ⓘ in the header. That
 * is where the numbers got their names back, and it is why the ⓘ is gone.
 *
 * Each row opens with the mark — a small outlined tile, silent and grey on a
 * resting application, carrying the state's glyph in the state's colour when
 * there is something to report. It sits at the head of the name rather than
 * in a fourth track because a track costs 30px of every application name on a
 * 393px screen, and because the state icon was already on this row: it has
 * moved from the middle of the meta line up to the front, where the eye
 * starts. The meta line keeps the *word*, which is the half that carries to
 * someone who cannot see the colour.
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
 * because colour alone is not information for everyone.
 *
 * The resting application still says nothing it does not have to: no state
 * word, no unhealthy count, no health message. It carries twice the facts it
 * did and stays quiet.
 */
export function AppRow({ app, color }: { app: App; color: string }) {
  const bucket = bucketOf(app)
  const state = stateStyle(bucket)
  const muted = tinted(bucket) ? 'text-muted-tint' : 'text-muted'
  const resting = bucket === 'Healthy' && app.sync === 'Synced'
  const when = ago(app.operationFinishedAt)
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
            : tint(state.color, 'var(--tint-border)'),
      }}
    >
      {/* The leading column: the mark, and under it the age. Both right-
          aligned to the same edge, so the column still reads straight down.

          The mark began at the head of the *name*, which is where the
          reference puts it — and it cost 26px of every application name on a
          393px screen, enough to truncate the longest fixture name that used
          to fit. Here it costs nothing: this column is 52px wide, reserved
          for an age of at most four characters, and the space above that age
          was empty. It is also a more literal answer to "an anchor at the
          start of the row" than an icon a third of the way in. */}
      <div className="col-start-1 row-span-2 flex flex-col items-end gap-0.5">
        <RowMark state={bucket} resting={resting} />
        {when ? (
          <time
            dateTime={app.operationFinishedAt}
            // What this number *is* is written at the top of its own column,
            // once, in the list's header row. The title stays for a pointer,
            // and the aria-label is what a screen reader says in place of
            // "1d".
            title={`last operation finished ${when.long}`}
            aria-label={`last operation finished ${when.long}`}
            className={`leading-none tabular-nums ${
              resting ? `text-[13px] ${muted}` : 'text-[20px] font-semibold text-text'
            }`}
          >
            {when.short}
          </time>
        ) : (
          <span
            title="ArgoCD has no operation recorded for this application"
            className="text-[13px] leading-none text-rule"
          >
            –
          </span>
        )}
      </div>

      <h2 className="t-name col-start-2 row-start-1 truncate text-[15px]">{app.name}</h2>

      <div className="col-start-2 row-start-2 mt-0.5 flex min-w-0 items-center gap-1.5">
        {!resting && (
          <span className="shrink-0 text-[12px] font-medium" style={{ color: state.color }}>
            {state.label}
          </span>
        )}
        <InstancePill name={app.instance} color={color} />
        {/* The project used to sit here. Once the instance pill grew its dot,
            four things were sharing this line and the project was the one
            that gave way — `pers…` on one row, `perso…` on the next, five
            characters of a word nobody can finish. A field cut that short is
            worse than a field that is absent: it takes the space, adds the
            noise, and tells nobody anything. It is a labelled field on the
            detail now, which is where someone who cares about it is looking,
            and that grid is the reason the row no longer has to carry it. */}
        <span className="min-w-0 flex-1" />
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
