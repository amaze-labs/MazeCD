import { useEffect, useId, useRef, useState } from 'react'
import { Info } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * An explanation a thumb can reach.
 *
 * MazeCD kept the meaning of its numbers in `title` attributes. A `title` is
 * shown on hover, and the device this app is built for has no hover: on a
 * phone the attribute is not "hard to find", it is *unreachable*. The fact
 * that said what the largest number on every row measures could not be got at
 * by the only person who ever sees that row.
 *
 * So: a real element, opened by a tap on a real control with a real hit area,
 * dismissed by Escape or by tapping anywhere else. It opens on hover as well,
 * because a desktop is still a place this runs and a 500ms hover is what a
 * pointer user expects — but hover is the extra, not the mechanism.
 *
 * Anchored under its trigger and pulled to the right edge of it, because on a
 * 393px screen the trigger is on the right of a header and a centred popover
 * would hang off the screen. No portal: the header it lives in has no
 * `overflow: hidden`, so `position: absolute` is enough and the popover moves
 * with the header when the header moves.
 */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const hover = useRef<number | undefined>(undefined)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const away = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // pointerdown, not click: a tap that begins outside should close it even
    // if the finger ends up somewhere that eats the click.
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  useEffect(() => () => window.clearTimeout(hover.current), [])

  return (
    <span ref={box} className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        onPointerEnter={(e) => {
          if (e.pointerType !== 'mouse') return
          hover.current = window.setTimeout(() => setOpen(true), 500)
        }}
        onPointerLeave={() => {
          window.clearTimeout(hover.current)
          setOpen(false)
        }}
        className={`-my-2 -mr-2 flex size-9 items-center justify-center rounded-pill transition-colors ${
          open ? 'text-text' : 'text-muted hover:text-text'
        }`}
      >
        <Info size={16} strokeWidth={2.2} aria-hidden="true" />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="pop-in absolute top-full right-0 z-50 mt-1.5 block w-[17.5rem] rounded-card border border-rule bg-panel p-3 text-left shadow-[var(--shadow-float)]"
        >
          <span
            className="absolute -top-[5px] right-3 size-2 rotate-45 border-t border-l border-rule bg-panel"
            aria-hidden="true"
          />
          {children}
        </span>
      )}
    </span>
  )
}
