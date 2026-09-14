import { QueryClient, useQuery } from '@tanstack/react-query'
import { api, argoPath } from './client'
import type {
  AppDetail,
  AppsResponse,
  InstanceInfo,
  ManagedResources,
  ManifestsResponse,
  ResourceTree,
} from './types'

/** Foreground poll interval, and no longer the way state arrives: `lib/live.ts`
 * holds ArgoCD's watch streams open and writes into this cache. The poll is
 * the fallback for an instance whose stream cannot be held open at all, which
 * is why it is a third of a minute rather than eight seconds.
 * refetchIntervalInBackground stays false, so the timer is suspended while the
 * tab is hidden and the battery is left alone. */
const POLL_MS = 30_000

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchInterval: POLL_MS,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        staleTime: 0,
        retry: 1,
      },
    },
  })
}

export const useApps = () =>
  useQuery({ queryKey: ['apps'], queryFn: () => api.get<AppsResponse>('/api/apps') })

export const useInstances = () =>
  useQuery({
    queryKey: ['instances'],
    queryFn: () => api.get<InstanceInfo[]>('/api/instances'),
    refetchInterval: 60_000,
  })

export const useAppDetail = (instance: string, name: string) =>
  useQuery({
    queryKey: ['app', instance, name],
    queryFn: () => api.get<AppDetail>(argoPath(instance, `applications/${name}`)),
  })

export const useResourceTree = (instance: string, name: string) =>
  useQuery({
    queryKey: ['tree', instance, name],
    queryFn: () => api.get<ResourceTree>(argoPath(instance, `applications/${name}/resource-tree`)),
  })

/** The diff, and the desired manifests. Both are mounted only while their
 * sheet is open and both are expensive upstream — managed-resources makes the
 * instance render the application and compare every resource — so neither
 * joins the 30s poll. What the operator opened is a reading of the moment
 * they opened it; the Refresh button behind the sheet is how it is retaken. */
export const useManagedResources = (instance: string, name: string) =>
  useQuery({
    queryKey: ['diff', instance, name],
    queryFn: () =>
      api.get<ManagedResources>(argoPath(instance, `applications/${name}/managed-resources`)),
    refetchInterval: false,
  })

export const useManifests = (instance: string, name: string) =>
  useQuery({
    queryKey: ['manifests', instance, name],
    queryFn: () => api.get<ManifestsResponse>(argoPath(instance, `applications/${name}/manifests`)),
    refetchInterval: false,
  })
