import type { App, Health, SyncStatus } from '../api/types'

/**
 * The four states the fleet is read in. Every application lands in exactly
 * one, so the segments of the fleet bar sum to the fleet.
 */
export type Bucket = 'Degraded' | 'OutOfSync' | 'Progressing' | 'Healthy'

export function bucketOf(a: { health: Health; sync: SyncStatus }): Bucket {
  if (a.health === 'Degraded' || a.health === 'Missing') return 'Degraded'
  if (a.sync === 'OutOfSync') return 'OutOfSync'
  if (a.health === 'Progressing') return 'Progressing'
  return 'Healthy'
}

/**
 * How loudly a row's own surface speaks. Elevation encodes urgency: broken
 * things come toward the reader, healthy things lie flat at the page's own
 * value and carry no card treatment at all.
 */
export function surfaceOf(bucket: Bucket): string {
  if (bucket === 'Degraded')
    return 'bg-surface-degraded shadow-[0_8px_20px_-10px_rgba(233,109,118,0.45)]'
  if (bucket === 'OutOfSync') return 'bg-surface-outofsync'
  return ''
}

export function countBy(apps: App[]): Record<Bucket, number> {
  const out: Record<Bucket, number> = { Degraded: 0, OutOfSync: 0, Progressing: 0, Healthy: 0 }
  for (const a of apps) out[bucketOf(a)] += 1
  return out
}
