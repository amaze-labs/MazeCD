import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PlugZap, RefreshCw, Search, SearchX, ServerOff, Unplug, X } from 'lucide-react'
import { useApps, useInstances } from '../api/queries'
import { refreshApp } from '../api/actions'
import { AppRow } from '../components/AppRow'
import { FleetCounters } from '../components/FleetCounters'
import { AppListSkeleton } from '../components/Skeleton'
import { bucketOf, countBy, type Bucket } from '../lib/fleet'
import { healthRank } from '../lib/status'
import { usePullToRefresh } from '../lib/pullToRefresh'
import { useOnline } from '../lib/online'
import { runLimited } from '../lib/pool'
import { toast } from '../lib/toast'
import { Button, Callout, EmptyState, IconButton, Seg } from '../components/ui'
import { ScreenHeader } from '../components/ScreenHeader'

type Filter = { instance: string; state: Bucket | ''; q: string }

export function Apps() {
  const apps = useApps()
  const instances = useInstances()
  // The filter lives in the URL, so opening an application and coming back
  // lands on the same tab and the same search rather than on "all". Replace,
  // not push: every keystroke in the search box would otherwise be a history
  // entry to back out of.
  const [params, setParams] = useSearchParams()
  const filter: Filter = {
    instance: params.get('instance') ?? '',
    state: (params.get('state') ?? '') as Filter['state'],
    q: params.get('q') ?? '',
  }
  const setFilter = (f: Filter) =>
    setParams(Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')), { replace: true })
  const [busy, setBusy] = useState(false)
  const [searching, setSearching] = useState(false)
  const online = useOnline()

  // One way to ask again, used by the pull gesture and by every Retry on this
  // screen -- so what the operator is told is the same sentence however they
  // asked. A refresh that reports nothing is indistinguishable from a tap
  // that missed.
  const reload = async () => {
    const r = await apps.refetch()
    if (r.isError) {
      toast('fail', 'Could not reach MazeCD', String(r.error))
      return
    }
    const missing = r.data?.errors?.length ?? 0
    toast(
      'ok',
      `${r.data?.apps.length ?? 0} applications refreshed`,
      missing > 0
        ? `${missing} instance${missing === 1 ? '' : 's'} still did not answer.`
        : undefined,
    )
  }

  const { pull, refreshing } = usePullToRefresh(reload)

  const all = useMemo(() => apps.data?.apps ?? [], [apps.data])
  const counts = useMemo(() => countBy(all), [all])
  const names = useMemo(() => (instances.data ?? []).map((i) => i.name), [instances.data])
  const perInstance = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of all) m.set(a.instance, (m.get(a.instance) ?? 0) + 1)
    return m
  }, [all])

  const visible = useMemo(() => {
    const list = all.filter((a) => {
      if (filter.instance && a.instance !== filter.instance) return false
      if (filter.state && bucketOf(a) !== filter.state) return false
      if (filter.q) {
        const q = filter.q.toLowerCase()
        if (![a.name, a.project, a.destNamespace].some((s) => s.toLowerCase().includes(q))) return false
      }
      return true
    })
    // Triage order: broken first, then out of sync, then alphabetical.
    return list.sort(
      (a, b) =>
        healthRank(a.health) - healthRank(b.health) ||
        Number(b.sync === 'OutOfSync') - Number(a.sync === 'OutOfSync') ||
        a.name.localeCompare(b.name),
    )
  }, [all, filter.instance, filter.state, filter.q])

  const filtered = filter.instance !== '' || filter.state !== '' || filter.q !== ''

  /**
   * The detail screen's Refresh, for every application on the screen at
   * once. It acts on what is visible — one instance when one is picked, the
   * whole fleet when nothing is — and it asks ArgoCD, not MazeCD: the pull
   * gesture re-reads the list, this makes the instances re-read the apps.
   * Four at a time, so fifty applications are not fifty simultaneous
   * requests against one instance. Normal refresh only; hard is a
   * per-application decision and stays on the detail screen.
   */
  const refreshAll = async () => {
    setBusy(true)
    try {
      const { ok, failed } = await runLimited(visible, 4, (a) => refreshApp(a.instance, a.name, false))
      await apps.refetch()
      toast(
        failed > 0 ? 'fail' : 'ok',
        `Refresh requested for ${ok} application${ok === 1 ? '' : 's'}`,
        failed > 0 ? `${failed} did not go through.` : undefined,
      )
    } finally {
      setBusy(false)
    }
  }

  const searchOpen = searching || filter.q !== ''

  return (
    <div>
      {/* Nothing on this screen is pinned. On an 852px phone every pinned row
          is an application the operator cannot see, and the counters, the
          instances and the search do their job on arrival. */}
      <ScreenHeader
        title="Applications"
        sub={
          // A count of 0 beside a screen full of skeletons is a statement,
          // and it is the wrong one: nothing has been counted yet.
          apps.isLoading && !apps.data ? (
            <span className="skel inline-block h-2.5 w-24 align-middle" aria-hidden="true" />
          ) : refreshing ? (
            'updating'
          ) : filtered ? (
            <>
              <b className="font-medium text-muted">{visible.length}</b> of {all.length}
            </>
          ) : (
            <>
              <b className="font-medium text-muted">{all.length}</b> across {names.length || 1} instance
              {names.length === 1 ? '' : 's'} · live
            </>
          )
        }
        action={
          // The detail screen's Refresh, for every application on the screen
          // at once — the one thing this header does, so it is the one
          // control in it.
          <IconButton
            onClick={() => void refreshAll()}
            disabled={busy || !online || visible.length === 0}
            aria-label={
              filter.instance ? `Refresh every application on ${filter.instance}` : 'Refresh every application'
            }
            title="Refresh apps"
          >
            <RefreshCw size={16} strokeWidth={2} className={busy ? 'spin' : ''} aria-hidden="true" />
          </IconButton>
        }
      />

      <FleetCounters
        counts={counts}
        active={filter.state}
        onPick={(state) => setFilter({ ...filter, state })}
      />

      {/* Instances, and the search beside them: a place is a tab, and a
          search is a question asked of whatever place is chosen. */}
      <div className="mx-3.5 mt-2 flex gap-1.5">
        {names.length > 1 ? (
          <Seg
            label="Instance"
            className="min-w-0 flex-1"
            value={filter.instance}
            onChange={(instance) => setFilter({ ...filter, instance })}
            options={[
              { value: '', label: 'all', count: all.length },
              ...names.map((n) => ({ value: n, label: n, count: perInstance.get(n) ?? 0 })),
            ]}
          />
        ) : (
          <span className="flex-1" />
        )}
        <IconButton
          onClick={() => {
            if (searchOpen) {
              setSearching(false)
              setFilter({ ...filter, q: '' })
            } else setSearching(true)
          }}
          aria-label={searchOpen ? 'Close the search' : 'Search'}
          aria-expanded={searchOpen}
        >
          {searchOpen ? (
            <X size={16} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Search size={16} strokeWidth={2} aria-hidden="true" />
          )}
        </IconButton>
      </div>

      {searchOpen && (
        <div className="mx-3.5 mt-2">
          <input
            autoFocus
            value={filter.q}
            onChange={(e) => setFilter({ ...filter, q: e.target.value })}
            placeholder="name, project or namespace"
            aria-label="Find an application"
            className="t-mono h-10 w-full rounded-control bg-panel px-3 text-[12.5px] ring-1 ring-[var(--edge-strong)] outline-none ring-inset placeholder:text-dim focus:ring-[var(--edge-active)]"
          />
        </div>
      )}

      {pull > 0 && <p className="t-mono pt-2 text-center text-[11px] text-dim">keep pulling to refresh</p>}

      {/* The case that matters most: one instance is unreachable and the other
          two are fine. The list below is *correct*, it is just short by one
          instance, and only this panel can say which one and offer to ask
          again. */}
      {(apps.data?.errors ?? []).map((e) => (
        <div key={e.instance} className="mx-3.5 mt-2">
          <Callout
            icon={<Unplug size={17} strokeWidth={2} />}
            title={
              <>
                <span className="t-mono">{e.instance}</span> did not answer
              </>
            }
            action={
              <Button className="!h-10" onClick={() => void reload()}>
                Try that instance again
              </Button>
            }
          >
            {e.message}. Everything below is still true for the other instances — this list is
            short by one, not wrong.
          </Callout>
        </div>
      ))}

      {apps.isError && (
        <div className="mx-3.5 mt-2">
          <Callout
            icon={<ServerOff size={17} strokeWidth={2} />}
            title="MazeCD could not load the fleet"
            action={
              <Button className="!h-10" onClick={() => void reload()}>
                Try again
              </Button>
            }
          >
            <span className="t-mono block text-[11.5px]">{String(apps.error)}</span>
          </Callout>
        </div>
      )}

      {/* The shape of the list, before the list — and only on a first load
          with nothing cached: a refresh over applications already on screen
          must not replace them with grey bars. */}
      {apps.isLoading && !apps.data ? (
        <AppListSkeleton />
      ) : (
        visible.length > 0 && (
          <div className="card mx-3.5 mt-2 overflow-hidden">
            {visible.map((a) => (
              <AppRow key={`${a.instance}/${a.name}`} app={a} />
            ))}
          </div>
        )
      )}

      {!apps.isLoading &&
        visible.length === 0 &&
        !apps.isError &&
        (filtered ? (
          <EmptyState
            icon={<SearchX size={22} strokeWidth={1.6} />}
            title="Nothing matches this filter"
            action={
              <Button onClick={() => setFilter({ instance: '', state: '', q: '' })}>
                Show all {all.length} applications
              </Button>
            }
          >
            {all.length} applications are loaded; none of them is in this state, on this instance,
            or named like this.
          </EmptyState>
        ) : (
          <EmptyState
            icon={<PlugZap size={22} strokeWidth={1.6} />}
            title="No applications yet"
            action={<Button onClick={() => void reload()}>Check again</Button>}
          >
            Every instance answered, and none of them has an application. Settings shows which
            instances are configured and whether their tokens are still being accepted.
          </EmptyState>
        ))}
    </div>
  )
}
