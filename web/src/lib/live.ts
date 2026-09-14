import { useEffect, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { argoPath } from '../api/client'
import { useInstances } from '../api/queries'
import { streamJson } from './stream'
import type { App, AppDetail, AppsResponse, ResourceTree } from '../api/types'

/**
 * Live updates, fed into the query cache rather than around it.
 *
 * ArgoCD's own web UI does not poll: it holds `/api/v1/stream/applications`
 * open per instance and a `/api/v1/stream/applications/{name}/resource-tree`
 * open for whichever application is on screen, both confirmed from the
 * gRPC-gateway annotations in ArgoCD's `application.proto`. MazeCD does the
 * same, and writes what arrives into the TanStack Query cache under the keys
 * the screens already read. Nothing downstream knows a stream exists; polling
 * stays as the fallback, at a longer interval now that it is not the path
 * anything depends on.
 */

/** One event off `/stream/applications`. */
type WatchEvent = { result?: { type?: string; application?: AppDetail } }

/**
 * Reconnect delays, in ms. The first is short because the common drop is a
 * proxy idle timeout on an otherwise healthy instance; the cap is the point
 * past which reconnecting more often than the poll buys nothing.
 */
const BACKOFF = [1_000, 2_000, 5_000, 15_000, 30_000]

/** A timer that does not outlive the teardown that cancelled it. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done)
  })
}

/**
 * Holds one stream open until `signal` aborts, reconnecting with backoff
 * after every end — clean or not. One instance failing is one loop spinning
 * slowly on its own; it cannot reach the others, and it never blanks the
 * screen, because nothing here removes data on failure. The fallback poll is
 * what fills the gap, and it is also what surfaces the instance's error
 * banner in the usual way.
 *
 * Every delivery is gated on the signal: a fetch that has already been
 * aborted can still resolve one more read, and a write into the query cache
 * after teardown is exactly the class of bug `lib/update.ts` documents.
 */
async function follow<T>(
  url: string,
  signal: AbortSignal,
  onOpen: () => void,
  onValue: (value: T) => void,
): Promise<void> {
  let failures = 0
  while (!signal.aborted) {
    try {
      await streamJson<T>(
        url,
        signal,
        () => {
          if (!signal.aborted) onOpen()
        },
        (value) => {
          if (!signal.aborted) onValue(value)
        },
      )
      failures = 0
    } catch {
      failures++
    }
    if (signal.aborted) return
    await sleep(BACKOFF[Math.min(failures, BACKOFF.length - 1)], signal)
  }
}

/**
 * An ArgoCD Application as the list renders it. This mirrors the mapping
 * `internal/argocd/apps.go` does for `/api/apps`: the same application must
 * not read differently depending on whether it arrived by poll or by stream.
 */
export function toApp(instance: string, a: AppDetail): App {
  return {
    instance,
    name: a.metadata.name,
    namespace: a.metadata.namespace,
    project: a.spec.project,
    destServer: a.spec.destination.server ?? '',
    destNamespace: a.spec.destination.namespace ?? '',
    health: a.status.health?.status ?? '',
    healthMessage: a.status.health?.message,
    sync: a.status.sync?.status ?? '',
    revision: a.status.sync?.revision ?? '',
    operationPhase: a.status.operationState?.phase,
    operationFinishedAt: a.status.operationState?.finishedAt,
    // Same distinction the Go mapping makes, for the same reason: no
    // resources list at all is `undefined`, an empty one is 0, and a row
    // draws those two differently. Resources that report no health object
    // are not counted as unhealthy -- absence of reporting is not illness,
    // and most resources on most applications report nothing.
    totalResources: a.status.resources?.length,
    unhealthyResources: a.status.resources?.filter(
      (r) => r.health && r.health.status !== 'Healthy',
    ).length,
    autoSync: a.spec.syncPolicy?.automated != null,
  }
}

/**
 * Folds one watch event into the cached fleet. Order does not matter — the
 * list screen sorts for triage itself — so an update is a remove-then-append.
 *
 * An undefined cache is left undefined: the first `/api/apps` has not landed
 * yet, and a list built from one instance's replay alone would be a fleet
 * missing two thirds of itself.
 */
export function applyEvent(
  prev: AppsResponse | undefined,
  type: string,
  app: App,
): AppsResponse | undefined {
  if (!prev) return undefined
  const rest = prev.apps.filter((a) => !(a.instance === app.instance && a.name === app.name))
  if (type === 'DELETED') {
    return rest.length === prev.apps.length ? prev : { ...prev, apps: rest }
  }
  return { ...prev, apps: [...rest, app] }
}

/**
 * Whether streams should be running at all. A phone in a pocket must not hold
 * three connections open, so the streams take the same discipline the poll
 * already has (`refetchIntervalInBackground: false`): down when the document
 * is hidden, back up — and resynchronised — when it is visible again.
 */
function useStreamsWanted(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return visible
}

/**
 * Resynchronisation, on every connect and reconnect.
 *
 * A stream that was closed for a minute missed whatever happened in that
 * minute, and ArgoCD's replay of every application as `ADDED` on connect
 * cannot express a deletion. So a connect refetches: it is one request, it is
 * the request the poll would have made anyway, and it is the only thing that
 * guarantees the screen after a reconnect is the world as it is rather than
 * the world as it was.
 */
const resync = (qc: QueryClient, key: unknown[]) => () => void qc.invalidateQueries({ queryKey: key })

/**
 * One `/stream/applications` per configured instance, feeding the fleet list
 * and, where the detail screen is already showing one, that application's own
 * cached record.
 *
 * ponytail: one connection per instance. Over HTTP/1.1 a browser allows six
 * per origin, so a config past about five instances would starve the ordinary
 * requests; MazeCD is served over HTTP/2 in every deployment that has more
 * than a handful. Multiplex through a single server-side fan-out if that ever
 * stops being true.
 */
export function useLiveApps(): void {
  const qc = useQueryClient()
  const instances = useInstances()
  const wanted = useStreamsWanted()
  // A primitive, not the array: `useInstances` refetches every minute and a
  // fresh-but-equal array would tear down and rebuild every stream each time.
  // A comma is unambiguous as the separator: `internal/config/config.go`
  // rejects any instance name that is not `[a-z0-9-]+`.
  const names = (instances.data ?? [])
    .map((i) => i.name)
    .sort()
    .join(',')

  useEffect(() => {
    if (!wanted || !names) return
    const ctrl = new AbortController()
    for (const instance of names.split(',')) {
      void follow<WatchEvent>(
        argoPath(instance, 'stream/applications'),
        ctrl.signal,
        resync(qc, ['apps']),
        (ev) => {
          const a = ev.result?.application
          if (!a) return
          const type = ev.result?.type ?? ''
          qc.setQueryData<AppsResponse>(['apps'], (prev) =>
            applyEvent(prev, type, toApp(instance, a)),
          )
          // Only where the detail screen already has this application open:
          // an updater that returns undefined creates no cache entry, so a
          // 99-application replay does not plant 99 of them.
          if (type !== 'DELETED') {
            qc.setQueryData<AppDetail>(['app', instance, a.metadata.name], (prev) =>
              prev ? a : undefined,
            )
          }
        },
      )
    }
    return () => ctrl.abort()
  }, [wanted, names, qc])
}

/**
 * The resource tree of the application on screen, live. ArgoCD sends the whole
 * tree on every change rather than a delta, so each event simply replaces the
 * cached tree.
 */
export function useLiveTree(instance: string, name: string): void {
  const qc = useQueryClient()
  const wanted = useStreamsWanted()

  useEffect(() => {
    if (!wanted || !instance || !name) return
    const ctrl = new AbortController()
    void follow<{ result?: ResourceTree }>(
      argoPath(instance, `stream/applications/${name}/resource-tree`),
      ctrl.signal,
      resync(qc, ['tree', instance, name]),
      (ev) => {
        if (ev.result) qc.setQueryData<ResourceTree>(['tree', instance, name], ev.result)
      },
    )
    return () => ctrl.abort()
  }, [wanted, instance, name, qc])
}
