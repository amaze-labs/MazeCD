import { useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft,
  ChevronRight,
  CornerDownRight,
  EllipsisVertical,
  GitCompareArrows,
  ListFilter,
  ListTree,
  OctagonX,
  RefreshCw,
  ServerOff,
} from 'lucide-react'
import { useAppDetail, useApps, useResourceTree } from '../api/queries'
import { Groups, refKey, Tree } from '../components/Tree'
import { AutoMark, Badge, Button, Callout, Chip, Facts, IconButton, Seg, SyncWord, tint } from '../components/ui'
import { AppDetailSkeleton, TreeSkeleton } from '../components/Skeleton'
import { Sheet } from '../components/Sheet'
import { ResourceSheet } from '../components/ResourceSheet'
import { SyncSheet } from '../components/SyncSheet'
import { DiffSheet } from '../components/DiffSheet'
import { ManifestsSheet } from '../components/ManifestsSheet'
import { refreshApp, terminateSync } from '../api/actions'
import { useOnline } from '../lib/online'
import { useLiveTree } from '../lib/live'
import { healthLoud, withFleetHealth } from '../lib/fleet'
import { stateStyle } from '../lib/status'
import { toast } from '../lib/toast'
import { ago } from '../lib/ago'
import { shortRev } from '../lib/rev'
import { EventsTab } from './tabs/EventsTab'
import type { ResourceNode, SyncStatus } from '../api/types'

type View = 'grouped' | 'tree'

