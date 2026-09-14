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
 * How loudly a card speaks, as depth rather than as a stripe.
 *
 * Every application is a card; urgency decides how far off the page it sits.
 * A degraded card is tinted toward its status hue and casts a real shadow, an
 * out-of-sync card is tinted and flat, and everything else rests at the card
 * surface with the faintest of edges. Eight cards on a screen, and the two
 * that are on fire are the two that come forward.
 */
export function surfaceOf(bucket: Bucket): string {
  if (bucket === 'Degraded')
    return 'bg-surface-degraded shadow-[0_10px_24px_-12px_rgba(233,109,118,0.55)] ring-1 ring-degraded/25 active:brightness-110'
  if (bucket === 'OutOfSync')
    return 'bg-surface-outofsync ring-1 ring-outofsync/20 active:brightness-110'
  return 'bg-panel shadow-[0_1px_2px_rgba(0,0,0,0.4)] active:bg-raised'
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
