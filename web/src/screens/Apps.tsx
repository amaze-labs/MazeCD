import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useApps, useInstances } from '../api/queries'
import { AppRow } from '../components/AppRow'
import { FleetCounters } from '../components/FleetCounters'
import { bucketOf, countBy, type Bucket } from '../lib/fleet'
import { healthRank } from '../lib/status'
import { usePullToRefresh } from '../lib/pullToRefresh'
import { tint } from '../components/ui'

type Filter = { instance: string; state: Bucket | ''; q: string }

export function Apps() {
  const apps = useApps()
  const instances = useInstances()
  const qc = useQueryClient()
  const [filter, setFilter] = useState<Filter>({ instance: '', state: '', q: '' })

  const { pull, refreshing } = usePullToRefresh(() =>
    qc.invalidateQueries({ queryKey: ['apps'] }),
  )

  const colors = useMemo(
    () => Object.fromEntries((instances.data ?? []).map((i) => [i.name, i.color])),
    [instances.data],
  )

  const all = useMemo(() => apps.data?.apps ?? [], [apps.data])
  const counts = useMemo(() => countBy(all), [all])

  const visible = useMemo(() => {
    const list = all.filter((a) => {
      if (filter.instance && a.instance !== filter.instance) return false
      if (filter.state && bucketOf(a) !== filter.state) return false
      if (filter.q && !a.name.toLowerCase().includes(filter.q.toLowerCase())) return false
      return true
    })
    // Triage order: broken first, then out of sync, then alphabetical.
    return list.sort(
      (a, b) =>
        healthRank(a.health) - healthRank(b.health) ||
        Number(b.sync === 'OutOfSync') - Number(a.sync === 'OutOfSync') ||
        a.name.localeCompare(b.name),
    )
  }, [all, filter])

  const filtered = filter.instance !== '' || filter.state !== '' || filter.q !== ''

  return (
    <div>
      {/* Only the title bar is pinned. The counters, the search and the
          instance filters scroll away with the list: on an 852px screen every
          pinned row is a card the operator cannot see, and two rows of chips
          held permanently would cost three applications for the whole of a
          ninety-nine-application scroll. They do their job on arrival. */}
      <header className="pt-safe sticky top-0 z-10 flex items-baseline justify-between gap-3 bg-ink px-4 pb-2">
        <h1 className="t-name text-[19px]">Applications</h1>
        <span className="shrink-0 text-[13px] text-muted tabular-nums">
          {refreshing ? 'Updating' : filtered ? `${visible.length} of ${all.length}` : all.length}
        </span>
      </header>

      <div className="px-4">
        <FleetCounters
          counts={counts}
          active={filter.state}
          onPick={(state) => setFilter({ ...filter, state })}
        />
      </div>

      <div className="px-4 pt-2">
        <div className="relative">
          <Search
            size={17}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            value={filter.q}
            onChange={(e) => setFilter({ ...filter, q: e.target.value })}
            placeholder="Find an application"
            aria-label="Find an application"
            className="h-11 w-full rounded-control bg-panel pr-3 pl-9 text-[15px] outline-none placeholder:text-muted focus:bg-raised"
          />
        </div>
        {(instances.data ?? []).length > 1 && (
          <div className="mt-2 flex gap-2 overflow-x-auto">
            {(instances.data ?? []).map((i) => {
              const on = filter.instance === i.name
              return (
                <button
                  key={i.name}
                  onClick={() => setFilter({ ...filter, instance: on ? '' : i.name })}
                  aria-pressed={on}
                  className="flex h-11 shrink-0 items-center gap-2 rounded-control px-3 text-[14px]"
                  style={{
                    background: on ? tint(i.color, 20) : 'var(--color-panel)',
                    boxShadow: `inset 0 0 0 1px ${on ? tint(i.color, 55) : 'var(--color-rule)'}`,
                    color: on ? 'var(--color-text)' : 'var(--color-muted)',
                  }}
                >
                  <span
                    className="size-2.5 rounded-full"
                    style={{ background: i.color, opacity: on ? 1 : 0.6 }}
                  />
                  {i.name}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {pull > 0 && <p className="pt-2 text-center text-[13px] text-muted">Keep pulling to refresh</p>}

      {(apps.data?.errors ?? []).map((e) => (
        <p
          key={e.instance}
          className="mx-4 mt-3 rounded-card bg-surface-degraded px-3 py-2.5 text-[13px] leading-snug"
        >
          <strong className="font-semibold">{e.instance}</strong> did not answer: {e.message}.
          Applications from the other instances are still listed.
        </p>
      ))}

      {apps.isError && (
        <div className="mx-4 mt-3 rounded-card bg-surface-degraded px-3 py-2.5 text-[13px] leading-snug">
          <p>MazeCD could not load the fleet. Pull down to try again.</p>
          <p className="t-mono mt-1 text-[12px] text-muted-tint">{String(apps.error)}</p>
        </div>
      )}

      <div className="mt-2 flex flex-col gap-1.5 px-4 pb-2">
        {visible.map((a) => (
          <AppRow key={`${a.instance}/${a.name}`} app={a} color={colors[a.instance] ?? '#7E8C9A'} />
        ))}
      </div>

      {!apps.isLoading && visible.length === 0 && (
        <div className="px-8 py-12 text-center">
          {filtered ? (
            <>
              <p className="text-[15px]">No application matches this filter.</p>
              <button
                onClick={() => setFilter({ instance: '', state: '', q: '' })}
                className="mt-3 h-11 rounded-control bg-raised px-4 text-[14px]"
              >
                Show all applications
              </button>
            </>
          ) : (
            <p className="text-[15px] leading-relaxed text-muted">
              No applications yet. Check in Settings that an ArgoCD instance is configured and
              its token is still valid.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
