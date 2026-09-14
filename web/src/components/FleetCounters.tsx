import type { Bucket } from '../lib/fleet'
import { stateStyle } from '../lib/status'

/** Read order is triage order, and it is the order of the bar's segments too,
 * so a segment and its count are found in the same place. */
const ORDER: Bucket[] = ['Degraded', 'OutOfSync', 'Progressing', 'Suspended', 'Unknown', 'Healthy']

/**
 * The fleet, to scale: one bar, six segments, no labels on it — then the six
 * counts as words underneath.
 *
 * The bar answers "what shape is the fleet" before a single word is read: two
 * degraded applications out of ninety-nine are two pixels of red at the left
 * end of a green line, which is the truth, and it is a truth no list of
 * numbers conveys at a glance. `min-width: 4px` is the one concession — a
 * segment of one application out of ninety-nine would otherwise round to
 * nothing and the fleet would look cleaner than it is.
 *
 * The counts are the same six facts read the other way, and each one filters
 * the list to itself. The ordinary reading is grey here too: the figure takes
 * its state's colour, the word stays dim, and the one being filtered on takes
 * full ink.
 *
 * A caveat the mockup inherits and this component is not allowed to hide:
 * health and sync are two independent axes, so an application that is Healthy
 * *and* OutOfSync is counted under `out of sync` alone, and `91 healthy` means
 * "91 healthy and synced". The six still partition the fleet exactly — every
 * application lands in one and only one, which is what the bar needs to be
 * honest about proportion — but "healthy" here is the calm bucket, not the
 * health axis. `lib/fleet.ts` holds the rule.
 */
export function FleetCounters({
  counts,
  active,
  onPick,
}: {
  counts: Record<Bucket, number>
  active: Bucket | ''
  onPick: (b: Bucket | '') => void
}) {
  const shown = ORDER.filter((b) => counts[b] > 0)
  if (shown.length === 0) return null

  return (
    <>
      <div className="mx-4 flex h-1 gap-0.5" aria-hidden="true">
        {shown.map((b) => (
          <i
            key={b}
            className="block min-w-1 rounded-[1px]"
            style={{ background: stateStyle(b).color, flexGrow: counts[b] }}
          />
        ))}
      </div>
      <div
        className="t-mono flex flex-wrap gap-x-[13px] gap-y-1 px-4 pt-2.5 pb-3.5 text-[10.5px] text-dim"
        role="group"
        aria-label="Filter by fleet state"
      >
        {shown.map((b) => {
          const s = stateStyle(b)
          const on = active === b
          return (
            <button
              key={b}
              type="button"
              aria-pressed={on}
              onClick={() => onPick(on ? '' : b)}
              className={on ? 'text-text' : ''}
            >
              <b className="font-semibold" style={{ color: s.color }}>
                {counts[b]}
              </b>{' '}
              {s.label.toLowerCase()}
            </button>
          )
        })}
      </div>
    </>
  )
}
