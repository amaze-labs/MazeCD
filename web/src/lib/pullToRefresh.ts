import { useEffect, useRef, useState } from 'react'

/**
 * Minimal pull-to-refresh: only arms at the very top of the page and only on
 * a downward drag past the threshold.
 * ponytail: 40 lines of touch handling instead of a gesture library; revisit
 * only if horizontal gestures are ever added.
 */
export function usePullToRefresh(onRefresh: () => Promise<unknown>) {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const start = useRef<number | null>(null)

  useEffect(() => {
    const threshold = 70

    const onStart = (e: TouchEvent) => {
      start.current = window.scrollY <= 0 ? e.touches[0].clientY : null
    }
    const onMove = (e: TouchEvent) => {
      if (start.current === null) return
      const delta = e.touches[0].clientY - start.current
      setPull(delta > 0 ? Math.min(delta, threshold * 1.5) : 0)
    }
    const onEnd = async () => {
      const armed = pull >= threshold
      start.current = null
      setPull(0)
      if (!armed || refreshing) return
      setRefreshing(true)
      try {
        await onRefresh()
      } finally {
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
  }, [pull, refreshing, onRefresh])

  return { pull, refreshing }
}
