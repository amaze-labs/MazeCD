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

/**
 * The first call MazeCD makes that changes a cluster. `name` rides in the
 * body as well as the path, which is what ArgoCD's own client does.
 *
 * **THE RESPONSE TELLS YOU NOTHING, AND A DRY RUN IS NO EXCEPTION.** ArgoCD's
 * Sync handler builds the operation and hands it to `util/argo.SetAppOperation`
 * (`server/application/application.go`), which sets
 * `a.Status.OperationState = nil` before its Update and returns *that*
 * application. So `status.operationState` is null on every sync response ever
 * sent, and the only honest reading of one is "the request was accepted".
 *
 * What happened is written by the application controller a second or two
 * later, into `status.operationState`, and reaches this app on the watch
 * stream `lib/live.ts` already holds open — which is where `SyncSheet` waits
 * for a dry run's verdict. Hence no response type: there is nothing in it to
 * read.
 */
export const syncApp = (instance: string, name: string, body: SyncRequest) =>
  api.post(argoPath(instance, `applications/${name}/sync`), { name, ...body })

/** One entry of `applications/{name}/resource/actions`. `disabled` is a third
 * state, not a second: ArgoCD offers the action for this kind but says it
 * cannot run right now — nothing is paused, so nothing can be resumed. */
export type ResourceAction = { name: string; disabled?: boolean }

/** The five query parameters that name one resource inside an application.
 * The live-manifest read and both action endpoints take exactly these, so
 * they are built in one place. */
export const resourceParams = (r: {
  namespace: string
  name: string
  version: string
  kind: string
  group?: string
}) =>
  new URLSearchParams({
    namespace: r.namespace,
    resourceName: r.name,
    version: r.version,
    kind: r.kind,
    group: r.group ?? '',
  })

export const listResourceActions = (instance: string, app: string, params: URLSearchParams) =>
  api.get<{ actions?: ResourceAction[] }>(
    argoPath(instance, `applications/${app}/resource/actions?${params}`),
  )

/**
 * Run one action. Two endpoints do this and MazeCD uses the older of them:
 * `/resource/actions` carries the resource in the query string and the action
 * name as a bare JSON string body (grpc-gateway's `body:"action"`), while
 * `/resource/actions/v2` takes one object and also carries parameters. V2 is
 * the one that is not deprecated, and it is also the one an instance a couple
 * of releases behind answers with 404 — MazeCD watches several instances at
 * whatever version each of them happens to be, and MazeCD sends no
 * parameters, so the shape that every version understands is the right one
 * here. Switch when a parameterised action is wanted.
 *
 * `api.post` JSON-encodes whatever it is given, so a string argument is
 * already the `"restart"` the endpoint expects.
 */
export const runResourceAction = (
  instance: string,
  app: string,
  params: URLSearchParams,
  action: string,
) => api.post(argoPath(instance, `applications/${app}/resource/actions?${params}`), action)
