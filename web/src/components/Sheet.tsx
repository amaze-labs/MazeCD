import type { ReactNode } from 'react'

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-black/60" onClick={onClose} aria-label="Close" />
      <div className="pb-safe relative max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-surface">
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-surface px-4 py-3">
          <h2 className="font-medium">{title}</h2>
          <button onClick={onClose} className="flex h-11 min-w-11 items-center justify-center px-2 text-muted">
            Close
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}
