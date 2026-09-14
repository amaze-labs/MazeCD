import { useSyncExternalStore } from 'react'

/**
 * Did that work?
 *
 * MazeCD has one action left, and until now it answered nothing: the icon
 * spun for as long as the request took — often under 200ms — and then the
 * screen looked exactly as it had before. An operator could not tell a
 * refresh that went through from a tap that missed the button.
 *
 * A module-level store rather than a context: a toast is raised from an async
 * callback deep inside a screen and read by one component mounted beside the
 * router, and threading a provider between those two would be plumbing for a
 * list that is almost always empty.
 *
 * Failures do not auto-dismiss. A success is a receipt and four seconds is
 * plenty; a failure is something the operator has to read, possibly after
 * putting the phone down, and a message that removes itself is a message that
 * was not delivered.
 */
export type ToastKind = 'ok' | 'fail'
export type Toast = { id: number; kind: ToastKind; title: string; detail?: string; leaving?: boolean }

const OK_MS = 4000
const LEAVE_MS = 220

let items: Toast[] = []
let seq = 0
const listeners = new Set<() => void>()

function publish(next: Toast[]) {
  items = next
  for (const l of listeners) l()
}

export function dismissToast(id: number) {
  const t = items.find((x) => x.id === id)
  if (!t || t.leaving) return
  publish(items.map((x) => (x.id === id ? { ...x, leaving: true } : x)))
  // Removed after the slide-out has played, so the element is still mounted
  // while it animates. Under prefers-reduced-motion the stylesheet skips the
  // animation and this is just a short delay nobody sees.
  window.setTimeout(() => publish(items.filter((x) => x.id !== id)), LEAVE_MS)
}

export function toast(kind: ToastKind, title: string, detail?: string) {
  const id = ++seq
  // At most three: the fourth would cover the tab bar, and a queue of stale
  // receipts is not information.
  publish([...items, { id, kind, title, detail }].slice(-3))
  if (kind === 'ok') window.setTimeout(() => dismissToast(id), OK_MS)
  return id
}

export const useToasts = (): Toast[] =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => items,
  )
