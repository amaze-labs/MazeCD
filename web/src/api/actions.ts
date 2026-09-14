import { api, argoPath } from './client'

/** refresh=normal re-reads git; refresh=hard also discards cached manifests.
 * The only write MazeCD makes, and ArgoCD counts it as a read. */
export const refreshApp = (instance: string, name: string, hard: boolean) =>
  api.get(argoPath(instance, `applications/${name}?refresh=${hard ? 'hard' : 'normal'}`))
