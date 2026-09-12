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

  if (q.isLoading) return <p className="p-4 text-[14px] text-muted">Rendering manifests…</p>
  if (q.isError)
    return (
      <p className="p-4 text-[14px] leading-snug text-degraded">
        Could not render the manifests: {String(q.error)}
      </p>
    )

  return (
    <div className="flex flex-col gap-0.5 py-1">
      {(q.data?.manifests ?? []).map((m, i) => (
        <pre key={i} className="t-mono overflow-x-auto bg-panel p-4 text-[11px] leading-relaxed text-muted">
          {m}
        </pre>
      ))}
    </div>
  )
}
