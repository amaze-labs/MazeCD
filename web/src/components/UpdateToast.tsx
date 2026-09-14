import { useEffect, useRef, useState } from 'react'
import { watchForUpdates } from '../lib/update'

/**
 * A new build is applied automatically, unless something is open that would
 * lose state — a sheet or a form. In that case the toast waits for a tap.
 */
export function UpdateToast() {
  const [apply, setApply] = useState<(() => void) | null>(null)
  const applyRef = useRef<(() => void) | null>(null)
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    const stop = watchForUpdates((fn) => {
      applyRef.current = fn
      setApply(() => fn)
      // Offers can arrive back to back (the version poll and the service
      // worker both see the same deploy), so replace the pending timer
      // rather than arming a second one.
      window.clearTimeout(timerRef.current)
      // Give React a tick to paint the toast before the reload, then
      // re-check right before applying: a sheet may have opened during
      // the delay, and its state must not be thrown away.
      timerRef.current = window.setTimeout(() => {
        const busy = document.querySelector('[role="dialog"]') !== null
        if (!busy) applyRef.current?.()
      }, 400)
    })
    return () => {
      window.clearTimeout(timerRef.current)
      stop()
    }
  }, [])

  if (!apply) return null
  return (
    <div className="pb-safe fixed inset-x-3 bottom-24 z-[60] flex items-center gap-3 rounded-control bg-raised px-4 py-3 shadow-[var(--shadow-float)]">
      <span className="flex-1 text-[14px] leading-snug">A newer build of MazeCD is ready.</span>
      <button
        onClick={apply}
        className="flex h-11 shrink-0 items-center justify-center rounded-control bg-accent px-4 text-[14px] font-semibold text-ink"
      >
        Reload
      </button>
    </div>
  )
}
