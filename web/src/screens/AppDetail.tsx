import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAppDetail, useResourceTree, useInstances } from '../api/queries'
import { Tabs } from '../components/Tabs'
import { Tree } from '../components/Tree'
import { BackIcon, InstancePill, Revision, StatePair, TrashIcon } from '../components/ui'
import { SyncSheet } from '../components/SyncSheet'
import { ResourceSheet } from '../components/ResourceSheet'
import { HistorySheet } from '../components/HistorySheet'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { refreshApp, terminateOperation, deleteApp } from '../api/actions'
import { isProductionGuard } from '../lib/instanceGuard'
import { useOnline } from '../lib/online'
import { DiffTab } from './tabs/DiffTab'
import { EventsTab } from './tabs/EventsTab'
import { ManifestTab } from './tabs/ManifestTab'
import type { ResourceNode } from '../api/types'

const TABS = ['Tree', 'Diff', 'Events', 'Manifest'] as const

const OUTLINE = 'h-11 flex-1 rounded-control border border-rule text-[15px] active:bg-raised'

export function AppDetailScreen() {
  const { instance = '', name = '' } = useParams()
  const navigate = useNavigate()
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
  // Unknown instance metadata (still loading, or resolved with no match) is
  // treated as production: the guardrail must fail closed, not open.
  const production = isProductionGuard(instances.data, instance)
  const [syncOpen, setSyncOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selection, setSelection] = useState<ResourceNode[]>([])
  const [actionError, setActionError] = useState('')
  const running = op?.phase === 'Running'
  const color = meta?.color ?? '#7E8C9A'

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
    try {
      await fn()
      await invalidate()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div>
      <header className="pt-safe sticky top-0 z-10 border-b border-rule bg-ink/95 px-4 pb-3 backdrop-blur">
        <Link
          to="/"
          className="-ml-2 flex h-11 w-fit items-center gap-1 pr-3 pl-2 text-[14px] text-muted"
        >
          <BackIcon />
          Applications
        </Link>

        <h1 className="t-name mt-0.5 text-[26px]">{name}</h1>

        {/* Identity on the left, state on the right, both two lines deep:
            this header stays pinned while the tree scrolls under it, so
            every row of it has to earn its height. */}
        <div className="mt-1.5 flex items-start justify-between gap-4">
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex items-center gap-2">
              <InstancePill name={instance} color={color} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
                {detail.data?.spec.destination.namespace || detail.data?.spec.project}
              </span>
            </span>
            <Revision sha={status?.sync?.revision} className="text-muted" />
          </span>
          <StatePair health={status?.health?.status ?? ''} sync={status?.sync?.status ?? ''} />
        </div>

        {/* Clamped so one enormous ArgoCD message cannot grow the pinned
            header past the content; the untruncated text is in Events. */}
        {op && (
          <p className="mt-2 line-clamp-3 text-[13px] leading-snug text-muted">
            <span className={op.phase === 'Failed' ? 'text-degraded' : 'text-progressing'}>
              {op.phase}
            </span>
            {op.message ? ` — ${op.message}` : ''}
          </p>
        )}

        {status?.health?.message && (
          <p className="mt-2 line-clamp-3 rounded-pill bg-surface-degraded px-3 py-2 text-[13px] leading-snug text-text-degraded">
            {status.health.message}
          </p>
        )}

        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setSyncOpen(true)}
            disabled={running || !instances.data || !online}
            className="h-12 flex-[2] rounded-control bg-text text-[15px] font-semibold text-ink disabled:opacity-40"
          >
            Sync
          </button>
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
            className="h-12 flex-1 rounded-control border border-rule text-[15px] select-none active:bg-raised"
            title="Long press or right click to refresh with the manifests re-rendered"
          >
            Refresh
          </button>
        </div>

        <div className="mt-2 flex gap-2">
          <button onClick={() => setHistoryOpen(true)} className={OUTLINE}>
            History
          </button>
          {running && (
            <button
              onClick={() => act(() => terminateOperation(instance, name))}
              className="h-11 flex-1 rounded-control border border-degraded text-[15px] text-degraded"
            >
              Terminate
            </button>
          )}
          <button
            onClick={() => setDeleteOpen(true)}
            className="flex size-11 shrink-0 items-center justify-center rounded-control border border-degraded text-degraded"
            aria-label="Delete application"
          >
            <TrashIcon />
          </button>
        </div>

        {actionError && (
          <p className="mt-2 text-[13px] leading-snug text-degraded">
            That did not go through: {actionError}
          </p>
        )}
      </header>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'Tree' && (
        <>
          {/* Selection is rare and destructive-adjacent, so it is a mode you
              enter on purpose. Until then the resource names own the width. */}
          <div className="flex items-center justify-between gap-3 border-b border-rule px-4">
            <span className="text-[13px] text-muted">
              {selecting
                ? selection.length === 0
                  ? 'Pick the resources to sync'
                  : `${selection.length} picked`
                : `${tree.data?.nodes?.length ?? 0} resources`}
            </span>
            <span className="-mr-2 flex items-center">
              <button
                onClick={() => {
                  setSelecting(!selecting)
                  setSelection([])
                }}
                className="flex h-11 items-center px-2 text-[14px]"
              >
                {selecting ? 'Cancel' : 'Select'}
              </button>
              {selecting && selection.length > 0 && (
                <button
                  onClick={() => setSyncOpen(true)}
                  className="ml-1 flex h-11 items-center rounded-pill bg-text px-3 text-[14px] font-semibold text-ink"
                >
                  Sync {selection.length}
                </button>
              )}
            </span>
          </div>
          <Tree
            nodes={tree.data?.nodes ?? []}
            onSelect={setSelected}
            selection={selection}
            onToggleSelect={
              selecting
                ? (n) =>
                    setSelection((cur) =>
                      cur.some(
                        (c) => c.kind === n.kind && c.name === n.name && c.namespace === n.namespace,
                      )
                        ? cur.filter(
                            (c) =>
                              !(c.kind === n.kind && c.name === n.name && c.namespace === n.namespace),
                          )
                        : [...cur, n],
                    )
                : undefined
            }
          />
        </>
      )}
      {tab === 'Diff' && <DiffTab instance={instance} name={name} />}
      {tab === 'Events' && <EventsTab instance={instance} name={name} />}
      {tab === 'Manifest' && <ManifestTab instance={instance} name={name} />}

      {selected && (
        <ResourceSheet
          node={selected}
          instance={instance}
          instanceColor={color}
          app={name}
          production={production}
          onClose={() => setSelected(null)}
        />
      )}

      <SyncSheet
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        instance={instance}
        instanceColor={color}
        name={name}
        production={production}
        selection={selection}
      />

      <HistorySheet
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        instance={instance}
        instanceColor={color}
        name={name}
        history={status?.history ?? []}
        currentRevision={status?.sync?.revision}
      />

      <ConfirmSheet
        open={deleteOpen}
        title="Delete application"
        instance={instance}
        instanceColor={color}
        app={name}
        body="Cascade delete: the application and every resource it manages are removed from the cluster."
        confirmLabel="Delete application"
        requireTyping
        onConfirm={async () => {
          await deleteApp(instance, name, true)
          await qc.invalidateQueries({ queryKey: ['apps'] })
          navigate('/')
        }}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  )
}
