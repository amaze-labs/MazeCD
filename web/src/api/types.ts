export type Health = 'Healthy' | 'Progressing' | 'Degraded' | 'Suspended' | 'Missing' | 'Unknown' | ''
export type SyncStatus = 'Synced' | 'OutOfSync' | 'Unknown' | ''

export type App = {
  instance: string
  name: string
  namespace: string
  project: string
  destServer: string
  destNamespace: string
  health: Health
  sync: SyncStatus
  revision: string
  operationPhase?: string
  /** ArgoCD's own `status.health.message`. Present only when it has one to
   * give, which is why a row says nothing rather than inventing a reason. */
  healthMessage?: string
  /** `status.operationState.finishedAt`: when the last sync operation ended,
   * success or failure. Named for what it is — see the field's own comment in
   * `internal/argocd/apps.go` for why this and not `reconciledAt` or the
   * newest `status.history[]` entry. Absent when the application has never
   * been operated on, which a row must draw as unknown rather than as "now". */
  operationFinishedAt?: string
  /** `len(status.resources)`. Absent means the instance never reported a
   * resources list at all; 0 means it reported an empty one. Those are
   * different facts, so the row draws them differently: a placed mark for the
   * first, a real zero for the second. Never render absent as "0". */
  totalResources?: number
  /** Of `totalResources`, how many report a health that is not Healthy.
   * Resources that report no health at all are not counted — see the Go
   * field. Absent or 0 both mean "nothing to look at here". */
  unhealthyResources?: number
  /** Whether `spec.syncPolicy.automated` is present: ArgoCD will reconcile
   * this application itself rather than leaving it drifted until someone
   * triggers a sync. Unlike `totalResources` there is no third state — an
   * absent policy is a real "manual", not an unknown — so the rail's texture
   * never has to draw an indeterminate case. */
  autoSync: boolean
}

export type InstanceError = { instance: string; message: string }
export type AppsResponse = { apps: App[]; errors: InstanceError[] }

export type InstanceInfo = {
  name: string
  color: string
  production: boolean
  url: string
  reachable: boolean
  tokenValid: boolean
  error?: string
}

export type ResourceRef = {
  group: string
  kind: string
  name: string
  namespace: string
}

export type ResourceNode = ResourceRef & {
  version: string
  uid?: string
  parentRefs?: ResourceRef[]
  health?: { status: Health; message?: string }
  info?: { name: string; value: string }[]
  resourceVersion?: string
  createdAt?: string
}

export type ResourceTree = { nodes?: ResourceNode[] }

export type AppDetail = {
  metadata: { name: string; namespace: string }
  spec: {
    project: string
    source?: { repoURL?: string; path?: string; targetRevision?: string }
    destination: { server?: string; namespace?: string }
    /** Only its presence is read; the prune/selfHeal sub-flags are not asked
     * about anywhere. Mirrors `internal/argocd/apps.go`. */
    syncPolicy?: { automated?: Record<string, unknown> }
  }
  status: {
    health?: { status: Health; message?: string }
    sync?: { status: SyncStatus; revision?: string }
    operationState?: {
      phase: string
      message?: string
      startedAt?: string
      finishedAt?: string
    }
    conditions?: { type: string; message: string }[]
    resources?: (ResourceRef & { version?: string; status?: SyncStatus; health?: { status: Health } })[]
  }
}

export type AppEvent = {
  reason: string
  message: string
  type: string
  lastTimestamp: string
  involvedObject?: { kind: string; name: string }
}

/**
 * One entry of `applications/{name}/managed-resources`: a resource ArgoCD
 * manages, with the cluster's copy beside Git's.
 *
 * THE FOUR STATE FIELDS ARE JSON *STRINGS*, not objects — ArgoCD marshals
 * them once on the way out and the client parses them again. A side that does
 * not exist is the string `"null"`, which is what `json.Marshal(nil)`
 * produces: a resource that exists only in Git and one that exists only in
 * the cluster are both ordinary, and both look like that.
 *
 * `normalizedLiveState` is the live object after ArgoCD's normalizers and
 * `predictedLiveState` what the live object would become — the pair a diff is
 * actually computed from. See `lib/diff.ts` for why not the raw two.
 */
export type ResourceDiff = {
  group?: string
  kind: string
  namespace: string
  name: string
  targetState: string
  liveState: string
  normalizedLiveState?: string
  predictedLiveState?: string
  hook?: boolean
  modified?: boolean
}

export type ManagedResources = { items?: ResourceDiff[] }

/** `applications/{name}/manifests`: what the repo renders at a revision,
 * before anything is applied. Each manifest is a JSON string of one object. */
export type ManifestsResponse = {
  manifests?: string[]
  namespace?: string
  server?: string
  revision?: string
  sourceType?: string
}
