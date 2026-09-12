import type { Bucket } from '../lib/fleet'

/**
 * Read order is triage order, and every bucket carries ArgoCD's own colour
 * for that state — including suspended and unknown, which exist here so that
 * an application in either can be seen and counted rather than quietly
 * swelling the healthy segment.
 */
const SEGMENTS: { key: Bucket; word: string; color: string }[] = [
  { key: 'Degraded', word: 'degraded', color: 'var(--color-degraded)' },
  { key: 'OutOfSync', word: 'out of sync', color: 'var(--color-outofsync)' },
  { key: 'Progressing', word: 'progressing', color: 'var(--color-progressing)' },
  { key: 'Suspended', word: 'suspended', color: 'var(--color-suspended)' },
  { key: 'Unknown', word: 'of unknown health', color: 'var(--color-unknown)' },
  { key: 'Healthy', word: 'healthy', color: 'var(--color-healthy)' },
]

/**
 * The shape of the fleet, before a single row is read: one full-bleed bar,
 * segmented by proportion, doubling as the filter.
 *
 * The proportion is deliberately not exact. A segment carries a 44px
 * flex-basis and grows from there, so two degraded applications out of
 * ninety-nine occupy about 50px instead of the eight they are owed — below
 * that they are neither tappable nor visible, which would defeat the whole
 * point of the bar. Everything above the basis is honest. Empty buckets are
 * not drawn at all, so a normal fleet shows two or three segments, not six.
 */
export function FleetBar({
  counts,
  active,
  onPick,
}: {
  counts: Record<Bucket, number>
  active: Bucket | ''
  onPick: (b: Bucket | '') => void
}) {
  const total = SEGMENTS.reduce((n, s) => n + counts[s.key], 0)
  if (total === 0) return <div className="h-11" />

  return (
    <div className="flex h-11 items-end gap-0.5" role="group" aria-label="Filter by fleet state">
      {SEGMENTS.filter((s) => counts[s.key] > 0).map((s) => {
        const on = active === s.key
        const dim = active !== '' && !on
        return (
          <button
            key={s.key}
            type="button"
            aria-pressed={on}
            aria-label={`${counts[s.key]} ${s.word}`}
            onClick={() => onPick(on ? '' : s.key)}
            style={{ flex: `${counts[s.key]} 1 44px` }}
            className="flex h-11 items-end"
          >
            <span
              className="w-full"
              style={{
                background: s.color,
                height: on ? 10 : 6,
                opacity: dim ? 0.3 : 1,
              }}
            />
          </button>
        )
      })}
    </div>
  )
}
