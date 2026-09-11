import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useApps, useInstances } from '../api/queries'
import { AppRow } from '../components/AppRow'
import { healthRank } from '../lib/status'
import { usePullToRefresh } from '../lib/pullToRefresh'

type Filter = { instance: string; broken: boolean; outOfSync: boolean; q: string }

export function Apps() {
  const apps = useApps()
  const instances = useInstances()
  const qc = useQueryClient()
  const [filter, setFilter] = useState<Filter>({ instance: '', broken: false, outOfSync: false, q: '' })

  const { pull, refreshing } = usePullToRefresh(() =>
    qc.invalidateQueries({ queryKey: ['apps'] }),
  )

  const colors = useMemo(
    () => Object.fromEntries((instances.data ?? []).map((i) => [i.name, i.color])),
    [instances.data],
  )

  const visible = useMemo(() => {
    const list = (apps.data?.apps ?? []).filter((a) => {
      if (filter.instance && a.instance !== filter.instance) return false
      if (filter.broken && a.health !== 'Degraded' && a.health !== 'Missing') return false
      if (filter.outOfSync && a.sync !== 'OutOfSync') return false
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
  }, [apps.data, filter])

  const chip = (active: boolean) =>
    `shrink-0 rounded-full border px-3 py-1.5 text-sm ${
      active ? 'border-accent text-accent' : 'border-border text-muted'
    }`

  return (
    <div>
      <header className="pt-safe sticky top-0 z-10 border-b border-border bg-bg/95 px-4 pb-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Applications</h1>
          <span className="text-xs text-muted">
            {visible.length}
            {refreshing || apps.isFetching ? ' · refreshing' : ''}
          </span>
        </div>
        <input
          value={filter.q}
          onChange={(e) => setFilter({ ...filter, q: e.target.value })}
          placeholder="Search"
          className="mt-3 h-10 w-full rounded-lg border border-border bg-surface px-3 outline-none focus:border-accent"
        />
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          <button className={chip(filter.broken)} onClick={() => setFilter({ ...filter, broken: !filter.broken })}>
            Broken
          </button>
          <button
            className={chip(filter.outOfSync)}
            onClick={() => setFilter({ ...filter, outOfSync: !filter.outOfSync })}
          >
            OutOfSync
          </button>
          {(instances.data ?? []).map((i) => (
            <button
              key={i.name}
              className={chip(filter.instance === i.name)}
              onClick={() =>
                setFilter({ ...filter, instance: filter.instance === i.name ? '' : i.name })
              }
            >
              <span className="mr-1.5 inline-block size-2 rounded-full align-middle" style={{ background: i.color }} />
              {i.name}
            </button>
          ))}
        </div>
      </header>

      {pull > 0 && <div className="py-2 text-center text-xs text-muted">Pull to refresh</div>}

      {(apps.data?.errors ?? []).map((e) => (
        <div key={e.instance} className="border-b border-border bg-[#3a1d22] px-4 py-2 text-sm">
          <strong>{e.instance}</strong> is unreachable — {e.message}
        </div>
      ))}

      {apps.isError && (
        <p className="p-4 text-sm text-[#e96d76]">Could not load applications: {String(apps.error)}</p>
      )}

      {visible.map((a) => (
        <AppRow key={`${a.instance}/${a.name}`} app={a} color={colors[a.instance] ?? '#8b93a7'} />
      ))}

      {!apps.isLoading && visible.length === 0 && (
        <p className="p-8 text-center text-sm text-muted">No applications match the filters.</p>
      )}
    </div>
  )
}
