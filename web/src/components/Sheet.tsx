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
      {/* The safe-area padding is on the content, not on the scroll box:
          a sticky footer sticks to the scroll box's padding edge, so padding
          here left a band under the footer that the list scrolled through. */}
      <div className="relative max-h-[85dvh] w-full overflow-y-auto rounded-t-sheet bg-panel shadow-[var(--shadow-float)]">
        <div className="sticky top-0 z-10 bg-panel px-4 pt-2">
          <span className="mx-auto block h-[5px] w-10 rounded-full bg-[var(--edge-strong)]" aria-hidden="true" />
          <div className="mt-2 flex items-center justify-between gap-3 border-b border-rule pb-2.5">
            <h2 className="t-title flex min-w-0 flex-1 items-center gap-2.5 truncate text-[21px]">
              {icon && (
                <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-solid text-brand">
                  {icon}
                </span>
              )}
              <span className="truncate">{title}</span>
            </h2>
            <button
              onClick={onClose}
              className="t-mono flex h-9 items-center rounded-control bg-panel px-3 text-[12.5px] text-muted ring-1 ring-[var(--edge-strong)] ring-inset active:bg-raised"
            >
              Close
            </button>
          </div>
        </div>
        <div className="pb-safe px-4 pt-3">{children}</div>
      </div>
    </div>
  )
}
