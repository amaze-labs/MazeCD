import { useQuery } from '@tanstack/react-query'
import { createTwoFilesPatch } from 'diff'
import { api, argoPath } from '../../api/client'
import type { ManagedResource } from '../../api/types'

const pretty = (raw: string) => {
  if (!raw) return ''
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
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
  })

  const changed = (q.data?.items ?? []).filter((r) => pretty(r.liveState) !== pretty(r.targetState))

  if (q.isLoading) return <p className="p-4 text-sm text-muted">Loading diff…</p>
  if (q.isError) return <p className="p-4 text-sm text-[#e96d76]">{String(q.error)}</p>
  if (changed.length === 0) return <p className="p-8 text-center text-sm text-muted">No differences.</p>

  return (
    <div className="divide-y divide-border">
      {changed.map((r) => {
        const patch = createTwoFilesPatch(
          'live',
          'desired',
          pretty(r.liveState),
          pretty(r.targetState),
          '',
          '',
          { context: 3 },
        )
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
