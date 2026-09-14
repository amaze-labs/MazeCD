import { CircleCheck, TriangleAlert, X } from 'lucide-react'
import { dismissToast, useToasts } from '../lib/toast'
import { tint } from './ui'

/**
 * The receipts, at the thumb end of the screen.
 *
 * Above the tab bar, not below the title: this is a phone held in one hand,
 * and the hand is already down there — a toast at the top is read late and
 * dismissed by a stretch. It uses the same grammar as everything else, an
 * icon and a word in a status colour over a wash of it, so a confirmation is
 * not a new visual language for the sake of one message.
 *
 * `aria-live="polite"` and not `assertive`: this announces after the operator
 * has finished whatever they were reading, which is the right order for a
 * receipt. A failure is still on screen when they get there.
 */
export function Toasts() {
  const items = useToasts()
  if (items.length === 0) return null
  return (
    <div
      className="pb-safe pointer-events-none fixed inset-x-3 bottom-24 z-[55] flex flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {items.map((t) => {
        const color = t.kind === 'ok' ? 'var(--color-healthy)' : 'var(--color-degraded)'
        const Icon = t.kind === 'ok' ? CircleCheck : TriangleAlert
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-control bg-panel px-3 py-2.5 ${
              t.leaving ? 'toast-out' : 'toast-in'
            }`}
            style={{
              boxShadow: `inset 0 0 0 1px ${tint(color, 'var(--tint-edge)')}, var(--shadow-float)`,
            }}
          >
            <span className="mt-px shrink-0" style={{ color }} aria-hidden="true">
              <Icon size={17} strokeWidth={2.2} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] leading-snug font-semibold">{t.title}</p>
              {t.detail && (
                <p className="mt-0.5 text-[13px] leading-snug text-muted">{t.detail}</p>
              )}
            </div>
            <button
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss"
              className="-my-1 -mr-1 flex size-9 shrink-0 items-center justify-center rounded-control text-muted transition-colors hover:text-text"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
