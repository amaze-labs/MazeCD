import type { ReactNode } from 'react'
import { Check, CircleCheck, GitCompareArrows, Heart, Zap, ZapOff } from 'lucide-react'
import { kindIcon, stateStyle } from '../lib/status'

/**
 * The vocabulary the whole interface is built from.
 *
 * ONE RULE CARRIES IT: **the ordinary reading is grey, and only the exception
 * is allowed a colour or full ink.** Every row still says all three of its
 * states out loud — health, sync, auto-sync, including on the ninety-one that
 * are fine — but `Healthy` and `Synced` are set in muted and the auto bolt in
 * the mark grey, while `Degraded`, `OutOfSync` and the struck bolt of
 * `manual` are the only things that speak. Ninety-one identical green
 * verdicts would emphasise nothing and the two that matter would be lost in
 * them; silence about the calm case is worse still, because then a row that
 * says nothing is indistinguishable from a row that was not drawn.
 *
 * Health keeps its colour where it cannot be missed and cannot crowd: the
 * rail.
 *
 * NOTHING HAS A RADIUS EXCEPT A CONTROL. Not a row, not a rule, not the
 * key/value table, not a group. Roundness is therefore the whole affordance:
 * if a corner is soft, you can press it.
 */

/**
 * A colour at a fraction of itself, over whatever is behind it. `percent`
 * takes a CSS custom property as well as a number, because 65% of a light
 * colour over black and 65% of a dark colour over paper are not the same
 * amount of edge.
 */
export const tint = (color: string, percent: number | string) =>
  `color-mix(in oklab, ${color} ${typeof percent === 'number' ? `${percent}%` : percent}, transparent)`

/**
 * THE MEMORABLE THING: a 3px bar carrying two states at once.
 *
 * Its COLOUR is health. Its TEXTURE is auto-sync — solid when ArgoCD will
 * reconcile the application itself, broken into dashes when a person has to
 * press something. Scrolling ninety-nine applications you are reading a
 * barcode, and the stitched-through bars are the ones that will sit broken
 * until you personally go and do it. It costs no chrome: the second state
 * rides on a mark that had to be drawn anyway.
 *
 * It appears on every application row, and exactly once on a detail screen —
 * beside the application's name. A *resource* has health and sync but no
 * auto-sync of its own, so a rail there would be half a mark pretending to be
 * a whole one.
 */
export function Rail({ health, auto }: { health: string; auto: boolean }) {
  return (
    <i
      className="rail"
      data-auto={auto ? 'auto' : 'manual'}
      style={{ '--rail': stateStyle(health).color } as React.CSSProperties}
      aria-hidden="true"
    />
  )
}

/**
 * Sync, as a word in ArgoCD's colour for it: `Synced` green, `OutOfSync`
 * amber, `Unknown` dim. Always drawn — the calm case is a reading, not an
 * absence.
 */
export function SyncWord({ sync }: { sync: string }) {
  const out = sync === 'OutOfSync'
  const unknown = sync !== 'Synced' && !out
  return (
    <span
      className={`flex items-center gap-[5px] ${out ? 'text-outofsync' : unknown ? 'text-dim' : 'text-healthy'}`}
    >
      {out ? (
        <GitCompareArrows size={11} strokeWidth={1.3} aria-hidden="true" />
      ) : unknown ? null : (
        <Check size={11} strokeWidth={1.3} aria-hidden="true" />
      )}
      {out ? 'OutOfSync' : unknown ? 'Unknown' : 'Synced'}
    </span>
  )
}

/**
 * Auto-sync: the same glyph in the same slot on every row, and the exception
 * is simply heavier. A hairline bolt in the mark grey when ArgoCD will
 * reconcile this itself; struck through, in full ink, with the word `manual`
 * when it will not.
 *
 * On a list row the slot is a fixed 62px so the bolt sits at the same x
 * whether or not the word is beside it, which is what lets the eye run down
 * the column. On the detail there is one application and no column to keep,
 * so `verbose` spends the room on saying it in full.
 */
