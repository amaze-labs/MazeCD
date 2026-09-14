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
 * The row wraps rather than scrolls. Six chips cannot fit 393px, and a
 * horizontal scroller put `91 healthy` — the number that makes the other
 * five mean something — off the right-hand edge, which is the same mistake
 * the fleet bar made in a different costume. The number leads at full size
 * and the word follows at 11px, which is what gets six chips onto two rows
 * instead of three without dropping a word anybody needs to read.
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
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by fleet state">
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
              background: tint(s.color, on ? 26 : 12),
              boxShadow: `inset 0 0 0 ${on ? 1.5 : 1}px ${tint(s.color, on ? 70 : 26)}`,
              color: s.color,
            }}
          >
            <Icon size={14} strokeWidth={2.2} className={s.spin ? 'spin' : ''} aria-hidden="true" />
            <span className="font-semibold tabular-nums">{counts[b]}</span>
            <span className="text-[11px] opacity-85">{s.label.toLowerCase()}</span>
          </button>
        )
      })}
    </div>
  )
}
