import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Sheet } from './Sheet'
import { SheetTarget } from './ui'
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

  // Closing via the backdrop or × (not just a successful run) must not leave
  // the next open showing stale toggles or landing straight on the
  // production confirmation panel. Reset exactly on the open->false edge —
  // adjusted during render (see "you might not need an effect") rather than
  // in a useEffect, so it happens in the same commit and never re-fires
  // while the sheet stays open.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) {
      setConfirming(false)
      setOpts(defaultSyncOptions())
      setError('')
    }
  }

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
      <SheetTarget
        instance={instance}
        color={instanceColor}
        production={production}
        name={name}
        detail={
          selection.length > 0
            ? `${selection.length} picked resource${selection.length > 1 ? 's' : ''} only`
            : undefined
        }
      />

      <label htmlFor="sync-revision" className="mt-4 block text-[13px] text-muted">
        Revision
      </label>
      <input
        id="sync-revision"
        value={opts.revision}
        onChange={(e) => setOpts({ ...opts, revision: e.target.value })}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="HEAD"
        className="t-mono mt-1.5 h-12 w-full rounded-control bg-inset px-3 text-[15px] outline-none placeholder:text-muted-tint focus:bg-raised"
      />

      <div className="mt-4">
        {TOGGLES.map((t) => (
          <label key={t.key} className="flex min-h-11 items-center gap-3 py-2">
            <input
              type="checkbox"
              checked={Boolean(opts[t.key])}
              onChange={(e) => setOpts({ ...opts, [t.key]: e.target.checked })}
              className="size-5 shrink-0 accent-[#e8eef4]"
            />
            <span className="flex-1">
              <span className="block text-[15px]">{t.label}</span>
              <span className="block text-[13px] text-muted">{t.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {error && <p className="mt-3 text-[14px] leading-snug text-degraded">That did not go through: {error}</p>}

      {!confirming ? (
        <button
          onClick={() => (needsConfirm ? setConfirming(true) : run())}
          disabled={busy}
          className="mt-4 h-14 w-full rounded-control bg-text text-[17px] font-semibold text-ink disabled:opacity-40"
        >
          {opts.dryRun ? 'Dry run' : 'Sync'}
        </button>
      ) : (
        <div className="mt-4 rounded-control bg-surface-outofsync p-3">
          <p className="text-[14px] leading-relaxed">
            <strong className="font-semibold text-outofsync">{instance}</strong> is a production
            instance. Sync <strong className="font-semibold">{name}</strong> for real?
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setConfirming(false)}
              className="h-12 flex-1 rounded-control border border-rule text-[15px]"
            >
              Cancel
            </button>
            <button
              onClick={run}
              disabled={busy}
              className="h-12 flex-1 rounded-control bg-outofsync text-[15px] font-semibold text-ink disabled:opacity-40"
            >
              {busy ? 'Syncing…' : 'Sync'}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  )
}