export function AutoMark({ auto, verbose }: { auto: boolean; verbose?: boolean }) {
  return (
    <span
      className={`flex items-center justify-end gap-1 ${verbose ? '' : 'w-[62px]'} ${auto ? 'text-mark' : 'text-text'}`}
      title={
        auto
          ? 'auto-sync: ArgoCD reconciles this application itself'
          : 'manual: nothing moves until someone presses sync'
      }
    >
      {auto ? (
        <Zap size={11} strokeWidth={1.2} aria-hidden="true" />
      ) : (
        <ZapOff size={11} strokeWidth={1.2} aria-hidden="true" />
      )}
      <span className="sr-only">{auto ? 'auto-sync' : ''}</span>
      {verbose ? (auto ? 'auto-sync' : 'manual') : !auto && 'manual'}
    </span>
  )
}

/**
 * The other half of the language, for a resource: two marks in a fixed right
 * column, a heart for health and a circled check for sync, each in ArgoCD's
 * own colour for the state — green Healthy is a reading too, not an absence —
 * and a violet `?` where ArgoCD did not report that state at all, which for
 * sync is most of a resource tree, since only the application's own managed
 * resources carry one.
 *
 * `?` is not "unknown health". It is "nobody said", and that is a different
 * claim from a status ArgoCD named Unknown.
 */
export function Mark({ state, icon: Icon }: { state: string | undefined; icon: typeof Heart }) {
  if (!state) {
    return (
      <span
        className="t-mono w-[11px] text-center text-[12px] leading-none"
        style={{ color: 'var(--color-suspended)' }}
        title="not reported"
      >
        ?
      </span>
    )
  }
  const s = stateStyle(state)
  return (
    <span style={{ color: s.color }} title={s.label}>
      <span className="sr-only">{s.label}</span>
      <Icon size={12} strokeWidth={1.25} aria-hidden="true" />
    </span>
  )
}

export function ResourceMarks({ health, sync }: { health?: string; sync?: string }) {
  return (
    <span className="flex w-[46px] flex-none items-center justify-end gap-3 text-mark">
      <Mark state={health} icon={Heart} />
      <Mark state={sync} icon={CircleCheck} />
    </span>
  )
}

/**
 * One fact in the key/value table: a mono label on the left, the value hard
 * against the right edge. Hairline-ruled, no container, no radius, no fill —
 * a tinted rounded panel is exactly what got an earlier attempt rejected.
 *
 * A message is language rather than a machine fact, so it is set in the sans
 * and allowed to wrap. Everything else is mono and truncates.
 *
 * Renders nothing when there is no value. A spec sheet with six em-dashes in
 * it is not a spec sheet.
 */
export function Fact({
  label,
  value,
  children,
  prose,
}: {
  label: string
  value?: string
  children?: ReactNode
  prose?: boolean
}) {
  if (!value && !children) return null
  return (
    <div className="t-mono flex gap-3.5 px-4 py-2.5 text-[11.5px] [&+&]:border-t [&+&]:border-rule">
      <dt className="flex-none basis-[104px] text-dim">{label}</dt>
      <dd
        className={`m-0 min-w-0 flex-1 text-right ${
          prose ? 'font-sans text-[12.5px] leading-[1.4]' : 'truncate'
        }`}
        title={value}
      >
        {children ?? value}
      </dd>
    </div>
  )
}

/** A Kubernetes kind as its glyph. Only the resource sheet uses one now — the
 * grouped list says the kind in words, on its band. */
export function KindIcon({ kind, size = 17 }: { kind: string; size?: number }) {
  // oxlint-disable-next-line react/static-components
  const Icon = kindIcon(kind)
  return <Icon size={size} strokeWidth={2} aria-hidden="true" />
}

/**
 * A state, said out loud, for the one place left that is not a row: the
 * resource sheet's header. Hairline outlined in its own colour, never filled.
 */
