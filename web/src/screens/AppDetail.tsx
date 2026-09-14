import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, RefreshCw, ServerOff } from 'lucide-react'
import { useAppDetail, useResourceTree, useInstances } from '../api/queries'
import { Tabs } from '../components/Tabs'
import { Tree } from '../components/Tree'
import { Button, Callout, InstancePill, Revision, StatusBadge } from '../components/ui'
import { AppDetailSkeleton, TreeSkeleton } from '../components/Skeleton'
import { Tooltip } from '../components/Tooltip'
import { ResourceSheet } from '../components/ResourceSheet'
import { refreshApp } from '../api/actions'
import { useOnline } from '../lib/online'
import { useLiveTree } from '../lib/live'
import { toast } from '../lib/toast'
import { ago } from '../lib/ago'
import { EventsTab } from './tabs/EventsTab'
import type { ResourceNode } from '../api/types'

const TABS = ['Tree', 'Events'] as const

export function AppDetailScreen() {
  const { instance = '', name = '' } = useParams()
  const detail = useAppDetail(instance, name)
  const tree = useResourceTree(instance, name)
  // The application's own state already streams, fleet-wide, from the Shell.
  // Its resources are the other half of "in real time", and ArgoCD watches
  // them on an endpoint of their own.
  useLiveTree(instance, name)
  const online = useOnline()
  const [tab, setTab] = useState<(typeof TABS)[number]>('Tree')
  const [selected, setSelected] = useState<ResourceNode | null>(null)

  const status = detail.data?.status
  const op = status?.operationState

  const qc = useQueryClient()
  const instances = useInstances()
  const meta = (instances.data ?? []).find((i) => i.name === instance)
  const [busy, setBusy] = useState(false)
  // A configured instance always has a colour; this is the fallback for the
  // moment before /api/instances lands, and it follows the theme rather than
  // hard-coding the dark theme's grey onto a white card.
  const color = meta?.color ?? 'var(--color-muted)'
  // Same rule as the card: the project, dropped when it only repeats the
  // instance chip standing next to it.
  const project = detail.data?.spec.project
  const where = project === instance ? '' : project
  // The row's leading number, in the one place on this screen where it
  // already has a sentence to sit in. The header does not repeat the row's
  // grid: the facts it adds -- both states spelled out, the operation's own
  // message -- are prose, and the resource count is the line above the tree.
  const when = ago(op?.finishedAt)

  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['app', instance, name] }),
      qc.invalidateQueries({ queryKey: ['tree', instance, name] }),
      qc.invalidateQueries({ queryKey: ['apps'] }),
    ])

  // Hard refresh used to hang off `contextmenu` alone: no tooltip exists on a
  // phone, and long-press-to-contextmenu is unreliable on iOS Safari for
  // buttons, so the feature had no entry point on the device MazeCD targets.
  // A real 600ms press timer gives it one; contextmenu stays for the desktop.
  const hardPress = useRef(false)
  const pressTimer = useRef<number | undefined>(undefined)
  const pressAt = useRef({ x: 0, y: 0 })
  const cancelPress = () => window.clearTimeout(pressTimer.current)
  useEffect(() => cancelPress, [])
  // Idempotent per press: a long press on iOS can fire the timer and a
  // contextmenu, and only one hard refresh should come of it.
  const hardRefresh = () => {
    cancelPress()
    if (hardPress.current) return
    hardPress.current = true
    void act(true)
  }

  /**
   * The one action, and the first time it has ever said anything.
   *
   * A refresh against a healthy instance comes back in under 200ms: the icon
   * turned once and the screen looked exactly as it had, so a tap that worked
   * and a tap that missed the button were the same event. The receipt says
   * which of the two it was, and names the hard variant when that is what ran
   * -- re-rendering the manifests is a different, slower thing than asking
   * ArgoCD to re-read, and an operator who long-pressed by accident should be
   * told so rather than left to wonder why it took four seconds.
   */
  async function act(hard: boolean) {
    setBusy(true)
    try {
      await refreshApp(instance, name, hard)
      await invalidate()
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
      <header className="pt-safe sticky top-0 z-10 border-b border-rule bg-ink px-4 pb-3">
        <Link
          to="/"
          className="-ml-2 flex h-10 w-fit items-center gap-0.5 pr-3 pl-1.5 text-[14px] text-muted"
        >
          <ChevronLeft size={18} aria-hidden="true" />
          Applications
        </Link>

        {/* A first load draws the header it is about to have -- the title,
            both badges, the instance line, the button -- rather than drawing
            "Unknown / Unknown" and correcting itself a moment later, which
            is a lie about an application's health and the one lie this
            interface must never tell. */}
        {detail.isError ? (
          <Callout
            icon={<ServerOff size={17} strokeWidth={2.2} />}
            title="Could not load this application"
            action={
              <Button className="!h-10 !text-[14px]" onClick={() => void detail.refetch()}>
                Try again
              </Button>
            }
          >
            <span className="t-mono block text-[12px]">{String(detail.error)}</span>
          </Callout>
        ) : detail.isLoading && !detail.data ? (
          <AppDetailSkeleton />
        ) : (
          <>
        <h1 className="t-name text-[20px]">{name}</h1>

        {/* Both states, always, as badges. The list shows one because it
            shows the bucket; here there is room for the whole truth. */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <StatusBadge state={status?.health?.status ?? 'Unknown'} />
          <StatusBadge state={status?.sync?.status ?? 'Unknown'} />
        </div>

        <div className="mt-1.5 flex items-center gap-2">
          <InstancePill name={instance} color={color} />
          <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{where}</span>
          <Revision sha={status?.sync?.revision} className="text-muted" />
        </div>

        {/* Clamped so one enormous ArgoCD message cannot grow the pinned
            header past the content; the untruncated text is in Events. */}
        {op && (
          <p className="mt-2 line-clamp-2 text-[13px] leading-snug text-muted">
            {/* ArgoCD leaves the phase empty on an operation it has finished
                and moved on from, and the age alone was a sentence with no
                subject: a line reading "1 day ago" says nothing about what
                happened a day ago. The field is named for what it is —
                the last operation, not the last successful deploy. */}
            {op.phase ? (
              <span className={op.phase === 'Failed' ? 'text-degraded' : 'text-progressing'}>
                {op.phase}
              </span>
            ) : (
              'Last operation'
            )}
            {when ? ` ${when.long}` : ''}
            {op.message ? ` — ${op.message}` : ''}
          </p>
        )}

        {status?.health?.message && (
          <p className="mt-2 line-clamp-3 rounded-card bg-surface-degraded px-3 py-2 text-[13px] leading-snug text-text-degraded">
            {status.health.message}
          </p>
        )}

        {/* MazeCD's one button. Everything it can ask ArgoCD to do, it asks
            here, and ArgoCD counts it as a read. The ⓘ beside it carries what
            used to be in the button's `title`: the long press. A `title` is
            invisible on a phone, so on the device this app is for the hard
            refresh had no way of ever being discovered. */}
        <div className="mt-2.5 flex items-center gap-2">
        <Button
          className="min-w-0 flex-1"
          onClick={() => {
            // The press already ran the hard refresh; the click that
            // follows the release must not run a second, normal one.
            if (hardPress.current) {
              hardPress.current = false
              return
            }
            void act(false)
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return // right click is the contextmenu path
            hardPress.current = false
            cancelPress()
            pressAt.current = { x: e.clientX, y: e.clientY }
            pressTimer.current = window.setTimeout(hardRefresh, 600)
          }}
          onPointerUp={cancelPress}
          onPointerMove={(e) => {
            // A finger never holds perfectly still; cancel on a real drag
            // (the start of a scroll), not on a pixel of jitter.
            const { x, y } = pressAt.current
            if (Math.hypot(e.clientX - x, e.clientY - y) > 12) cancelPress()
          }}
          onPointerCancel={cancelPress}
          onPointerLeave={cancelPress}
          onContextMenu={(e) => {
            e.preventDefault()
            hardRefresh()
          }}
          disabled={!online}
        >
          <RefreshCw size={17} className={busy ? 'spin' : ''} aria-hidden="true" />
          Refresh
        </Button>
        <Tooltip label="What Refresh does">
          <span className="block text-[13px] leading-snug">
            <span className="block font-semibold text-text">Refresh</span>
            <span className="mt-0.5 block text-muted">
              Asks {instance} to re-read this application from the cluster. It changes nothing —
              ArgoCD counts it as a read.
            </span>
            <span className="mt-2 block font-semibold text-text">Press and hold</span>
            <span className="mt-0.5 block text-muted">
              A hard refresh: the manifests are rendered again from source before the comparison,
              which is what you want when the repository changed but the sync status did not.
              Slower, and still a read.
            </span>
          </span>
        </Tooltip>
        </div>
          </>
        )}
      </header>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <div id="tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'Tree' &&
          (tree.isError ? (
            <div className="mx-4 mt-3">
              <Callout
                icon={<ServerOff size={17} strokeWidth={2.2} />}
                title="Could not load the resource tree"
                action={
                  <Button className="!h-10 !text-[14px]" onClick={() => void tree.refetch()}>
                    Try again
                  </Button>
                }
              >
                <span className="t-mono block text-[12px]">{String(tree.error)}</span>
              </Callout>
            </div>
          ) : tree.isLoading && !tree.data ? (
            <>
              <span className="skel mx-4 mt-2.5 block h-3.5 w-24" aria-hidden="true" />
              <TreeSkeleton />
            </>
          ) : (
            <>
              <p className="px-4 pt-2.5 text-[13px] text-muted">
                {tree.data?.nodes?.length ?? 0} resources
              </p>
              <Tree nodes={tree.data?.nodes ?? []} onSelect={setSelected} />
            </>
          ))}
        {tab === 'Events' && <EventsTab instance={instance} name={name} />}
      </div>

      {selected && (
        <ResourceSheet
          node={selected}
          instance={instance}
          instanceColor={color}
          app={name}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
