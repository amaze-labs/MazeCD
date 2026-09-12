import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAppDetail, useResourceTree, useInstances } from '../api/queries'
import { Tabs } from '../components/Tabs'
import { Tree } from '../components/Tree'
import { StatusDot } from '../components/StatusDot'
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
  const [selection, setSelection] = useState<ResourceNode[]>([])
  const [actionError, setActionError] = useState('')
  const running = op?.phase === 'Running'

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
      <header className="pt-safe sticky top-0 z-10 border-b border-border bg-bg/95 px-4 pb-3 backdrop-blur">
        <Link to="/" className="text-sm text-accent">
          ← Applications
        </Link>
        <div className="mt-2 flex items-center gap-2">
          <h1 className="min-w-0 flex-1 truncate text-xl font-semibold">{name}</h1>
          <StatusDot health={status?.health?.status ?? ''} sync={status?.sync?.status ?? ''} />
        </div>
        <p className="mt-1 text-xs text-muted">
          {instance} · {detail.data?.spec.project} · {detail.data?.spec.destination.namespace} ·{' '}
          {status?.sync?.revision?.slice(0, 7)}
        </p>
        {op && (
          <p className="mt-2 text-xs">
            <span className="text-accent">{op.phase}</span>
            {op.message ? ` — ${op.message}` : ''}
          </p>
        )}
        {status?.health?.message && (
          <p className="mt-2 text-xs text-[#f4c030]">{status.health.message}</p>
        )}
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setSyncOpen(true)}
            disabled={running || !instances.data || !online}
            className="h-11 flex-1 rounded-lg bg-accent font-medium text-bg disabled:opacity-40"
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
            className="h-11 flex-1 select-none rounded-lg border border-border"
            title="Long press or right click for a hard refresh"
          >
            Refresh
          </button>
          {running && (
            <button
              onClick={() => act(() => terminateOperation(instance, name))}
              className="h-11 flex-1 rounded-lg border border-[#e96d76] text-[#e96d76]"
            >
              Terminate
            </button>
          )}
          <button onClick={() => setHistoryOpen(true)} className="h-11 flex-1 rounded-lg border border-border">
            History
          </button>
          <button
            onClick={() => setDeleteOpen(true)}
            className="h-11 w-11 rounded-lg border border-[#e96d76] text-[#e96d76]"
            aria-label="Delete application"
          >
            ✕
          </button>
        </div>
        {actionError && <p className="mt-2 text-xs text-[#e96d76]">{actionError}</p>}
      </header>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'Tree' && (
        <>
          {selection.length > 0 && (
            <div className="flex items-center justify-between border-b border-border px-4 py-2 text-sm">
              <span>{selection.length} selected for sync</span>
              <button className="text-accent" onClick={() => setSelection([])}>
                Clear
              </button>
            </div>
          )}
          <Tree
            nodes={tree.data?.nodes ?? []}
            onSelect={setSelected}
            selection={selection}
            onToggleSelect={(n) =>
              setSelection((cur) =>
                cur.some((c) => c.kind === n.kind && c.name === n.name && c.namespace === n.namespace)
                  ? cur.filter((c) => !(c.kind === n.kind && c.name === n.name && c.namespace === n.namespace))
                  : [...cur, n],
              )
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
          instanceColor={meta?.color ?? '#8b93a7'}
          app={name}
          production={production}
          onClose={() => setSelected(null)}
        />
      )}

      <SyncSheet
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        instance={instance}
        instanceColor={meta?.color ?? '#8b93a7'}
        name={name}
        production={production}
        selection={selection}
      />

      <HistorySheet
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        instance={instance}
        instanceColor={meta?.color ?? '#8b93a7'}
        name={name}
        history={status?.history ?? []}
        currentRevision={status?.sync?.revision}
      />

      <ConfirmSheet
        open={deleteOpen}
        title="Delete application"
        instance={instance}
        instanceColor={meta?.color ?? '#8b93a7'}
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
