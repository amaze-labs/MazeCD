import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createTwoFilesPatch } from 'diff'
import { api, argoPath } from '../../api/client'
import type { ManagedResource } from '../../api/types'

/** Sort object keys recursively so equivalent states compare equal regardless
 * of key order. Array order is left alone: it is semantically meaningful in
 * Kubernetes manifests (container lists, env lists, volume mounts). */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}

export const pretty = (raw: string) => {
  if (!raw) return ''
  try {
    return JSON.stringify(canonicalize(JSON.parse(raw)), null, 2)
  } catch {
    return raw
  }
}

export function DiffTab({ instance, name }: { instance: string; name: string }) {
  const q = useQuery({
    queryKey: ['managed', instance, name],
    queryFn: () =>
      api.get<{ items?: ManagedResource[] }>(
        argoPath(instance, `applications/${name}/managed-resources`),
      ),
    // managed-resources returns the full live and desired state of every
    // resource in the application: the heaviest endpoint ArgoCD has, and no
    // candidate for the global 8s poll. Pull-to-refresh and tab switches
    // still refetch it. ManifestTab opts out for the same reason.
    refetchInterval: false,
  })

  // A JSON parse, a recursive key sort and a stringify over both states of
  // every resource, then a patch per changed resource -- all of it in the
  // render body, on a parent that re-renders on every poll tick. Keyed on
  // the query data, it runs once per fetch instead.
  const changed = useMemo(
    () =>
      (q.data?.items ?? [])
        .map((r) => ({ r, live: pretty(r.liveState), desired: pretty(r.targetState) }))
        .filter(({ live, desired }) => live !== desired)
        .map(({ r, live, desired }) => ({
          r,
          patch: createTwoFilesPatch('live', 'desired', live, desired, '', '', { context: 3 }),
        })),
    [q.data],
  )

  if (q.isLoading) return <p className="p-4 text-sm text-muted">Loading diff…</p>
  if (q.isError) return <p className="p-4 text-sm text-[#e96d76]">{String(q.error)}</p>
  if (changed.length === 0) return <p className="p-8 text-center text-sm text-muted">No differences.</p>

  return (
    <div className="divide-y divide-border">
      {changed.map(({ r, patch }) => {
        return (
          <section key={`${r.group}/${r.kind}/${r.namespace}/${r.name}`} className="py-3">
            <h3 className="px-4 text-sm font-medium">
              {r.kind} <span className="text-muted">{r.name}</span>
            </h3>
            <pre className="mt-2 overflow-x-auto px-4 text-[11px] leading-relaxed">
              {patch
                .split('\n')
                .slice(4)
                .map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.startsWith('+')
                        ? 'text-[#18be94]'
                        : line.startsWith('-')
                          ? 'text-[#e96d76]'
                          : 'text-muted'
                    }
                  >
                    {line || ' '}
                  </div>
                ))}
            </pre>
          </section>
        )
      })}
    </div>
  )
}
