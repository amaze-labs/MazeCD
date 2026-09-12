import { useQuery } from '@tanstack/react-query'
import { api, argoPath } from '../../api/client'
import type { AppEvent } from '../../api/types'

export function EventsTab({ instance, name }: { instance: string; name: string }) {
  const q = useQuery({
    queryKey: ['events', instance, name],
    queryFn: () =>
      api.get<{ items?: AppEvent[] }>(argoPath(instance, `applications/${name}/events`)),
  })

  const items = [...(q.data?.items ?? [])].sort((a, b) =>
    (b.lastTimestamp ?? '').localeCompare(a.lastTimestamp ?? ''),
  )

  if (q.isLoading) return <p className="p-4 text-[14px] text-muted">Loading events…</p>
  if (q.isError)
    return (
      <p className="p-4 text-[14px] leading-snug text-degraded">
        Could not load events: {String(q.error)}
      </p>
    )
  if (items.length === 0)
    return (
      <p className="px-8 py-12 text-center text-[15px] leading-relaxed text-muted">
        Kubernetes has reported no events for this application. Events expire, so an older
        failure may already have aged out.
      </p>
    )

  return (
    <ul className="flex flex-col gap-0.5 py-1">
      {items.map((e, i) => (
        <li
          key={i}
          className={`px-4 py-2.5 ${e.type === 'Warning' ? 'bg-surface-outofsync' : ''}`}
        >
          <p className="flex items-baseline gap-2">
            <span
              className={`text-[15px] font-semibold ${
                e.type === 'Warning' ? 'text-outofsync' : 'text-text'
              }`}
            >
              {e.reason}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
              {e.involvedObject?.kind} {e.involvedObject?.name}
            </span>
          </p>
          <p className="mt-1 text-[14px] leading-snug text-muted">{e.message}</p>
          <p className="t-mono mt-1 text-[11px] text-muted">{e.lastTimestamp}</p>
        </li>
      ))}
    </ul>
  )
}
