import { useState } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { Sheet } from './Sheet'
import { ConfirmSheet } from './ConfirmSheet'
import { api, argoPath } from '../api/client'
import { rollbackApp } from '../api/actions'
import type { RevisionHistory } from '../api/types'

export function HistorySheet({
  open,
  onClose,
  instance,
  instanceColor,
  name,
  history,
  currentRevision,
}: {
  open: boolean
  onClose: () => void
  instance: string
  instanceColor: string
  name: string
  history: RevisionHistory[]
  currentRevision?: string
}) {
  const qc = useQueryClient()
  const [target, setTarget] = useState<RevisionHistory | null>(null)

  // Newest first, and only the last ten: older entries are rarely a rollback
  // target and each one costs a metadata request.
  const items = [...history].sort((a, b) => b.id - a.id).slice(0, 10)

  const metadata = useQueries({
    queries: items.map((h) => ({
      queryKey: ['revmeta', instance, name, h.revision],
      queryFn: () =>
        api.get<{ author?: string; date?: string; message?: string }>(
          argoPath(instance, `applications/${name}/revisions/${h.revision}/metadata`),
        ),
      enabled: open,
      refetchInterval: false,
      retry: false,
    })),
  })

  return (
    <Sheet open={open} onClose={onClose} title="History">
      <ul className="divide-y divide-border">
        {items.map((h, i) => {
          const meta = metadata[i]?.data
          const current = h.revision === currentRevision
          return (
            <li key={h.id} className="flex items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm">
                  {h.revision.slice(0, 7)}
                  {current && <span className="ml-2 text-xs text-[#18be94]">current</span>}
                </p>
                {meta?.message && <p className="mt-0.5 truncate text-sm">{meta.message.split('\n')[0]}</p>}
                <p className="mt-0.5 text-xs text-muted">
                  {new Date(h.deployedAt).toLocaleString()}
                  {meta?.author ? ` · ${meta.author}` : ''}
                </p>
              </div>
              {!current && (
                <button
                  onClick={() => setTarget(h)}
                  className="flex h-11 shrink-0 items-center rounded-lg border border-border px-3 text-sm"
                >
                  Roll back
                </button>
              )}
            </li>
          )
        })}
        {items.length === 0 && <li className="py-8 text-center text-sm text-muted">No deployment history.</li>}
      </ul>

      {target && (
        <ConfirmSheet
          open
          title="Roll back"
          instance={instance}
          instanceColor={instanceColor}
          app={name}
          body={`Deploy revision ${target.revision.slice(0, 7)} again. This starts a sync with automated sync temporarily disabled by ArgoCD.`}
          confirmLabel="Roll back"
          onConfirm={async () => {
            await rollbackApp(instance, name, target.id)
            await qc.invalidateQueries({ queryKey: ['app', instance, name] })
            setTarget(null)
            onClose()
          }}
          onClose={() => setTarget(null)}
        />
      )}
    </Sheet>
  )
}