export function StatusBadge({ state, label }: { state: string; label?: string }) {
  const s = stateStyle(state)
  const Icon = s.icon
  return (
    <span
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-control px-2.5 text-[13px]"
      style={{
        boxShadow: `inset 0 0 0 1px ${tint(s.color, 'var(--tint-outline)')}`,
        color: s.color,
      }}
    >
      <Icon size={14} strokeWidth={2} className={s.spin ? 'spin' : ''} aria-hidden="true" />
      {label ?? s.label}
    </span>
  )
}

/** The instance, where a screen outside the two the mockup governs still has
 * to name one: a neutral hairline box with a dot of the instance's colour. */
export function InstancePill({ name, color }: { name: string; color: string }) {
  return (
    <span className="t-mono inline-flex h-7 shrink-0 items-center gap-1.5 rounded-control px-2.5 text-[11.5px] text-muted ring-1 ring-rule">
      <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
      {name}
    </span>
  )
}

/**
 * THE CONTROL. One height, 48px; one radius, 10px; a hairline outline and
 * never a fill. Refresh alone gets the brighter edge, being the one thing in
 * this product that does something.
 *
 * `strong` is the single exception, and it lives entirely off the two screens
 * the mockup governs: the sign-in button and the one that reloads a new
 * build, which are the only places MazeCD's own colour is still spent.
 *
 * `disabled:hover:` is not redundant with the opacity. Without it a disabled
 * control still changes under the cursor, which reads as "this works, click
 * harder" — and the one button in this app is disabled exactly when the phone
 * is offline, which is when a false invitation costs the most.
 */
export function Button({
  tone = 'quiet',
  className = '',
  ...props
}: { tone?: 'quiet' | 'strong' | 'faint' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const shape =
    't-mono inline-flex h-12 select-none items-center justify-center gap-2.5 rounded-control px-4 text-[12.5px] tracking-[0.01em] disabled:opacity-40'
  const skin =
    tone === 'strong'
      ? 'bg-accent text-ink hover:opacity-90 active:opacity-80 disabled:hover:opacity-100'
      : // `faint` is the way out of a sheet standing beside the thing the
        // sheet is for: the ordinary hairline and muted ink, so the two
        // weights the design already defines carry the whole hierarchy and
        // Cancel never has to be shouted down with a colour.
        tone === 'faint'
        ? 'text-muted ring-1 ring-rule active:bg-band'
        : 'text-text ring-1 ring-[var(--edge-strong)] active:bg-band disabled:active:bg-transparent'
  return <button {...props} className={`${shape} ${skin} ${className}`} />
}

const TONE = {
  neutral: 'var(--color-unknown)',
  degraded: 'var(--color-degraded)',
  outofsync: 'var(--color-outofsync)',
} as const
export type Tone = keyof typeof TONE

/**
 * Something went wrong, said in place — a hairline box in the tone's hue,
 * with an icon, a sentence, and a way out.
 *
 * The banner that matters most here is an instance that did not answer: the
 * list below is still correct for the other two, and what the operator needs
 * is the name of the one that is missing and a way to ask again, not an
 * apology. That is why `action` is not optional decoration.
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
      className="px-3.5 py-3"
      style={{ boxShadow: `inset 0 0 0 1px ${tint(c, 'var(--tint-outline)')}` }}
      role="status"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-px shrink-0" style={{ color: c }} aria-hidden="true">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] leading-snug font-medium">{title}</p>
          {children && <div className="mt-1 text-[12.5px] leading-snug text-muted">{children}</div>}
        </div>
      </div>
      {action && <div className="mt-3 flex gap-2">{action}</div>}
    </div>
  )
}

/**
 * Nothing to show, and what to do about it. A deliberate object rather than a
 * sentence floating in empty space, because the operator cannot tell "there
 * is nothing here" from "this did not load".
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
    <div className="mx-4 my-8 px-2 py-6 text-center ring-1 ring-rule">
      <span
        className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full text-dim ring-1 ring-rule"
        aria-hidden="true"
      >
        {icon}
      </span>
      <h2 className="t-name text-[16px]">{title}</h2>
      {children && (
        <p className="mx-auto mt-2 max-w-[34ch] text-[12.5px] leading-relaxed text-muted">
          {children}
        </p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}
