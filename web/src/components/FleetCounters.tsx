import type { Bucket } from '../lib/fleet'
import { stateStyle } from '../lib/status'
import { tint } from './ui'

/** Read order is triage order. */
const ORDER: Bucket[] = ['Degraded', 'OutOfSync', 'Progressing', 'Suspended', 'Unknown', 'Healthy']

/**
 * The shape of the fleet, in numbers that cannot lie.
 *
 * This replaces a proportional bar whose 44px minimum segment width drew two
 * degraded applications the same width as ninety-four healthy ones — it
 * reported "six equal problems" when the truth was "ninety-seven fine, two on
 * fire". A count has no minimum width to distort: 2 is 2 next to 94.
 *
 * Empty buckets are not drawn, so an untroubled fleet is one green chip
 * rather than six chips of zeroes, and each chip filters the list to itself.
 *
 * Outlined, like everything else. These were the largest painted objects on
 * the list screen — six filled lozenges across the top, above a list whose
 * whole point is that most of it is calm. What tells a filtering chip from a
 * resting one is no longer a heavier wash but a heavier edge at full strength
 * against a 65% one, drawn as an inset shadow so nothing moves when it
 * changes.
 *
 * One row, scrolling, in urgency order with healthy last. Six worded chips
 * cannot fit 393px, and wrapping them cost two rows of an 852px screen
 * before the first application — furniture the operator pays for on arrival.
 * What falls off the right-hand edge is `91 Healthy`, which is the least
 * actionable number here: it is still counted, still tappable, still true,
 * one swipe away. Nothing is hidden, and the space goes to applications.
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
    <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4" role="group" aria-label="Filter by fleet state">
      {shown.map((b) => {
        const s = stateStyle(b)
        const Icon = s.icon
        const on = active === b
        return (
          <button
            key={b}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(on ? '' : b)}
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-pill px-2.5 text-[13px]"
            style={{
              boxShadow: `inset 0 0 0 ${on ? 2 : 1}px ${
                on ? s.color : tint(s.color, 'var(--tint-outline)')
              }`,
              color: s.color,
            }}
          >
            <Icon size={14} strokeWidth={2.2} className={s.spin ? 'spin' : ''} aria-hidden="true" />
            <span className="font-semibold tabular-nums">{counts[b]}</span>
            <span className="text-[11px] opacity-85">{s.label}</span>
          </button>
        )
      })}
    </div>
  )
}
