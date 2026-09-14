import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, RefreshCw } from 'lucide-react'
import { useAppDetail, useResourceTree, useInstances } from '../api/queries'
import { Tabs } from '../components/Tabs'
import { Tree } from '../components/Tree'
import { InstancePill, Revision, StatusBadge } from '../components/ui'
import { ResourceSheet } from '../components/ResourceSheet'
import { refreshApp } from '../api/actions'
import { useOnline } from '../lib/online'
import { EventsTab } from './tabs/EventsTab'
import type { ResourceNode } from '../api/types'

const TABS = ['Tree', 'Events'] as const

export function AppDetailScreen() {
  const { instance = '', name = '' } = useParams()
  const detail = useAppDetail(instance, name)
  const tree = useResourceTree(instance, name)
  const online = useOnline()
  const [tab, setTab] = useState<(typeof TABS)[number]>('Tree')
  const [selected, setSelected] = useState<ResourceNode | null>(null)

  const status = detail.data?.status
  const op = status?.operationState

  const qc = useQueryClient()
  const instances = useInstances()
  const meta = (instances.data ?? []).find((i) => i.name === instance)
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const color = meta?.color ?? '#7E8C9A'
  // Same rule as the card: a namespace that only repeats the application
  // name is the duplication this rebuild exists to remove.
  const ns = detail.data?.spec.destination.namespace || detail.data?.spec.project
  const where = ns === name ? '' : ns

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
    void act(() => refreshApp(instance, name, true))
  }

  async function act(fn: () => Promise<unknown>) {
    setActionError('')
    setBusy(true)
    try {
      await fn()
      await invalidate()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
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
            <span className={op.phase === 'Failed' ? 'text-degraded' : 'text-progressing'}>
              {op.phase}
            </span>
            {op.message ? ` — ${op.message}` : ''}
          </p>
        )}

        {status?.health?.message && (
          <p className="mt-2 line-clamp-3 rounded-card bg-surface-degraded px-3 py-2 text-[13px] leading-snug text-text-degraded">
            {status.health.message}
          </p>
        )}

        {/* MazeCD's one button. Everything it can ask ArgoCD to do, it asks
            here, and ArgoCD counts it as a read. */}
        <button
          onClick={() => {
            // The press already ran the hard refresh; the click that
            // follows the release must not run a second, normal one.
            if (hardPress.current) {
              hardPress.current = false
              return
            }
            void act(() => refreshApp(instance, name, false))
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
          className="mt-2.5 flex h-11 w-full items-center justify-center gap-2 rounded-control bg-raised text-[15px] font-medium ring-1 ring-rule select-none active:bg-inset disabled:opacity-40"
          title="Long press or right click to refresh with the manifests re-rendered"
        >
          <RefreshCw size={17} className={busy ? 'spin' : ''} aria-hidden="true" />
          Refresh
        </button>

        {actionError && (
          <p className="mt-2 text-[13px] leading-snug text-degraded">
            That did not go through: {actionError}
          </p>
        )}
      </header>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <div id="tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'Tree' && (
          <>
            <p className="px-4 pt-2.5 text-[13px] text-muted">
              {tree.data?.nodes?.length ?? 0} resources
            </p>
            <Tree nodes={tree.data?.nodes ?? []} onSelect={setSelected} />
          </>
        )}
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
