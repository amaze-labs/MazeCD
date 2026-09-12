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
      <button className="absolute inset-0 bg-black/70" onClick={onClose} aria-label="Close" />
      <div className="pb-safe relative max-h-[85dvh] w-full overflow-y-auto rounded-t-sheet bg-panel">
        <div className="sticky top-0 z-10 bg-panel px-4 pt-2">
          <span className="mx-auto block h-1 w-9 rounded-full bg-rule" aria-hidden="true" />
          <div className="mt-1 flex items-center justify-between gap-3 border-b border-rule pb-2">
            <h2 className="t-name min-w-0 flex-1 truncate text-[17px]">{title}</h2>
            <button
              onClick={onClose}
              className="-mr-2 flex h-11 min-w-11 items-center justify-center px-2 text-[14px] text-muted"
            >
              Close
            </button>
          </div>
        </div>
        <div className="px-4 pt-3 pb-4">{children}</div>
      </div>
    </div>
  )
}
