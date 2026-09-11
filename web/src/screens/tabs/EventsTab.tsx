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

  if (q.isLoading) return <p className="p-4 text-sm text-muted">Loading events…</p>
  if (items.length === 0) return <p className="p-8 text-center text-sm text-muted">No events.</p>

  return (
    <ul className="divide-y divide-border">
      {items.map((e, i) => (
        <li key={i} className="px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <span className={e.type === 'Warning' ? 'text-[#f4c030]' : 'text-muted'}>{e.reason}</span>
            <span className="text-xs text-muted">
              {e.involvedObject?.kind} {e.involvedObject?.name}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">{e.message}</p>
          <p className="mt-1 text-[11px] text-muted">{e.lastTimestamp}</p>
        </li>
      ))}
    </ul>
  )
}
