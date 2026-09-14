import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft,
  CornerDownRight,
  EllipsisVertical,
  ListFilter,
  ListTree,
  RefreshCw,
  ServerOff,
} from 'lucide-react'
import { useAppDetail, useResourceTree } from '../api/queries'
import { Groups, refKey, Tree } from '../components/Tree'
import { AutoMark, Button, Callout, Fact, Rail, SyncWord } from '../components/ui'
import { AppDetailSkeleton, TreeSkeleton } from '../components/Skeleton'
import { Sheet } from '../components/Sheet'
import { ResourceSheet } from '../components/ResourceSheet'
import { refreshApp } from '../api/actions'
import { useOnline } from '../lib/online'
import { useLiveTree } from '../lib/live'
import { healthLoud } from '../lib/fleet'
import { stateStyle } from '../lib/status'
import { toast } from '../lib/toast'
import { ago } from '../lib/ago'
import { EventsTab } from './tabs/EventsTab'
import type { ResourceNode, SyncStatus } from '../api/types'

type View = 'grouped' | 'tree'

export function AppDetailScreen() {
  const { instance = '', name = '' } = useParams()
  const detail = useAppDetail(instance, name)
  const tree = useResourceTree(instance, name)
  // The application's own state already streams, fleet-wide, from the Shell.
  // Its resources are the other half of "in real time", and ArgoCD watches
  // them on an endpoint of their own.
  useLiveTree(instance, name)
  const online = useOnline()
  const [view, setView] = useState<View>('grouped')
  const [onlyLoud, setOnlyLoud] = useState(false)
  const [selected, setSelected] = useState<ResourceNode | null>(null)
  const [menu, setMenu] = useState(false)
  const [events, setEvents] = useState(false)
  const [busy, setBusy] = useState(false)

  const spec = detail.data?.spec
  const status = detail.data?.status
  const op = status?.operationState
  const health = status?.health?.status ?? ''
  const when = ago(op?.finishedAt)
  const auto = spec?.syncPolicy?.automated != null

  const qc = useQueryClient()

  /**
   * The sync half of a resource's two marks.
   *
   * ArgoCD reports sync per resource only on the application's own *managed*
   * resources — `status.resources[]` — while the resource tree returns the
   * whole hierarchy, children included. A Pod under a ReplicaSet has no sync
   * status of its own and never will, so the lookup returns undefined and the
   * row draws a `?`: "nobody said", which is a different claim from a status
   * ArgoCD named Unknown.
   */
  const syncByKey = useMemo(() => {
    const m = new Map<string, SyncStatus>()
    for (const r of status?.resources ?? []) if (r.status) m.set(refKey(r), r.status)
    return m
  }, [status?.resources])
  const syncOf = (n: ResourceNode) => syncByKey.get(refKey(n))

  const nodes = tree.data?.nodes ?? []
  const degraded = nodes.filter((n) => n.health?.status && healthLoud(n.health.status)).length
  const shown = onlyLoud
    ? nodes.filter((n) => (n.health?.status && healthLoud(n.health.status)) || syncOf(n) === 'OutOfSync')
    : nodes

  /**
   * The one action, and the one receipt. A refresh against a healthy instance
   * comes back in under 200ms: the icon turned once and the screen looked
   * exactly as it had, so a tap that worked and a tap that missed the button
   * were the same event. The receipt says which of the two it was, and names
   * the hard variant when that is what ran.
   */
  async function act(hard: boolean) {
    setBusy(true)
    try {
      await refreshApp(instance, name, hard)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['app', instance, name] }),
        qc.invalidateQueries({ queryKey: ['tree', instance, name] }),
        qc.invalidateQueries({ queryKey: ['apps'] }),
      ])
      toast(
        'ok',
        hard ? 'Hard refresh requested' : 'Refresh requested',
        hard
          ? `${instance} is re-rendering the manifests for ${name} and comparing them again.`
          : `${instance} is re-reading ${name} from the cluster.`,
      )
    } catch (e) {
      toast('fail', 'That did not go through', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="pt-safe flex items-center justify-between pr-2 pl-2.5">
        <Link to="/" className="t-mono flex h-12 items-center gap-2 px-1.5 text-[12.5px]">
          <ChevronLeft size={12} strokeWidth={1.4} aria-hidden="true" />
          Applications
        </Link>
        {/* Everything this screen can do that is not Refresh. The hard
            refresh used to live on a 600ms press with a tooltip explaining
            it; a press timer is not an affordance, and the events were a tab
            competing with the resource list for the same strip. Both are
            entries in one menu now, which is what the ⋮ is for. */}
        <button
          onClick={() => setMenu(true)}
          aria-label="More"
          className="grid size-11 place-items-center text-muted"
        >
          <EllipsisVertical size={16} aria-hidden="true" />
        </button>
      </div>

      {detail.isError ? (
        <div className="mx-4">
          <Callout
            icon={<ServerOff size={17} strokeWidth={2} />}
            title="Could not load this application"
            action={
              <Button className="!h-10" onClick={() => void detail.refetch()}>
                Try again
              </Button>
            }
          >
            <span className="t-mono block text-[11.5px]">{String(detail.error)}</span>
          </Callout>
        </div>
      ) : detail.isLoading && !detail.data ? (
        <AppDetailSkeleton />
      ) : (
        <>
          {/* THE RAIL APPEARS EXACTLY ONCE ON THIS SCREEN, beside the name,
              where all three of its states are real. A resource further down
              has health and sync but no auto-sync of its own, so a rail there
              would be half a mark pretending to be a whole one. */}
          <div className="flex gap-[13px] pt-1.5 pr-4 pb-4 pl-[13px]">
            <Rail health={health} auto={auto} />
            <div className="min-w-0 flex-1">
              <div className="t-mono mb-[3px] text-[11px] text-dim">
                <span className="text-muted">{instance}</span>
                <i className="sep" aria-hidden="true" />
                {spec?.project}
              </div>
              <h1 className="mb-[7px] text-[26px] leading-[1.05] font-semibold tracking-[-0.025em]">
                {name}
              </h1>
              <div className="t-mono flex flex-wrap items-center gap-[9px] text-[12px]">
                <span
                  className="font-sans text-[14px] font-[560]"
                  style={{ color: healthLoud(health) ? stateStyle(health).color : undefined }}
                >
                  {stateStyle(health).label}
                </span>
                <i className="sep !mx-px" aria-hidden="true" />
                <SyncWord sync={status?.sync?.status ?? ''} />
                <i className="sep !mx-px" aria-hidden="true" />
                {/* On the detail there is room to say it in words, so the
                    bolt is not asked to carry the whole fact alone. */}
                <AutoMark auto={auto} verbose />
              </div>
              {status?.health?.message && healthLoud(health) && (
                <p
                  className="mt-2 flex gap-[7px] text-[11px] leading-[1.35]"
                  style={{ color: stateStyle(health).color }}
                >
                  <CornerDownRight
                    size={11}
                    strokeWidth={1.2}
                    className="mt-0.5 flex-none"
                    aria-hidden="true"
                  />
                  {status.health.message}
                </p>
              )}
            </div>
          </div>

          {/* The key/value table: hairline rules, no container, no radius, no
              fill. A tinted rounded panel is exactly what got an earlier
              attempt rejected. Fields with no value are not drawn at all — a
              column of em-dashes is not a specification. */}
          <dl className="m-0 border-y border-rule">
            <Fact label="namespace" value={spec?.destination.namespace} />
            <Fact label="repository" value={spec?.source?.repoURL} />
            <Fact label="target rev" value={spec?.source?.targetRevision} />
            <Fact label="cluster" value={spec?.destination.server} />
            <Fact label="revision" value={status?.sync?.revision?.slice(0, 7)} />
            {op && (
              <Fact label="finished">
                {op.phase && (
                  <span
                    className={
                      op.phase === 'Failed'
                        ? 'text-degraded'
                        : op.phase === 'Succeeded'
                          ? 'text-healthy'
                          : 'text-progressing'
                    }
                  >
                    {op.phase.toLowerCase()}{' '}
                  </span>
                )}
                {when?.long ?? 'not recorded'}
              </Fact>
            )}
            <Fact label="message" value={op?.message} prose />
          </dl>

          {/* Refresh runs the full width because it is now the only action in
              the product — every mutation was cut, and ArgoCD counts this as
              a read. */}
          <div className="flex px-4 py-4.5">
            <Button className="flex-1" onClick={() => void act(false)} disabled={!online}>
              <RefreshCw size={13} strokeWidth={1.35} className={busy ? 'spin' : ''} aria-hidden="true" />
              Refresh
            </Button>
          </div>
        </>
      )}

      <div className="flex items-center justify-between gap-2.5 border-b border-rule px-4 py-3.5">
        <span className="t-mono text-[11px] leading-[1.6] text-dim">
          resources
          <br />
          <b className="font-normal text-text">{nodes.length}</b>{' '}
          {degraded > 0 && <span className="text-degraded">{degraded} degraded</span>}
        </span>
        <span className="flex items-center gap-2.5">
          <button
            onClick={() => setOnlyLoud(!onlyLoud)}
            aria-pressed={onlyLoud}
            aria-label="Show only resources that need looking at"
            className="grid size-12 flex-none place-items-center rounded-control text-muted ring-1 ring-rule"
            style={onlyLoud ? { boxShadow: 'inset 0 0 0 1px var(--edge-active)', color: 'var(--color-text)' } : undefined}
          >
            <ListFilter size={15} strokeWidth={1.3} aria-hidden="true" />
          </button>
          {/* A pill containing two pills, the active one carrying an inset ink
              ring rather than a fill. */}
          <span className="flex rounded-control ring-1 ring-rule" role="tablist">
            {(['grouped', 'tree'] as View[]).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`t-mono flex h-[46px] items-center gap-1.5 rounded-segment px-[15px] text-[11.5px] ${
                  view === v ? 'text-text' : 'text-dim'
                }`}
                style={view === v ? { boxShadow: 'inset 0 0 0 1px var(--edge-active)' } : undefined}
              >
                {v === 'tree' && <ListTree size={12} strokeWidth={1.2} aria-hidden="true" />}
                {v === 'grouped' ? 'Grouped' : 'Tree'}
              </button>
            ))}
          </span>
        </span>
      </div>

      {tree.isError ? (
        <div className="mx-4 mt-3">
          <Callout
            icon={<ServerOff size={17} strokeWidth={2} />}
            title="Could not load the resource tree"
            action={
              <Button className="!h-10" onClick={() => void tree.refetch()}>
                Try again
              </Button>
            }
          >
            <span className="t-mono block text-[11.5px]">{String(tree.error)}</span>
          </Callout>
        </div>
      ) : tree.isLoading && !tree.data ? (
        <TreeSkeleton />
      ) : view === 'grouped' ? (
        <Groups nodes={shown} syncOf={syncOf} onSelect={setSelected} />
      ) : (
        <Tree nodes={shown} onSelect={setSelected} />
      )}

      <Sheet open={menu} onClose={() => setMenu(false)} title={name}>
        <div className="-mx-4">
          <button
            onClick={() => {
              setMenu(false)
              setEvents(true)
            }}
            className="flex h-14 w-full items-center border-b border-rule px-4 text-left text-[14px]"
          >
            Events
            <span className="t-mono ml-auto text-[11px] text-dim">what ArgoCD recorded</span>
          </button>
          <button
            onClick={() => {
              setMenu(false)
              void act(true)
            }}
            disabled={!online}
            className="flex h-14 w-full items-center px-4 text-left text-[14px] disabled:opacity-40"
          >
            Hard refresh
            <span className="t-mono ml-auto text-[11px] text-dim">re-render the manifests</span>
          </button>
        </div>
      </Sheet>

      <Sheet open={events} onClose={() => setEvents(false)} title="Events">
        <div className="-mx-4">
          <EventsTab instance={instance} name={name} />
        </div>
      </Sheet>

      {selected && (
        <ResourceSheet
          node={selected}
          instance={instance}
          app={name}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
