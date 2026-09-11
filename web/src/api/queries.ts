import { QueryClient, useQuery } from '@tanstack/react-query'
import { api, argoPath } from './client'
import type { AppDetail, AppsResponse, InstanceInfo, ResourceTree } from './types'

/** Foreground poll interval. refetchIntervalInBackground stays false, so the
 * timer is suspended while the tab is hidden and the battery is left alone. */
const POLL_MS = 8_000

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
