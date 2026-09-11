import { api, argoPath } from './client'
import { buildSyncRequest, type SyncOptions } from '../lib/sync'
import type { ResourceNode } from './types'

export const syncApp = (instance: string, name: string, options: SyncOptions) =>
  api.post(argoPath(instance, `applications/${name}/sync`), buildSyncRequest(options))

/** refresh=normal re-reads git; refresh=hard also discards cached manifests. */
export const refreshApp = (instance: string, name: string, hard: boolean) =>
  api.get(argoPath(instance, `applications/${name}?refresh=${hard ? 'hard' : 'normal'}`))

export const terminateOperation = (instance: string, name: string) =>
  api.del(argoPath(instance, `applications/${name}/operation`))

export const rollbackApp = (instance: string, name: string, id: number) =>
  api.post(argoPath(instance, `applications/${name}/rollback`), { id, name })

export const deleteApp = (instance: string, name: string, cascade: boolean) =>
  api.del(argoPath(instance, `applications/${name}?cascade=${cascade}`))

const resourceQuery = (n: ResourceNode) =>
  new URLSearchParams({
    namespace: n.namespace,
    resourceName: n.name,
    version: n.version,
    kind: n.kind,
    group: n.group ?? '',
  }).toString()

export const deleteResource = (instance: string, name: string, n: ResourceNode, force: boolean) =>
  api.del(
    argoPath(instance, `applications/${name}/resource?${resourceQuery(n)}&force=${force}&orphan=false`),
  )

/** ArgoCD resource actions, e.g. "restart" on a Deployment. */
export const runResourceAction = (
  instance: string,
  name: string,
  n: ResourceNode,
  action: string,
) =>
  api.post(argoPath(instance, `applications/${name}/resource/actions?${resourceQuery(n)}`), action)