export function AppDetailScreen() {
  const { instance = '', name = '' } = useParams()
  const detail = useAppDetail(instance, name)
  const tree = useResourceTree(instance, name)
  const fleet = useApps()
  // The application's own state already streams, fleet-wide, from the Shell.
  // Its resources are the other half of "in real time", and ArgoCD watches
  // them on an endpoint of their own.
  useLiveTree(instance, name)
  const online = useOnline()
  const [view, setView] = useState<View>('grouped')
  const [onlyLoud, setOnlyLoud] = useState(false)
  const [selected, setSelected] = useState<ResourceNode | null>(null)
  const [menu, setMenu] = useState(false)
  const [stopping, setStopping] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const [events, setEvents] = useState(false)
  const [sync, setSync] = useState(false)
  const [diff, setDiff] = useState(false)
  const [manifests, setManifests] = useState(false)
  const [busy, setBusy] = useState(false)

  const spec = detail.data?.spec
  const status = detail.data?.status
  const op = status?.operationState
  const health = status?.health?.status ?? ''
  const when = ago(op?.finishedAt)
  const auto = spec?.syncPolicy?.automated != null
  const hs = stateStyle(health)
  const loudHealth = healthLoud(health)

  const qc = useQueryClient()

  /**
   * A child Application in an app-of-apps is an application of this same
   * instance, and the fleet already has a screen for it. Everything else
   * opens as a resource.
   */
  const pick = (n: ResourceNode) => {
    if (n.group === 'argoproj.io' && n.kind === 'Application') {
      navigate(`/apps/${encodeURIComponent(instance)}/${encodeURIComponent(n.name)}`)
    } else {
      setSelected(n)
    }
  }

  /**
   * Stop the sync that is running. ArgoCD marks it Failed with "Operation
   * terminated" and leaves applied what was applied; the watch stream brings
   * the new state in. Offered only while one is running, and only after a
   * second tap: from a phone this is the action for a sync that has hung,
   * and the row says so before it acts.
   */
  async function stop() {
    setBusy(true)
    try {
      await terminateSync(instance, name)
      await qc.invalidateQueries({ queryKey: ['app', instance, name] })
      toast('ok', 'Stop requested', `${instance} is terminating the running sync of ${name}.`)
    } catch (e) {
      toast('fail', 'That did not go through', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setStopping(false)
      setMenu(false)
    }
  }

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

  const nodes = useMemo(
    () => withFleetHealth(tree.data?.nodes ?? [], fleet.data?.apps ?? [], instance),
    [tree.data?.nodes, fleet.data?.apps, instance],
  )
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
      <div className="pt-safe flex items-center justify-between pr-3.5 pb-2 pl-2">
        {/* Back to wherever the application was opened from — the list,
            Attention or Activity — and to the list when it was opened cold,
            from a link, with nothing in this app's history to go back to. */}
        <button
          onClick={() => (location.key === 'default' ? navigate('/') : navigate(-1))}
          className="t-mono flex h-10 items-center gap-1 px-1.5 text-[13px]"
        >
          <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" />
          Back
        </button>
        {/* Everything this screen can do that is not Refresh. The hard
            refresh used to live on a 600ms press with a tooltip explaining
            it; a press timer is not an affordance, and the events were a tab
            competing with the resource list for the same strip. Both are
            entries in one menu now, which is what the ⋮ is for. */}
        <IconButton onClick={() => setMenu(true)} aria-label="More">
          <EllipsisVertical size={17} strokeWidth={2} aria-hidden="true" />
        </IconButton>
      </div>

      {detail.isError ? (
        <div className="mx-3.5">
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
          {/* THE APPLICATION, AS A CARD. Where it lives, its name, then its
              three states as badges — health, sync, auto-sync — and, when its
              health is loud, ArgoCD's reason in a band along the bottom. The
              card's edge takes the colour of a degraded application, so the
              screen says it before a word is read. */}
          <section
            className="card mx-3.5 overflow-hidden"
            style={
              loudHealth
                ? {
                    borderColor: tint(hs.color, 'var(--tint-outline)'),
                    boxShadow: `0 0 0 3px ${tint(hs.color, 'var(--tint-row)')}`,
                  }
                : undefined
            }
          >
            <div className="px-3.5 pt-3 pb-3">
              <div className="flex flex-wrap gap-1.5">
                <Chip>{instance}</Chip>
                {spec?.project && <Chip>{spec.project}</Chip>}
              </div>
              <h1 className="t-title mt-2 mb-2.5 text-[28px] [overflow-wrap:anywhere]">{name}</h1>
              <div className="t-mono flex flex-wrap items-center gap-1.5 text-[11.5px]">
                <Badge state={health || 'Unknown'} className="!h-[22px] !px-2" />
                {/* THE SYNC VERDICT IS THE BUTTON, and the diff is behind it.
                    `OutOfSync` is the one word in this product that asks a
                    question — *what is different?* — so the word itself is
                    where the answer opens. Pressable in every state: the
                    operator who wants to be told nothing differs is the one
                    who has just pressed Synchronize. */}
                <button
                  onClick={() => setDiff(true)}
                  aria-label="See what differs from Git"
                  className="flex h-[26px] items-center gap-1 rounded-badge bg-panel px-2 ring-1 ring-[var(--edge-strong)] ring-inset active:bg-raised"
                >
                  <SyncWord sync={status?.sync?.status ?? ''} />
                  <ChevronRight size={12} strokeWidth={2} className="text-dim" aria-hidden="true" />
                </button>
                <span className="flex h-[26px] items-center rounded-badge px-2 ring-1 ring-rule ring-inset">
                  <AutoMark auto={auto} verbose />
                </span>
              </div>
            </div>
            {status?.health?.message && loudHealth && (
              <p
                className="t-mono flex gap-1.5 border-t px-3.5 py-2 text-[11.5px] leading-[1.4]"
                style={{
                  color: hs.color,
                  background: tint(hs.color, 'var(--tint-soft)'),
                  borderColor: tint(hs.color, 'var(--tint-outline)'),
                }}
              >
                <CornerDownRight size={13} strokeWidth={2.2} className="mt-px flex-none" aria-hidden="true" />
                {status.health.message}
              </p>
            )}
          </section>

          {/* The key/value card. Fields with no value are not drawn at all —
              a card of em-dashes is not a specification. */}
          <Facts
            className="mx-3.5 mt-2"
            items={[
              { label: 'namespace', value: spec?.destination.namespace },
              { label: 'target rev', value: spec?.source?.targetRevision },
              { label: 'revision', value: shortRev(status?.sync?.revision) },
              {
                label: 'last sync',
                node: op ? (
                  <>
                    {op.phase && (
                      <span
                        className={
                          op.phase === 'Failed' || op.phase === 'Error'
                            ? 'text-degraded'
                            : op.phase === 'Succeeded'
                              ? 'text-healthy'
                              : 'text-progressing'
                        }
                      >
                        {op.phase.toLowerCase()}{' '}
                      </span>
                    )}
                    {when?.long ?? ''}
                  </>
                ) : undefined,
              },
              { label: 'repository', value: spec?.source?.repoURL, wide: true },
              { label: 'cluster', value: spec?.destination.server, wide: true },
              { label: 'message', value: op?.message, wide: true, prose: true },
            ]}
          />

          {/* TWO ACTIONS THAT ARE NOT EQUALS, on one row. Refresh is the safe
              one, pressed twenty times a day, and ArgoCD counts it as a read.
              Sync is the family's dark primary — but it does not act when
              pressed: its ellipsis says it opens the sheet, and the sheet is
              where the weight of the decision was deliberately put. */}
          <div className="mx-3.5 mt-2 grid grid-cols-2 gap-2">
            <Button onClick={() => void act(false)} disabled={!online}>
              <RefreshCw size={15} strokeWidth={2} className={busy ? 'spin' : ''} aria-hidden="true" />
              Refresh
            </Button>
            <Button tone="strong" onClick={() => setSync(true)} disabled={!online}>
              <GitCompareArrows size={15} strokeWidth={2} aria-hidden="true" />
              Sync…
            </Button>
          </div>
        </>
      )}

      <div className="mx-3.5 mt-5 mb-2 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="t-name text-[19px] leading-none">Resources</h2>
          <p className="t-mono mt-1 text-[10.5px] text-muted">
            {nodes.length}
            {degraded > 0 && (
              <>
                {' · '}
                <span className="text-degraded">{degraded} degraded</span>
              </>
            )}
          </p>
        </div>
        {/* Named, because a funnel alone did not say "only what needs
            looking at": the word is what the filter keeps. */}
        <button
          onClick={() => setOnlyLoud(!onlyLoud)}
          aria-pressed={onlyLoud}
          aria-label="Show only resources that need looking at"
          className={`t-mono flex h-9 flex-none items-center gap-1.5 rounded-control px-2.5 text-[11.5px] ring-1 ring-inset ${
            onlyLoud ? 'bg-solid text-on-solid ring-transparent' : 'bg-panel text-muted ring-[var(--edge-strong)]'
          }`}
        >
          <ListFilter size={14} strokeWidth={2} aria-hidden="true" />
          issues
        </button>
        <Seg
          label="Resource view"
          value={view}
          onChange={setView}
          options={[
            { value: 'grouped', label: 'Grouped' },
            {
              value: 'tree',
              label: (
                <>
                  <ListTree size={12} strokeWidth={2} aria-hidden="true" />
                  Tree
                </>
              ),
            },
          ]}
        />
      </div>

      {/* A tablist with nothing it points to is a dead end for a screen
          reader: nothing says which region the two tabs above switch, and
          nothing marks it as a panel at all. One panel, not two, because
          exactly one of the views below is ever mounted at a time. */}
      <div id="tabpanel" role="tabpanel" aria-label={view === 'grouped' ? 'Grouped' : 'Tree'} tabIndex={-1}>
        {tree.isError ? (
          <div className="mx-3.5">
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
          <Groups nodes={shown} syncOf={syncOf} onSelect={pick} />
        ) : (
          <Tree nodes={shown} onSelect={pick} />
        )}
      </div>

      <Sheet
        open={menu}
        onClose={() => {
          setMenu(false)
          setStopping(false)
        }}
        title={name}
      >
        <div className="-mx-4">
          {op?.phase === 'Running' && (
            <button
              onClick={() => (stopping ? void stop() : setStopping(true))}
              disabled={!online || busy}
              className="flex h-14 w-full items-center gap-2.5 border-b border-rule px-4 text-left text-[14px] text-degraded disabled:opacity-40"
            >
              <OctagonX size={15} strokeWidth={1.4} aria-hidden="true" />
              {stopping ? 'Tap again to stop the sync' : 'Stop sync'}
              <span className="t-mono ml-auto text-[11px] text-dim">
                {stopping ? 'what is applied stays' : 'a sync is running'}
              </span>
            </button>
          )}
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
              setManifests(true)
            }}
            className="flex h-14 w-full items-center border-b border-rule px-4 text-left text-[14px]"
          >
            Manifests
            <span className="t-mono ml-auto text-[11px] text-dim">what Git asks for</span>
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

      {/* Mounted only while it is open, like the resource sheet: closing it
          throws the form away, which is what makes reopening it a fresh
          decision rather than a stale one. */}
      {sync && detail.data && (
        <SyncSheet
          instance={instance}
          name={name}
          detail={detail.data}
          onClose={() => setSync(false)}
        />
      )}

      {/* Both read-only, both mounted only while open — a diff is a reading of
          the moment it was asked for, and reopening it should ask again
          rather than show what was true five minutes ago. */}
      {diff && (
        <DiffSheet
          instance={instance}
          name={name}
          revision={status?.sync?.revision}
          onClose={() => setDiff(false)}
        />
      )}

      {manifests && (
        <ManifestsSheet instance={instance} name={name} onClose={() => setManifests(false)} />
      )}

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
