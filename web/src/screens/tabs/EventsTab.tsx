import { useQuery } from '@tanstack/react-query'
import { CalendarOff, ServerOff } from 'lucide-react'
import { api, argoPath } from '../../api/client'
import { Button, Callout, EmptyState } from '../../components/ui'
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

  // The shape of an event, three times over: a reason, a subject, a message,
  // a timestamp. Same reason as the list -- nothing moves when the data lands.
  if (q.isLoading && !q.data)
    return (
      <ul className="flex flex-col gap-0.5 py-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <li key={i} className="px-4 py-2.5">
            <span className="skel block h-[17px] w-[46%]" />
            <span className="skel mt-1.5 block h-3.5 w-[82%]" />
            <span className="skel mt-1.5 block h-2.5 w-28" />
          </li>
        ))}
      </ul>
    )
  if (q.isError)
    return (
      <div className="m-4">
        <Callout
          icon={<ServerOff size={17} strokeWidth={2.2} />}
          title="Could not load events"
          action={
            <Button className="!h-10 !text-[14px]" onClick={() => void q.refetch()}>
              Try again
            </Button>
          }
        >
          <span className="t-mono block text-[12px]">{String(q.error)}</span>
        </Callout>
      </div>
    )
  if (items.length === 0)
    return (
      <EmptyState icon={<CalendarOff size={22} strokeWidth={2} />} title="No events">
        Kubernetes has reported nothing for this application. Events expire after an hour or so,
        so a failure from this morning may already have aged out of the record.
      </EmptyState>
    )

  return (
    <ul className="flex flex-col gap-0.5 py-1">
      {items.map((e, i) => (
        <li
          key={i}
          className={`px-4 py-2.5 ${
            e.type === 'Warning' ? 'border-l-2 border-outofsync' : 'border-l-2 border-transparent'
          }`}
        >
          <p className="flex items-baseline gap-2">
            {/* The word carries the type; the amber only reinforces it. A
                tinted surface alone would be invisible to a reader who
                cannot separate amber from the page. */}
            {e.type === 'Warning' && (
              <span className="shrink-0 rounded-pill bg-outofsync/15 px-1.5 py-px text-[12px] leading-4 font-medium text-outofsync">
                Warning
              </span>
            )}
            <span className="text-[15px] font-semibold">{e.reason}</span>
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
