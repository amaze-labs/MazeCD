import type { ReactNode } from 'react'
import { kindIcon, stateStyle } from '../lib/status'

/**
 * The vocabulary the whole interface is built from.
 *
 * One idea carries it: state is a filled badge — icon, word, ArgoCD's colour —
 * never a stripe and never colour alone. A three-pixel gutter clipped against
 * the edge of a phone was unreadable and looked like a rendering artefact; a
 * badge survives a glance, a screenshot, and colour blindness.
 */

/**
 * A colour at a fraction of itself, over whatever is behind it.
 *
 * `percent` takes a CSS custom property as well as a number, because several
 * of these fractions are not constants: a 26% wash of a light colour on a
 * dark ground and a 26% wash of a dark colour on paper are not the same
 * amount of ink, and the second one swallows the text that sits in it. Those
 * call sites pass `'var(--tint-fill)'` and the stylesheet answers per theme.
 */
export const tint = (color: string, percent: number | string) =>
  `color-mix(in oklab, ${color} ${typeof percent === 'number' ? `${percent}%` : percent}, transparent)`

/**
 * A state, said out loud. `size="sm"` is the same badge for places that are
 * already dense — the resource tree, a sheet header — and drops the word to a
 * smaller face rather than dropping it altogether.
 */
export function StatusBadge({
  state,
  size = 'md',
  label,
}: {
  state: string
  size?: 'sm' | 'md'
  label?: string
}) {
  const s = stateStyle(state)
  const Icon = s.icon
  const px = size === 'sm' ? 14 : 15
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-pill font-medium ${
        size === 'sm' ? 'h-6 px-2 text-[12px]' : 'h-7 px-2.5 text-[13px]'
      }`}
      style={{
        // 12% on a dark ground, 10% on paper: a heavier fill lifts the
        // badge's own background far enough that the badge's own text drops
        // under 4.5:1 -- #e96d76 in the dark, every one of the six in the
        // light, where the ink is dark and the wash darkens fast.
        background: tint(s.color, 'var(--tint-fill)'),
        boxShadow: `inset 0 0 0 1px ${tint(s.color, 'var(--tint-edge)')}`,
        color: s.color,
      }}
    >
      <Icon size={px} strokeWidth={2.2} className={s.spin ? 'spin' : ''} aria-hidden="true" />
      {label ?? s.label}
    </span>
  )
}

/**
 * The instance, as a small pill tinted with the instance's own colour. The
 * colour lives here — six characters wide, in a place where nothing is at
 * stake — instead of on a thick bar down the edge of the row, where a red
 * theme made a healthy application look like a fire.
 */
export function InstancePill({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="inline-flex h-6 shrink-0 items-center rounded-pill px-2 text-[12px] font-medium"
      style={{
        background: tint(color, 18),
        color: `color-mix(in oklab, ${color} 45%, var(--color-text))`,
      }}
    >
      {name}
    </span>
  )
}

/** A Kubernetes kind as its glyph. */
export function KindIcon({ kind, size = 17 }: { kind: string; size?: number }) {
  // Not a component created during render: `kindIcon` is a lookup in a
  // module-level table of lucide components, so the reference is stable.
  // oxlint-disable-next-line react/static-components
  const Icon = kindIcon(kind)
  return <Icon size={size} strokeWidth={2} aria-hidden="true" />
}

/** Seven-character revisions, in the face reserved for machine identifiers. */
export function Revision({ sha, className = '' }: { sha?: string; className?: string }) {
  if (!sha) return null
  return <span className={`t-mono shrink-0 text-[12px] ${className}`}>{sha.slice(0, 7)}</span>
}

/**
 * The one button shape, with all four of its states.
 *
 * `quiet` is everything MazeCD asks for — Refresh, Retry, Show all, Sign out.
 * `strong` is the one button a screen is *about*: sign in, reload the build.
 *
 * `disabled:hover:` is not redundant with `disabled:opacity-40`. Without it a
 * disabled control still changes colour under the cursor, which reads as "this
 * works, click harder" — and the one button in this app is disabled exactly
 * when the phone is offline, which is when a false invitation costs the most.
 */
export function Button({
  tone = 'quiet',
  className = '',
  ...props
}: { tone?: 'quiet' | 'strong' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const shape =
    'inline-flex h-11 select-none items-center justify-center gap-2 rounded-control px-4 text-[15px] font-medium transition-colors disabled:opacity-40'
  const skin =
    tone === 'strong'
      ? 'bg-text text-ink hover:opacity-90 active:opacity-80 disabled:hover:opacity-100'
      : 'bg-raised text-text ring-1 ring-rule hover:bg-inset active:bg-inset disabled:hover:bg-raised'
  return <button {...props} className={`${shape} ${skin} ${className}`} />
}

const TONE = {
  neutral: 'var(--color-unknown)',
  degraded: 'var(--color-degraded)',
  outofsync: 'var(--color-outofsync)',
} as const
export type Tone = keyof typeof TONE

/**
 * Something went wrong, said in place — a tinted panel with a stronger border
 * of the same hue, an icon, a sentence, and a way out.
 *
 * A wash plus a border rather than a coloured stripe or a line of red text:
 * the stripe is invisible at the edge of a phone and the bare line is not
 * distinguishable from the content it interrupts. The border is carried at a
 * higher fraction than the fill so the panel has an edge in both themes.
 *
 * `action` is not optional decoration. The banner that matters most here is
 * an instance that did not answer — the list is still correct for the other
 * two, and what the operator needs is the name of the one that is missing and
 * a way to ask again, not an apology.
 */
export function Callout({
  tone = 'degraded',
  icon,
  title,
  children,
  action,
}: {
  tone?: Tone
  icon: ReactNode
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
}) {
  const c = TONE[tone]
  return (
    <div
      className="rounded-card px-3 py-2.5"
      style={{
        background: tint(c, 'var(--tint-fill)'),
        boxShadow: `inset 0 0 0 1px ${tint(c, 'var(--tint-edge)')}`,
      }}
      role="status"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-px shrink-0" style={{ color: c }} aria-hidden="true">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] leading-snug font-semibold">{title}</p>
          {children && (
            <div className="mt-1 text-[13px] leading-snug text-muted-tint">{children}</div>
          )}
        </div>
      </div>
      {/* The action sits on the wash, so it takes the card surface rather
          than the raised one: a `raised` slab on a tinted panel reads as a
          piece of another screen that fell in. */}
      {action && (
        <div className="mt-2.5 flex gap-2 [&_button]:bg-panel [&_button]:hover:bg-raised">
          {action}
        </div>
      )}
    </div>
  )
}

/**
 * Nothing to show, and what to do about it.
 *
 * Centred in a bordered panel rather than as a line of muted text in the
 * middle of the page, because a sentence floating in empty space reads as a
 * rendering failure — the operator cannot tell "there is nothing here" from
 * "this did not load". A panel is a deliberate object: it says the screen
 * finished, and it found nothing.
 */
export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mx-4 my-6 rounded-card border border-rule bg-panel px-6 py-10 text-center">
      <span
        className="mx-auto mb-3 flex size-12 items-center justify-center rounded-pill bg-raised text-muted"
        aria-hidden="true"
      >
        {icon}
      </span>
      <h2 className="t-name text-[17px]">{title}</h2>
      {children && (
        <p className="mx-auto mt-2 max-w-[34ch] text-[14px] leading-relaxed text-muted">
          {children}
        </p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}
