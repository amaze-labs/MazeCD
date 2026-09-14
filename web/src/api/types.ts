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
