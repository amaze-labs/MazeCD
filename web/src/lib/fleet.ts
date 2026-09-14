import type { App, Health, SyncStatus } from '../api/types'

/**
 * The six states the fleet is read in. Every application lands in exactly
 * one, so the segments of the fleet bar sum to the fleet.
 *
 * Suspended and Unknown are kept apart on purpose. Suspended is a state an
 * operator chose — the application is paused and that is fine, but it is not
 * the same "fine" as healthy, and an app quietly sitting suspended for a
 * month is worth being able to see. Unknown means ArgoCD cannot tell, which
 * is not reassurance at all: counting either of them in the green segment
 * would report confidence the data does not support.
 */
export type Bucket = 'Degraded' | 'OutOfSync' | 'Progressing' | 'Suspended' | 'Unknown' | 'Healthy'

/**
 * The two predicates that decide whether a row shows a signal at all.
 *
 * The status gutter and the fleet bar both read these rather than each
 * inventing a rule, which is what guarantees the invariant: a row draws a
 * loud segment only when `bucketOf` has put it somewhere other than Healthy.
 * Proof, by construction: `bucketOf` returns 'Healthy' only after both
 * predicates have been shown false.
 */
export const healthLoud = (h: Health) => h !== 'Healthy'
export const syncLoud = (s: SyncStatus) => s === 'OutOfSync'

export function bucketOf(a: { health: Health; sync: SyncStatus }): Bucket {
  if (a.health === 'Degraded' || a.health === 'Missing') return 'Degraded'
  if (syncLoud(a.sync)) return 'OutOfSync'
  if (a.health === 'Progressing') return 'Progressing'
  if (a.health === 'Suspended') return 'Suspended'
  if (healthLoud(a.health)) return 'Unknown'
  return 'Healthy'
}

/** The buckets whose rows take a tinted surface, and so a lighter muted. */
export const tinted = (bucket: Bucket) => bucket === 'Degraded' || bucket === 'OutOfSync'

/**
 * What a card is made of, once the border carries the state.
 *
 * The two buckets that need acting on keep their tinted ground, so a broken
 * application still reads as a block from arm's length and not only as a
 * coloured edge. What went is the ring and the drop shadow: the card now
 * draws a real 1px border in its own status colour (see `AppRow`), and a
 * ring under a border is the same statement twice, while a coloured shadow
 * under both was the decoration that stood in for the information these rows
 * were missing. Everything else rests at the card surface.
 */
export function surfaceOf(bucket: Bucket): string {
  // The press is a variable, not a constant: brightening a card is what
  // reads as a press on a dark ground and does nothing at all on paper, so
  // --press is 1.14 in the dark theme and 0.94 in the light one.
  if (bucket === 'Degraded') return 'bg-surface-degraded active:brightness-[var(--press)]'
  if (bucket === 'OutOfSync') return 'bg-surface-outofsync active:brightness-[var(--press)]'
  return 'bg-panel active:bg-raised'
}

export function countBy(apps: App[]): Record<Bucket, number> {
  const out: Record<Bucket, number> = {
    Degraded: 0,
    OutOfSync: 0,
    Progressing: 0,
    Suspended: 0,
    Unknown: 0,
    Healthy: 0,
  }
  for (const a of apps) out[bucketOf(a)] += 1
  return out
}
