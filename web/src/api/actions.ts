import { api, argoPath } from './client'

/** refresh=normal re-reads git; refresh=hard also discards cached manifests.
 * A write in HTTP terms only: ArgoCD counts it as a read, and it is the safe
 * half of the pair of actions the detail screen offers. */
export const refreshApp = (instance: string, name: string, hard: boolean) =>
  api.get(argoPath(instance, `applications/${name}?refresh=${hard ? 'hard' : 'normal'}`))

/**
 * ArgoCD's ApplicationSyncRequest, as much of it as MazeCD sends. The shapes
 * are the stub's (`dev/stubargo/operations.go`), which were taken from
 * ArgoCD's own `application.proto`.
 *
 * `syncOptions` is a wrapper object *on the request* and a bare string list on
 * the operation ArgoCD stores — that asymmetry is ArgoCD's, not a typo — and
 * every option travels as one `Key=value` string.
 */
export type SyncRequest = {
  revision?: string
  prune?: boolean
  dryRun?: boolean
  strategy?: { apply?: { force?: boolean }; hook?: { force?: boolean } }
  resources?: { group?: string; kind: string; name: string; namespace: string }[]
  syncOptions?: { items: string[] }
}

/** The application, as it stands after the request. For a dry run this is the
 * operation ArgoCD *would* have run: nothing upstream moved. */
export type SyncResponse = {
  status?: {
    operationState?: {
      phase?: string
      message?: string
      syncResult?: { resources?: { name?: string; status?: string; message?: string }[] }
    }
  }
}

/** The first call MazeCD makes that changes a cluster. `name` rides in the
 * body as well as the path, which is what ArgoCD's own client does. */
export const syncApp = (instance: string, name: string, body: SyncRequest) =>
  api.post<SyncResponse>(argoPath(instance, `applications/${name}/sync`), { name, ...body })
