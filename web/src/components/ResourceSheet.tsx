import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Sheet } from './Sheet'
import { ConfirmSheet } from './ConfirmSheet'
import { api, argoPath } from '../api/client'
import { deleteResource, runResourceAction } from '../api/actions'
import { streamLogs } from '../lib/logs'
import { SheetTarget } from './ui'
import type { ResourceNode } from '../api/types'

const TABS = ['Logs', 'Manifest', 'Actions'] as const

export function ResourceSheet({
  node,
  instance,
  instanceColor,
  app,
  production,
  onClose,
}: {
  node: ResourceNode
  instance: string
  instanceColor: string
  app: string
  production: boolean
  onClose: () => void
}) {
  const isPod = node.kind === 'Pod'
  const [tab, setTab] = useState<(typeof TABS)[number]>(isPod ? 'Logs' : 'Manifest')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmAction, setConfirmAction] = useState('')
  const qc = useQueryClient()

  return (
    <Sheet open onClose={onClose} title={`${node.kind} ${node.name}`}>
      <SheetTarget
        instance={instance}
        color={instanceColor}
        production={production}
        name={node.name}
        detail={
          node.health?.status ? `${node.namespace} — ${node.health.status}` : node.namespace
        }
      />
      {node.health?.message && (
        <p className="mt-2 rounded-pill bg-surface-degraded px-3 py-2 text-[13px] leading-snug text-text-degraded">
          {node.health.message}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        {TABS.filter((t) => t !== 'Logs' || isPod).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`flex h-11 items-center rounded-pill px-3.5 text-[14px] ${
              tab === t ? 'bg-raised text-text' : 'text-muted'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {tab === 'Logs' && isPod && <Logs instance={instance} app={app} node={node} />}
        {tab === 'Manifest' && <Manifest instance={instance} app={app} node={node} />}
        {tab === 'Actions' && (
          <Actions
            instance={instance}
            app={app}
            node={node}
            onRun={setConfirmAction}
            onDelete={() => setConfirmDelete(true)}
          />
        )}
      </div>

      {/* The action list comes from ArgoCD and includes whatever argocd-cm
          defines: `restart` on a Deployment is already a production event, and
          a custom Rollout action can be far more. None of them gets to run on a
          single tap without naming the instance and the application first. */}
      <ConfirmSheet
        open={confirmAction !== ''}
        title={`Run ${confirmAction}`}
        instance={instance}
        instanceColor={instanceColor}
        app={app}
        body={`${confirmAction} on ${node.kind} ${node.name}.${
          production ? ' This is a production instance.' : ''
        }`}
        confirmLabel={`Run ${confirmAction}`}
        destructive={false}
        onConfirm={async () => {
          await runResourceAction(instance, app, node, confirmAction)
          await qc.invalidateQueries({ queryKey: ['tree', instance, app] })
        }}
        onClose={() => setConfirmAction('')}
      />

      <ConfirmSheet
        open={confirmDelete}
        title={`Delete ${node.kind}`}
        instance={instance}
        instanceColor={instanceColor}
        app={node.name}
        body="The resource is deleted in the cluster. ArgoCD recreates it on the next sync if it is still declared in git."
        confirmLabel={`Delete ${node.kind}`}
        requireTyping
        onConfirm={async () => {
          await deleteResource(instance, app, node, false)
          await qc.invalidateQueries({ queryKey: ['tree', instance, app] })
          onClose()
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </Sheet>
  )
}

function Logs({ instance, app, node }: { instance: string; app: string; node: ResourceNode }) {
  const [lines, setLines] = useState<string[]>([])
  const [error, setError] = useState('')
  const [container, setContainer] = useState('')
  const [filter, setFilter] = useState('')
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    setLines([])
    setError('')
    streamLogs({
      instance,
      app,
      node,
      container: container || undefined,
      // Keep memory bounded: a chatty pod can emit thousands of lines a minute.
      onLine: (l) => setLines((cur) => (cur.length > 2000 ? [...cur.slice(-1500), l] : [...cur, l])),
      signal: ctrl.signal,
    }).catch((e) => {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e))
    })
    return () => ctrl.abort()
  }, [instance, app, node, container])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [lines])

  const shown = filter ? lines.filter((l) => l.toLowerCase().includes(filter.toLowerCase())) : lines

  return (
    <div>
      <div className="flex gap-2">
        <input
          value={container}
          onChange={(e) => setContainer(e.target.value)}
          placeholder="Container"
          aria-label="Container"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="t-mono h-11 min-w-0 flex-1 rounded-control bg-inset px-3 text-[13px] outline-none placeholder:font-sans placeholder:text-muted-tint focus:bg-raised"
        />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter lines"
          aria-label="Filter lines"
          className="h-11 min-w-0 flex-1 rounded-control bg-inset px-3 text-[13px] outline-none placeholder:text-muted-tint focus:bg-raised"
        />
      </div>
      {error && (
        <p className="mt-2 text-[14px] leading-snug text-degraded">Log stream stopped: {error}</p>
      )}
      <pre className="t-mono mt-2 max-h-[50dvh] overflow-auto rounded-control bg-ink p-3 text-[11px] leading-relaxed">
        {shown.join('\n') || (error ? '' : filter ? 'No line matches that filter.' : 'Waiting for output…')}
        <div ref={bottom} />
      </pre>
    </div>
  )
}

function Manifest({ instance, app, node }: { instance: string; app: string; node: ResourceNode }) {
  const q = useQuery({
    queryKey: ['resource', instance, app, node.kind, node.namespace, node.name],
    queryFn: () =>
      api.get<{ manifest?: string }>(
        argoPath(
          instance,
          `applications/${app}/resource?` +
            new URLSearchParams({
              namespace: node.namespace,
              resourceName: node.name,
              version: node.version,
              kind: node.kind,
              group: node.group ?? '',
            }),
        ),
      ),
    refetchInterval: false,
  })
  if (q.isLoading) return <p className="text-[14px] text-muted">Loading the live manifest…</p>
  if (q.isError)
    return (
      <p className="text-[14px] leading-snug text-degraded">
        Could not read the manifest: {String(q.error)}
      </p>
    )
  return (
    <pre className="t-mono max-h-[50dvh] overflow-auto rounded-control bg-ink p-3 text-[11px] leading-relaxed text-muted">
      {q.data?.manifest ?? ''}
    </pre>
  )
}

function Actions({
  instance,
  app,
  node,
  onRun,
  onDelete,
}: {
  instance: string
  app: string
  node: ResourceNode
  onRun: (action: string) => void
  onDelete: () => void
}) {
  // Asking ArgoCD which actions exist beats hard-coding a kind list: custom
  // resource actions defined in argocd-cm show up for free.
  const q = useQuery({
    queryKey: ['actions', instance, app, node.kind, node.namespace, node.name],
    queryFn: () =>
      api.get<{ actions?: { name: string; disabled?: boolean }[] }>(
        argoPath(
          instance,
          `applications/${app}/resource/actions?` +
            new URLSearchParams({
              namespace: node.namespace,
              resourceName: node.name,
              version: node.version,
              kind: node.kind,
              group: node.group ?? '',
            }),
        ),
      ),
    refetchInterval: false,
  })

  return (
    <div className="flex flex-col gap-2">
      {(q.data?.actions ?? [])
        .filter((a) => !a.disabled)
        .map((a) => (
          <button
            key={a.name}
            onClick={() => onRun(a.name)}
            className="h-12 rounded-control border border-rule text-[15px] capitalize active:bg-raised"
          >
            {a.name}
          </button>
        ))}
      <button
        onClick={onDelete}
        className="h-12 rounded-control border border-degraded text-[15px] text-degraded"
      >
        Delete {node.kind}
      </button>
    </div>
  )
}
