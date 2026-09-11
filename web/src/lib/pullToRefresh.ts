import { useEffect, useRef, useState } from 'react'

/**
 * Minimal pull-to-refresh: only arms at the very top of the page and only on
 * a downward drag past the threshold.
 *
 * Listeners are registered once (empty effect deps) and read/write refs
 * rather than closing over `pull`/`refreshing`/`onRefresh` state, so a fast
 * flick can't have its `touchend` land in a stale closure from a
 * listener re-subscription that hasn't caught up with the latest drag yet.
 * `pull`/`refreshing` state stays only for what the UI renders.
 *
 * ponytail: 40 lines of touch handling instead of a gesture library; revisit
 * only if horizontal gestures are ever added.
 */
export function usePullToRefresh(onRefresh: () => Promise<unknown>) {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const start = useRef<number | null>(null)
  const pullRef = useRef(0)
  const refreshingRef = useRef(false)
  const onRefreshRef = useRef(onRefresh)
  useEffect(() => {
    onRefreshRef.current = onRefresh
  }, [onRefresh])

  useEffect(() => {
    const threshold = 70

    const onStart = (e: TouchEvent) => {
      start.current = window.scrollY <= 0 ? e.touches[0].clientY : null
    }
    const onMove = (e: TouchEvent) => {
      if (start.current === null) return
      const delta = e.touches[0].clientY - start.current
      const next = delta > 0 ? Math.min(delta, threshold * 1.5) : 0
      pullRef.current = next
      setPull(next)
    }
    const onEnd = async () => {
      const armed = pullRef.current >= threshold
      start.current = null
      pullRef.current = 0
      setPull(0)
      if (!armed || refreshingRef.current) return
      refreshingRef.current = true
      setRefreshing(true)
      try {
        await onRefreshRef.current()
      } finally {
        refreshingRef.current = false
        setRefreshing(false)
      }
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd)
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
    }
  }, [])

  return { pull, refreshing }
}
