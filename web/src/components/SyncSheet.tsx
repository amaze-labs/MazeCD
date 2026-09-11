import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Sheet } from './Sheet'
import { defaultSyncOptions, type SyncOptions } from '../lib/sync'
import { syncApp } from '../api/actions'
import type { ResourceNode } from '../api/types'

const TOGGLES: { key: keyof SyncOptions; label: string; hint: string }[] = [
  { key: 'prune', label: 'Prune', hint: 'Delete resources no longer in git' },
  { key: 'dryRun', label: 'Dry run', hint: 'Report what would change, apply nothing' },
  { key: 'force', label: 'Force', hint: 'Replace conflicting resources' },
  { key: 'replace', label: 'Replace', hint: 'Use replace instead of apply' },
  { key: 'skipHooks', label: 'Skip hooks', hint: 'Apply manifests without running hooks' },
  { key: 'retry', label: 'Retry', hint: 'Retry twice with backoff on failure' },
]

export function SyncSheet({
  open,
  onClose,
  instance,
  instanceColor,
  name,
  production,
  selection,
}: {
  open: boolean
  onClose: () => void
  instance: string
  instanceColor: string
  name: string
  production: boolean
  selection: ResourceNode[]
}) {
  const [opts, setOpts] = useState<SyncOptions>(defaultSyncOptions())
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const qc = useQueryClient()

  const needsConfirm = production && !opts.dryRun

  async function run() {
    setBusy(true)
    setError('')
    try {
      await syncApp(instance, name, { ...opts, resources: selection })
      await qc.invalidateQueries({ queryKey: ['app', instance, name] })
      await qc.invalidateQueries({ queryKey: ['apps'] })
      onClose()
      setConfirming(false)
      setOpts(defaultSyncOptions())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Sync">
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 p-3">
        <span className="h-10 w-1.5 rounded-full" style={{ background: instanceColor }} />
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted">
            {instance}
            {production ? ' · production' : ''}
          </p>
          <p className="truncate font-medium">{name}</p>
        </div>
      </div>

      <label className="mt-4 block text-sm text-muted">Revision</label>
      <input
        value={opts.revision}
        onChange={(e) => setOpts({ ...opts, revision: e.target.value })}
        placeholder="HEAD"
        className="mt-1 h-12 w-full rounded-lg border border-border bg-surface px-3 outline-none focus:border-accent"
      />

      {selection.length > 0 && (
        <p className="mt-3 rounded-lg border border-accent/40 p-3 text-sm">
          Syncing {selection.length} selected resource{selection.length > 1 ? 's' : ''} only.
        </p>
      )}

      <div className="mt-4 divide-y divide-border">
        {TOGGLES.map((t) => (
          <label key={t.key} className="flex items-center gap-3 py-3">
            <input
              type="checkbox"
              checked={Boolean(opts[t.key])}
              onChange={(e) => setOpts({ ...opts, [t.key]: e.target.checked })}
              className="size-5 accent-[#6ea8fe]"
            />
            <span className="flex-1">
              <span className="block text-sm">{t.label}</span>
              <span className="block text-xs text-muted">{t.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-[#e96d76]">{error}</p>}

      {!confirming ? (
        <button
          onClick={() => (needsConfirm ? setConfirming(true) : run())}
          disabled={busy}
          className="mt-4 h-14 w-full rounded-xl bg-accent text-lg font-medium text-bg disabled:opacity-40"
        >
          {opts.dryRun ? 'Dry run' : 'Synchronize'}
        </button>
      ) : (
        <div className="mt-4 rounded-xl border border-[#f4c030] p-3">
          <p className="text-sm">
            This is a production instance. Synchronize <strong>{name}</strong> on{' '}
            <strong>{instance}</strong>?
          </p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => setConfirming(false)} className="h-12 flex-1 rounded-lg border border-border">
              Cancel
            </button>
            <button
              onClick={run}
              disabled={busy}
              className="h-12 flex-1 rounded-lg bg-[#f4c030] font-medium text-bg disabled:opacity-40"
            >
              {busy ? 'Syncing…' : 'Confirm'}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  )
}
