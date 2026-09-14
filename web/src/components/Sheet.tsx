import type { ReactNode } from 'react'

export function Sheet({
  open,
  onClose,
  title,
  icon,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  icon?: ReactNode
  children: ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-scrim" onClick={onClose} aria-label="Close" />
      <div className="pb-safe relative max-h-[85dvh] w-full overflow-y-auto rounded-t-sheet bg-panel">
        <div className="sticky top-0 z-10 bg-panel px-4 pt-2">
          <span className="mx-auto block h-1 w-9 rounded-full bg-rule" aria-hidden="true" />
          <div className="mt-1 flex items-center justify-between gap-3 border-b border-rule pb-2">
            <h2 className="t-name flex min-w-0 flex-1 items-center gap-2 truncate text-[16px]">
              {icon && <span className="shrink-0 text-muted">{icon}</span>}
              <span className="truncate">{title}</span>
            </h2>
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
