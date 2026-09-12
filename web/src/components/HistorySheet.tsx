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
      <ul className="flex flex-col gap-0.5">
        {items.map((h, i) => {
          const meta = metadata[i]?.data
          const current = h.revision === currentRevision
          return (
            <li
              key={h.id}
              className={`flex items-start gap-3 rounded-pill px-3 py-2.5 ${
                current ? 'bg-inset' : ''
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2">
                  <span className="t-mono text-[13px]">{h.revision.slice(0, 7)}</span>
                  {current && (
                    <span className="rounded-pill bg-healthy/15 px-1.5 py-px text-[12px] leading-4 font-medium text-healthy">
                      deployed now
                    </span>
                  )}
                </p>
                {meta?.message && (
                  <p className="mt-1 truncate text-[15px]">{meta.message.split('\n')[0]}</p>
                )}
                <p className="mt-0.5 text-[13px] text-muted">
                  {new Date(h.deployedAt).toLocaleString()}
                  {meta?.author ? `, ${meta.author}` : ''}
                </p>
              </div>
              {!current && (
                <button
                  onClick={() => setTarget(h)}
                  className="flex h-11 shrink-0 items-center rounded-control border border-rule px-3 text-[14px] active:bg-raised"
                >
                  Roll back
                </button>
              )}
            </li>
          )
        })}
        {items.length === 0 && (
          <li className="px-4 py-10 text-center text-[15px] leading-relaxed text-muted">
            ArgoCD has recorded no deployments for this application yet. Sync it once and the
            revision will appear here.
          </li>
        )}
      </ul>

      {target && (
        <ConfirmSheet
          open
          title="Roll back"
          instance={instance}
          instanceColor={instanceColor}
          app={name}
          body={`Deploy revision ${target.revision.slice(0, 7)} again. This starts a sync, and ArgoCD turns automated sync off until you turn it back on.`}
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
