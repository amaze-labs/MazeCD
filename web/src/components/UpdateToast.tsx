import { useEffect, useRef, useState } from 'react'
import { watchForUpdates } from '../lib/update'

/**
 * A new build is applied automatically, unless something is open that would
 * lose state — a sheet or a form. In that case the toast waits for a tap.
 */
export function UpdateToast() {
  const [apply, setApply] = useState<(() => void) | null>(null)
  const applyRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const stop = watchForUpdates((fn) => {
      applyRef.current = fn
      setApply(() => fn)
      const busy = document.querySelector('[role="dialog"]') !== null
      if (!busy) {
        // Give React a tick to paint the toast before the reload.
        window.setTimeout(() => applyRef.current?.(), 400)
      }
    })
    return stop
  }, [])

  if (!apply) return null
  return (
    <div className="pb-safe fixed inset-x-3 bottom-20 z-[60] flex items-center gap-3 rounded-xl border border-accent bg-surface px-4 py-3 shadow-lg">
      <span className="flex-1 text-sm">A new version of MazeCD is available.</span>
      <button
        onClick={apply}
        className="flex h-11 shrink-0 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-bg"
      >
        Reload
      </button>
    </div>
  )
}
