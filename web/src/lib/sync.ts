import type { ResourceRef } from '../api/types'

export type SyncOptions = {
  revision: string
  prune: boolean
  dryRun: boolean
  force: boolean
  replace: boolean
  /** Apply manifests without running resource hooks. */
  skipHooks: boolean
  retry: boolean
  /** Empty means the whole application. */
  resources: ResourceRef[]
}

export function defaultSyncOptions(): SyncOptions {
  return {
    revision: '',
    prune: false,
    dryRun: false,
    force: false,
    replace: false,
    skipHooks: false,
    retry: false,
    resources: [],
  }
}

/**
 * Translates the sync sheet into an ArgoCD ApplicationSyncRequest.
 *
 * The shapes here are not interchangeable and getting them wrong is
 * destructive: `force` belongs inside the strategy, `Replace=true` is a
 * syncOptions item, and choosing `apply` over `hook` is what skips hooks.
 */
export function buildSyncRequest(o: SyncOptions): Record<string, unknown> {
  const req: Record<string, unknown> = {
    revision: o.revision.trim() || 'HEAD',
    prune: o.prune,
    dryRun: o.dryRun,
    strategy: o.skipHooks ? { apply: { force: o.force } } : { hook: { force: o.force } },
  }
  if (o.replace) {
    req.syncOptions = { items: ['Replace=true'] }
  }
  if (o.resources.length > 0) {
    req.resources = o.resources.map(({ group, kind, name, namespace }) => ({
      group,
      kind,
      name,
      namespace,
    }))
  }
  if (o.retry) {
    req.retryStrategy = { limit: 2, backoff: { duration: '5s', factor: 2, maxDuration: '3m' } }
  }
  return req
}
