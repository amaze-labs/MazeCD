import { useQuery } from '@tanstack/react-query'
import { api, argoPath } from '../../api/client'

export function ManifestTab({ instance, name }: { instance: string; name: string }) {
  const q = useQuery({
    queryKey: ['manifests', instance, name],
    queryFn: () =>
      api.get<{ manifests?: string[] }>(argoPath(instance, `applications/${name}/manifests`)),
    // Manifests only change on a new revision: no need to poll them.
    refetchInterval: false,
  })

  if (q.isLoading) return <p className="p-4 text-sm text-muted">Loading manifests…</p>
  if (q.isError) return <p className="p-4 text-sm text-[#e96d76]">{String(q.error)}</p>

  return (
    <div className="divide-y divide-border">
      {(q.data?.manifests ?? []).map((m, i) => (
        <pre key={i} className="overflow-x-auto p-4 text-[11px] leading-relaxed text-muted">
          {m}
        </pre>
      ))}
    </div>
  )
}
