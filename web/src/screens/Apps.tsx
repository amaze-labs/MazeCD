import { useMemo, useState } from 'react'
import { PlugZap, Search, SearchX, ServerOff, Unplug } from 'lucide-react'
import { useApps, useInstances } from '../api/queries'
import { AppRow } from '../components/AppRow'
import { FleetCounters } from '../components/FleetCounters'
import { AppListSkeleton } from '../components/Skeleton'
import { bucketOf, countBy, type Bucket } from '../lib/fleet'
import { healthRank } from '../lib/status'
import { usePullToRefresh } from '../lib/pullToRefresh'
import { toast } from '../lib/toast'
import { Button, Callout, EmptyState } from '../components/ui'

type Filter = { instance: string; state: Bucket | ''; q: string }

export function Apps() {
  const apps = useApps()
  const instances = useInstances()
  const [filter, setFilter] = useState<Filter>({ instance: '', state: '', q: '' })

  // One way to ask again, used by the pull gesture and by every Retry on
  // this screen -- so what the operator is told is the same sentence however
  // they asked. A refresh that reports nothing is what this screen used to
  // do, and it was indistinguishable from a tap that missed.
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
        <div className="flex shrink-0 items-center gap-2">
          {/* A count of 0 beside a screen full of skeletons is a statement,
              and it is the wrong one: nothing has been counted yet. */}
          {apps.isLoading && !apps.data ? (
            <span className="skel block h-3 w-7" aria-hidden="true" />
          ) : (
            <span className="text-[13px] text-muted tabular-nums">
              {refreshing ? 'Updating' : filtered ? `${visible.length} of ${all.length}` : all.length}
            </span>
          )}
        </div>
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
            // A field needs an edge on paper: a white input on a near-white
            // page had none, and the instance chips one row below already
            // carry exactly this hairline.
            className="h-11 w-full rounded-control bg-panel pr-3 pl-9 text-[15px] ring-1 ring-rule outline-none placeholder:text-muted focus:bg-raised"
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
                  // Outlined either way; what changes is the weight of the
                  // edge and the colour of the word. The filled version of
                  // this control was a block of an arbitrary configuration
                  // colour sitting above the list it was filtering.
                  className="flex h-11 shrink-0 items-center gap-2 rounded-control px-3 text-[14px]"
                  style={{
                    boxShadow: `inset 0 0 0 ${on ? 2 : 1}px ${
                      on ? i.color : 'var(--color-rule)'
                    }`,
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

      {/* The case that matters most: one instance is unreachable and the
          other two are fine. The contract has always been partial results
          plus a banner, and the banner is the whole of it -- the list below
          is *correct*, it is just short by one instance, and only this panel
          can say which one and offer to ask again. A line of red text could
          not, which is why it is a panel with a border and an action. */}
      {(apps.data?.errors ?? []).map((e) => (
        <div key={e.instance} className="mx-4 mt-3">
          <Callout
            icon={<Unplug size={17} strokeWidth={2.2} />}
            title={<><span className="t-mono">{e.instance}</span> did not answer</>}
            action={
              <Button className="!h-10 !text-[14px]" onClick={() => void reload()}>
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
            icon={<ServerOff size={17} strokeWidth={2.2} />}
            title="MazeCD could not load the fleet"
            action={
              <Button className="!h-10 !text-[14px]" onClick={() => void reload()}>
                Try again
              </Button>
            }
          >
            <span className="t-mono block text-[12px]">{String(apps.error)}</span>
          </Callout>
        </div>
      )}

      {/* The shape of the list, before the list. Only on a first load with
          nothing cached: a refresh over applications already on screen must
          not replace them with grey bars. */}
      {/* The columns, named. Three small letter-spaced capitals on the list's
          own grid tracks, once, above ninety-nine rows.

          This replaces the ⓘ that used to sit in the header explaining what
          the two numeric columns were. An ⓘ explaining a column is a label
          that was not written: it costs a tap, it is invisible until taken,
          and it admits in the header that the data below is unreadable. A
          header row costs 14px on arrival, applies to every row at once, and
          is the device a spec sheet has used for a century.

          What is lost with the ⓘ is one sentence of nuance — that the age is
          about the last *operation* and not about how long the application
          has been broken. `LAST OP` says the load-bearing half of that in two
          words, and the long form survives on each cell's title and
          aria-label, where a screen reader still reads it.

          It is drawn over the skeleton too. The skeleton's whole contract is
          that nothing moves when the data lands, and a header row that
          appears with the first application would push all ninety-nine down
          by 22px at exactly the moment the eye had settled. */}
      {(visible.length > 0 || (apps.isLoading && !apps.data)) && (
        <div
          aria-hidden="true"
          className="mt-2.5 grid grid-cols-[3.25rem_minmax(0,1fr)_2.25rem] gap-x-2.5 px-[1.625rem] text-[10px] leading-[14px] font-semibold tracking-[0.14em] text-muted uppercase"
        >
          <span className="text-right">Last op</span>
          <span>Application</span>
          <span className="text-right">Res</span>
        </div>
      )}

      {apps.isLoading && !apps.data ? (
        <AppListSkeleton />
      ) : (
        <div className="mt-1 flex flex-col gap-1.5 px-4 pb-2">
          {visible.map((a) => (
            <AppRow
              key={`${a.instance}/${a.name}`}
              app={a}
              color={colors[a.instance] ?? 'var(--color-muted)'}
            />
          ))}
        </div>
      )}

      {!apps.isLoading && visible.length === 0 && !apps.isError && (
        filtered ? (
          <EmptyState
            icon={<SearchX size={22} strokeWidth={2} />}
            title="Nothing matches this filter"
            action={
              <Button onClick={() => setFilter({ instance: '', state: '', q: '' })}>
                Show all {all.length} applications
              </Button>
            }
          >
            {all.length} applications are loaded; none of them is in this state, on this
            instance, or named like this.
          </EmptyState>
        ) : (
          <EmptyState
            icon={<PlugZap size={22} strokeWidth={2} />}
            title="No applications yet"
            action={
              <Button onClick={() => void reload()}>Check again</Button>
            }
          >
            Every instance answered, and none of them has an application. Settings shows which
            instances are configured and whether their tokens are still being accepted.
          </EmptyState>
        )
      )}
    </div>
  )
}
