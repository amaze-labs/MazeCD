import { useState } from 'react'
import { Sheet } from './Sheet'
import { SheetTarget } from './ui'

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

  // The sheet stays mounted when closed, so a name typed and then thought
  // better of would still be there -- with the button already armed -- the
  // next time it opened. Reset on the open->false edge only (the same
  // pattern as SyncSheet), adjusted during render rather than in an effect
  // so it lands in the same commit and never fires while the sheet is open.
  // `busy` is deliberately untouched: an in-flight delete must keep the
  // button disabled until it settles.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) {
      setTyped('')
      setError('')
    }
  }

  async function go() {
    setBusy(true)
    setError('')
    try {
      await onConfirm()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <SheetTarget instance={instance} color={instanceColor} name={app} />
      {body && <p className="mt-3 text-[14px] leading-relaxed text-muted">{body}</p>}
      {requireTyping && (
        <>
          <label htmlFor="confirm-name" className="mt-4 block text-[13px] text-muted">
            Type the application name to unlock this
          </label>
          <input
            id="confirm-name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={app}
            className="t-mono mt-1.5 h-12 w-full rounded-control bg-inset px-3 text-[15px] outline-none placeholder:text-muted-tint focus:bg-raised"
          />
        </>
      )}
      {error && <p className="mt-3 text-[14px] leading-snug text-degraded">That did not go through: {error}</p>}
      <button
        onClick={go}
        disabled={!ready || busy}
        className={`mt-4 h-14 w-full rounded-control text-[17px] font-semibold text-ink disabled:opacity-40 ${
          destructive ? 'bg-degraded' : 'bg-text'
        }`}
      >
        {busy ? 'Working…' : confirmLabel}
      </button>
    </Sheet>
  )
}
