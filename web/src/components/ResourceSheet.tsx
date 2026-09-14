import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Sheet } from './Sheet'
import { api, argoPath } from '../api/client'
import { streamLogs } from '../lib/logs'
import { KindIcon, StatusBadge } from './ui'
import type { ResourceNode } from '../api/types'

const TABS = ['Logs', 'Manifest'] as const

export function ResourceSheet({
  node,
  instance,
  app,
  onClose,
}: {
  node: ResourceNode
  instance: string
  app: string
  onClose: () => void
}) {
  const isPod = node.kind === 'Pod'
  const [tab, setTab] = useState<(typeof TABS)[number]>(isPod ? 'Logs' : 'Manifest')

  return (
    <Sheet open onClose={onClose} title={node.name} icon={<KindIcon kind={node.kind} />}>
      {/* The sheet's own title is the resource name; repeating it in a card
          underneath is the duplication this rebuild exists to remove. One
          line carries what the title does not: where it lives and how it is. */}
      <div className="flex flex-wrap items-center gap-2">
        {node.health?.status && <StatusBadge state={node.health.status} />}
        <span className="t-mono min-w-0 truncate text-[11.5px] text-muted">
          {instance}
          <i className="sep" aria-hidden="true" />
          {node.kind} in {node.namespace || 'cluster-scope'}
        </span>
      </div>
      {node.health?.message && (
        <p className="mt-2 px-3 py-2 text-[12.5px] leading-snug text-degraded ring-1 ring-degraded/45">
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
              tab === t ? 'text-text ring-1 ring-rule' : 'text-muted'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {tab === 'Logs' && isPod && <Logs instance={instance} app={app} node={node} />}
        {tab === 'Manifest' && <Manifest instance={instance} app={app} node={node} />}
      </div>

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
          className="t-mono h-11 min-w-0 flex-1 rounded-control bg-inset px-3 text-[13px] outline-none placeholder:font-sans placeholder:text-muted focus:bg-raised"
        />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter lines"
          aria-label="Filter lines"
          className="h-11 min-w-0 flex-1 rounded-control bg-inset px-3 text-[13px] outline-none placeholder:text-muted focus:bg-raised"
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
  if (q.isLoading)
    return (
      <div className="flex flex-col gap-1.5 rounded-control bg-ink p-3" aria-hidden="true">
        {['72%', '54%', '88%', '40%', '66%', '78%', '48%'].map((w, i) => (
          <span key={i} className="skel h-2.5" style={{ width: w }} />
        ))}
      </div>
    )
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
