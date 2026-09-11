import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAppDetail, useResourceTree } from '../api/queries'
import { Tabs } from '../components/Tabs'
import { Tree } from '../components/Tree'
import { StatusDot } from '../components/StatusDot'
import { DiffTab } from './tabs/DiffTab'
import { EventsTab } from './tabs/EventsTab'
import { ManifestTab } from './tabs/ManifestTab'
import type { ResourceNode } from '../api/types'

const TABS = ['Tree', 'Diff', 'Events', 'Manifest'] as const

export function AppDetailScreen() {
  const { instance = '', name = '' } = useParams()
  const detail = useAppDetail(instance, name)
  const tree = useResourceTree(instance, name)
  const [tab, setTab] = useState<(typeof TABS)[number]>('Tree')
  const [selected, setSelected] = useState<ResourceNode | null>(null)

  const status = detail.data?.status
  const op = status?.operationState

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
        {/* The action bar is added in Task 14 (sync, refresh) and Task 16
            (history, delete). */}
      </header>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'Tree' && (
        <Tree nodes={tree.data?.nodes ?? []} onSelect={setSelected} />
      )}
      {tab === 'Diff' && <DiffTab instance={instance} name={name} />}
      {tab === 'Events' && <EventsTab instance={instance} name={name} />}
      {tab === 'Manifest' && <ManifestTab instance={instance} name={name} />}

      {/* The resource sheet for `selected` is added in Task 15. */}
      {selected && (
        <div className="p-4 text-xs text-muted">
          selected: {selected.kind}/{selected.name}
        </div>
      )}
    </div>
  )
}
