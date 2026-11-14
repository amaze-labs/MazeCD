import type { Bucket } from '../lib/fleet'
import { stateStyle } from '../lib/status'
import { tint } from './ui'

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
 * The counts are the same six facts read the other way, one cell each in a
 * single row, and each one filters the list to itself; the one being
 * filtered on is lit in its own colour. A state with nobody in it keeps its
 * cell, faded, so the six are always in the same place.
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
    <div className="card mx-3.5 px-2.5 pt-2.5 pb-2">
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
        {shown.map((b) => (
          <i
            key={b}
            className="block min-w-1"
            style={{ background: stateStyle(b).color, flexGrow: counts[b] }}
          />
        ))}
      </div>
      <div
        className="mt-2 grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(${ORDER.length}, minmax(0, 1fr))` }}
        role="group"
        aria-label="Filter by fleet state"
      >
        {ORDER.map((b) => {
          const s = stateStyle(b)
          const on = active === b
          const none = counts[b] === 0
          return (
            <button
              key={b}
              type="button"
              aria-pressed={on}
              disabled={none && !on}
              onClick={() => onPick(on ? '' : b)}
              className={`rounded-tile px-0.5 pt-[3px] pb-1 text-center ${none ? 'opacity-45' : ''}`}
              style={on ? { background: tint(s.color, 'var(--tint-soft)'), boxShadow: `inset 0 0 0 1px ${tint(s.color, 'var(--tint-outline)')}` } : undefined}
            >
              <b className="t-mono block text-[15px] leading-[1.15] font-semibold" style={{ color: none ? 'var(--color-dim)' : s.color }}>
                {counts[b]}
              </b>
              <span className="block truncate text-[10px] font-semibold tracking-[-0.01em] text-muted [font-stretch:78%]">
                {s.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
