import { useMemo, useState } from 'react'
import { PlugZap, RefreshCw, SearchX, ServerOff, Unplug } from 'lucide-react'
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
import { Button, Callout, EmptyState } from '../components/ui'

type Filter = { instance: string; state: Bucket | ''; q: string }

export function Apps() {
  const apps = useApps()
  const instances = useInstances()
  const [filter, setFilter] = useState<Filter>({ instance: '', state: '', q: '' })
  const [busy, setBusy] = useState(false)
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

  return (
    <div>
      {/* Nothing on this screen is pinned. On an 852px phone every pinned row
          is an application the operator cannot see, and the counters, the
          instances and the legend do their job on arrival. */}
      <header className="pt-safe flex items-end justify-between gap-3 px-4 pb-3.5">
        <h1 className="text-[23px] font-semibold tracking-[-0.02em]">Applications</h1>
        <div className="t-mono pb-[3px] text-[11.5px] text-muted">
          {/* A count of 0 beside a screen full of skeletons is a statement,
              and it is the wrong one: nothing has been counted yet. */}
          {apps.isLoading && !apps.data ? (
            <span className="skel block h-3 w-16" aria-hidden="true" />
          ) : refreshing ? (
            'updating'
          ) : filtered ? (
            <>
              <b className="font-semibold text-text">{visible.length}</b> of {all.length}
            </>
          ) : (
            <>
              <b className="font-semibold text-text">{all.length}</b> across {names.length || 1}{' '}
              instance{names.length === 1 ? '' : 's'}
            </>
          )}
        </div>
      </header>

      <FleetCounters
        counts={counts}
        active={filter.state}
        onPick={(state) => setFilter({ ...filter, state })}
      />

      {/* Instances: an underline, not a pill. Which server an application
          lives on is a place, and a place is a tab. The instance colours the
          configuration file happens to carry are not spent here — this
          palette spends colour only on status. */}
      <div className="t-mono flex items-center gap-3 border-b border-rule pr-4">
        {/* Only the tabs scroll. The button sits outside the scrolling box,
            or a long row of instance names pushes it off the right edge. */}
        <div className="flex min-w-0 flex-1 gap-[22px] overflow-x-auto px-4">
          {names.length > 1 &&
            ['', ...names].map((n) => (
              <button
                key={n || 'all'}
                aria-selected={filter.instance === n}
                role="tab"
                onClick={() => setFilter({ ...filter, instance: n })}
                className={`-mb-px h-[46px] flex-none border-b-2 text-[12px] ${
                  filter.instance === n ? 'border-text text-text' : 'border-transparent text-muted'
                }`}
              >
                {n || 'all'}
              </button>
            ))}
        </div>
        {/* Beside the thing it acts on: the selected instance, or all of
            them. Named for what it will do, because an icon alone read as
            "reload the list" — which is the pull gesture's job, not this
            one's. */}
        <Button
          onClick={() => void refreshAll()}
          disabled={busy || !online || visible.length === 0}
          className="!h-8 flex-none !px-3 !text-[11.5px] whitespace-nowrap"
          aria-label={
            filter.instance ? `Refresh every application on ${filter.instance}` : 'Refresh every application'
          }
        >
          <RefreshCw size={12} strokeWidth={1.35} className={busy ? 'spin' : ''} aria-hidden="true" />
          <span className="max-w-[40vw] truncate">
            {filter.instance ? `Refresh ${filter.instance}` : 'Refresh all'}
          </span>
        </Button>
      </div>

      {/* The mockup does not draw this, because ninety-nine rows fit in a
          mockup and the eye is the filter there. It survives as a control in
          the mockup's own vocabulary — 48px, 10px, a hairline, no fill —
          rather than as the filled field it used to be. */}
      <div className="px-4 py-3">
        <input
          value={filter.q}
          onChange={(e) => setFilter({ ...filter, q: e.target.value })}
          placeholder="find an application"
          aria-label="Find an application"
          className="t-mono h-12 w-full rounded-control px-3.5 text-[12.5px] ring-1 ring-rule outline-none placeholder:text-dim"
        />
      </div>

      {/* The rail's second state, said once, in words. Two swatches and a
          sentence: the dashes are not decoration, they are the applications
          that will sit broken until somebody goes and presses something. */}
      <div className="flex items-center gap-[9px] border-y border-rule px-4 py-2.5 text-[10.5px] text-dim">
        <span className="h-[13px] w-[3px] flex-none bg-dim" aria-hidden="true" />
        <span>auto-sync</span>
        <span
          className="ml-2 h-[13px] w-[3px] flex-none"
          style={{
            background:
              'repeating-linear-gradient(to bottom, var(--color-dim) 0 4px, transparent 4px 8px)',
          }}
          aria-hidden="true"
        />
        <span>manual — nothing moves until you press sync</span>
      </div>

      {pull > 0 && <p className="pt-2 text-center text-[12px] text-dim">Keep pulling to refresh</p>}

      {/* The case that matters most: one instance is unreachable and the other
          two are fine. The list below is *correct*, it is just short by one
          instance, and only this panel can say which one and offer to ask
          again. */}
      {(apps.data?.errors ?? []).map((e) => (
        <div key={e.instance} className="mx-4 mt-3">
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
        <div className="mx-4 mt-3">
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
        visible.map((a) => <AppRow key={`${a.instance}/${a.name}`} app={a} />)
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
