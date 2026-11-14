import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CircleCheck, ServerOff } from 'lucide-react'
import { useApps, useInstances } from '../api/queries'
import { AppRow } from '../components/AppRow'
import { AppListSkeleton } from '../components/Skeleton'
import { ScreenHeader } from '../components/ScreenHeader'
import { Button, Callout, EmptyState, Seg } from '../components/ui'
import { bucketOf, type Bucket } from '../lib/fleet'
import { stateStyle } from '../lib/status'
import type { App } from '../api/types'

/** Triage order, which is the order the groups are read in. */
const GROUPS: Exclude<Bucket, 'Healthy'>[] = ['Degraded', 'OutOfSync', 'Progressing', 'Suspended', 'Unknown']

/**
 * WHAT NEEDS A LOOK, AND NOTHING ELSE.
 *
 * The list is the fleet; this is the fleet minus the ninety-one applications
 * that are healthy and synced, grouped by what is wrong with the rest, worst
 * first. It is the screen to open at three in the morning, and the number on
 * its tab says whether there is any reason to.
 *
 * Built entirely from the list MazeCD already holds — the same query, the
 * same live streams — so it is never a request behind the list, and never
 * says something the list does not.
 */
export function Attention() {
  const apps = useApps()
  const instances = useInstances()
  const [params, setParams] = useSearchParams()
  const instance = params.get('instance') ?? ''

  const all = useMemo(() => apps.data?.apps ?? [], [apps.data])
  const loud = useMemo(() => all.filter((a) => bucketOf(a) !== 'Healthy'), [all])
  const names = useMemo(() => (instances.data ?? []).map((i) => i.name), [instances.data])
  const shown = instance ? loud.filter((a) => a.instance === instance) : loud

  const groups = useMemo(() => {
    const m = new Map<Bucket, App[]>()
    for (const a of shown) {
      const b = bucketOf(a)
      m.set(b, [...(m.get(b) ?? []), a])
    }
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name))
    return GROUPS.filter((g) => m.has(g)).map((g) => ({ bucket: g, apps: m.get(g)! }))
  }, [shown])

  const calm = all.length - loud.length

  return (
    <div>
      <ScreenHeader
        title="Attention"
        sub={
          apps.isLoading && !apps.data ? (
            <span className="skel inline-block h-2.5 w-24 align-middle" aria-hidden="true" />
          ) : (
            <>
              <b className="font-medium text-muted">
                {loud.length} of {all.length}
              </b>{' '}
              need a look · worst first
            </>
          )
        }
      />

      {names.length > 1 && loud.length > 0 && (
        <Seg
          label="Instance"
          className="mx-3.5"
          value={instance}
          onChange={(v) => setParams(v ? { instance: v } : {}, { replace: true })}
          options={[
            { value: '', label: 'all', count: loud.length },
            ...names.map((n) => ({ value: n, label: n, count: loud.filter((a) => a.instance === n).length })),
          ]}
        />
      )}

      {apps.isError && (
        <div className="mx-3.5 mt-2">
          <Callout
            icon={<ServerOff size={17} strokeWidth={2} />}
            title="MazeCD could not load the fleet"
            action={
              <Button className="!h-10" onClick={() => void apps.refetch()}>
                Try again
              </Button>
            }
          >
            <span className="t-mono block text-[11.5px]">{String(apps.error)}</span>
          </Callout>
        </div>
      )}

      {apps.isLoading && !apps.data ? (
        <AppListSkeleton />
      ) : (
        groups.map(({ bucket, apps: members }) => {
          const s = stateStyle(bucket)
          return (
            <section key={bucket}>
              <h2 className="t-mono mx-[18px] mt-4 mb-1.5 flex items-center gap-2 text-[10px] tracking-[0.13em] text-muted uppercase">
                <i className="block size-2 flex-none rounded-[2px]" style={{ background: s.color }} aria-hidden="true" />
                <b className="font-semibold text-text">{s.label}</b>
                {members.length}
                <span className="h-px flex-1 bg-[var(--edge-strong)]" aria-hidden="true" />
              </h2>
              <div className="card mx-3.5 overflow-hidden">
                {members.map((a) => (
                  <AppRow key={`${a.instance}/${a.name}`} app={a} />
                ))}
              </div>
            </section>
          )
        })
      )}

      {apps.data && loud.length === 0 && !apps.isError && (
        <EmptyState icon={<CircleCheck size={22} strokeWidth={1.8} className="text-healthy" />} title="Nothing needs a look">
          All {all.length} applications are healthy and synced.
        </EmptyState>
      )}

      {apps.data && loud.length > 0 && calm > 0 && (
        <p className="t-mono mx-[18px] mt-4 flex items-center gap-2 text-[10.5px] text-dim">
          <i className="block size-2 flex-none rounded-[2px] bg-healthy" aria-hidden="true" />
          {calm} healthy and synced, not shown here
        </p>
      )}
    </div>
  )
}
