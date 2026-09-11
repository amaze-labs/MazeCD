import type { Health, SyncStatus } from '../api/types'

/** ArgoCD's own status colours: operators already read these at a glance. */
const HEALTH: Record<string, string> = {
  Healthy: '#18be94',
  Progressing: '#0daeeb',
  Degraded: '#e96d76',
  Suspended: '#766f94',
  Missing: '#ccd6dd',
  Unknown: '#ccd6dd',
}

const SYNC: Record<string, string> = {
  Synced: '#18be94',
  OutOfSync: '#f4c030',
  Unknown: '#ccd6dd',
}

export const healthColor = (h: Health) => HEALTH[h] ?? HEALTH.Unknown
export const syncColor = (s: SyncStatus) => SYNC[s] ?? SYNC.Unknown

/** Sort key for triage: what is broken comes first. */
const HEALTH_RANK: Record<string, number> = {
  Degraded: 0,
  Missing: 1,
  Progressing: 2,
  Unknown: 3,
  Suspended: 4,
  Healthy: 5,
}
export const healthRank = (h: Health) => HEALTH_RANK[h] ?? 3
