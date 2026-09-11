import { useState } from 'react'
import { Sheet } from './Sheet'

/**
 * Every destructive confirmation names the instance and the application in
 * full: acting on the wrong instance is the main hazard of a multi-instance
 * client. `requireTyping` forces the app name to be typed out.
 */
export function ConfirmSheet({
  open,
  title,
  instance,
  instanceColor,
  app,
  body,
  confirmLabel,
  requireTyping = false,
  destructive = true,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  instance: string
  instanceColor: string
  app: string
  body?: string
  confirmLabel: string
  requireTyping?: boolean
  destructive?: boolean
  onConfirm: () => Promise<unknown>
  onClose: () => void
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ready = !requireTyping || typed === app

  async function go() {
    setBusy(true)
    setError('')
    try {
      await onConfirm()
      setTyped('')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 p-3">
        <span className="h-10 w-1.5 rounded-full" style={{ background: instanceColor }} />
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted">{instance}</p>
          <p className="truncate font-medium">{app}</p>
        </div>
      </div>
      {body && <p className="mt-3 text-sm text-muted">{body}</p>}
      {requireTyping && (
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={`Type ${app} to confirm`}
          className="mt-3 h-12 w-full rounded-lg border border-border bg-surface px-3 outline-none focus:border-accent"
        />
      )}
      {error && <p className="mt-3 text-sm text-[#e96d76]">{error}</p>}
      <button
        onClick={go}
        disabled={!ready || busy}
        className={`mt-4 h-14 w-full rounded-xl text-lg font-medium disabled:opacity-40 ${
          destructive ? 'bg-[#e96d76] text-bg' : 'bg-accent text-bg'
        }`}
      >
        {busy ? 'Working…' : confirmLabel}
      </button>
    </Sheet>
  )
}
