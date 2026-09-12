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
 * How loudly a row's own surface speaks. Elevation encodes urgency: broken
 * things come toward the reader, everything else lies flat at the page's own
 * value and carries no card treatment at all.
 *
 * Only the two buckets that need acting on are tinted. Suspended and Unknown
 * are accounted for in the fleet bar and marked in the gutter, but they do
 * not lift the row: they are worth seeing, not worth interrupting for.
 */
export function surfaceOf(bucket: Bucket): string {
  // The press state has to match the surface: brightening works on a row
  // that has a background, but on a flat row it would only wash out the
  // text, so a flat row gets a background for the length of the press.
  if (bucket === 'Degraded')
    return 'z-[1] bg-surface-degraded shadow-[0_8px_20px_-10px_rgba(233,109,118,0.45)] active:brightness-125'
  if (bucket === 'OutOfSync') return 'bg-surface-outofsync active:brightness-125'
  return 'active:bg-panel'
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
