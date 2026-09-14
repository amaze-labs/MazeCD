import type { ReactNode } from 'react'
import { Box } from 'lucide-react'
import { kindIcon, stateStyle } from '../lib/status'

/**
 * The vocabulary the whole interface is built from.
 *
 * One idea carries it: state is an **outlined** badge — a coloured 1px edge,
 * a coloured icon, coloured text, and nothing behind it. Never a stripe, never
 * colour alone, and, since v6, never a filled block either.
 *
 * The fills went because the screen was a field of coloured rectangles: a
 * badge, an instance pill and a counter chip were each a small slab of tinted
 * paint, and thirty of them down a list is a poster, not an instrument. An
 * outline says exactly as much — it is the same icon, the same word and the
 * same colour — and it says it without claiming a rectangle of the page.
 *
 * It is also more legible, not less. A badge's own text used to sit inside a
 * wash made of itself, which was the worst of the three contrast cases in
 * this design and the one that forced every light-theme status colour darker
 * than it wanted to be. Outlined, the text sits on the card: the same six
 * colours read a full point higher.
 *
 * What still gets a fill, and why:
 *   - a card, a sheet, a toast and a tooltip — an object that has to occlude
 *     what is behind it is a surface, not a decoration;
 *   - the two card grounds for Degraded and Out of sync, which are the only
 *     tinted surfaces left, at a whisper of their old strength (see the
 *     tokens in index.css);
 *   - the one `strong` button a screen is *about*, which is the single place
 *     the accent is allowed to be a shape rather than a line;
 *   - a skeleton bar, whose entire job is to be seen.
 */

/**
 * A colour at a fraction of itself, over whatever is behind it.
 *
 * `percent` takes a CSS custom property as well as a number, because these
 * fractions are not constants: 65% of a light colour over a dark ground and
 * 65% of a dark colour over paper are not the same amount of edge. Those call
 * sites pass `'var(--tint-outline)'` and the stylesheet answers per theme.
 */
export const tint = (color: string, percent: number | string) =>
  `color-mix(in oklab, ${color} ${typeof percent === 'number' ? `${percent}%` : percent}, transparent)`

/**
 * A state, said out loud: a coloured edge, a coloured glyph, a coloured word,
 * and the card showing through. `size="sm"` is the same badge for places that
 * are already dense — the resource tree, a sheet header — and drops the word
 * to a smaller face rather than dropping it altogether.
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
        // The edge, and nothing else. An inset shadow rather than a border so
        // the badge's height is the same whether or not anything draws one.
        boxShadow: `inset 0 0 0 1px ${tint(s.color, 'var(--tint-outline)')}`,
        color: s.color,
      }}
    >
      <Icon size={px} strokeWidth={2.2} className={s.spin ? 'spin' : ''} aria-hidden="true" />
      {label ?? s.label}
    </span>
  )
}

/**
 * The instance: a neutral outlined pill with a dot of the instance's colour.
 *
 * This was the most-repeated fill in the product — one on every row, one on
 * every card in Settings, one in every sheet — and an operator's instance
 * colours are arbitrary, whatever the configuration file happens to say, so a
 * solid block of one was the least meaningful paint on the screen.
 *
 * Outlining it *in that colour* was worse. `orders-worker` read "Out of sync" in
 * amber beside a `orders` pill outlined in green, and a green outline next to an
 * amber one says "this bit is fine" to anyone glancing — except it is not a
 * state at all, it is which server the application lives on. Two different
 * kinds of fact wearing the same clothes.
 *
 * So the separation is structural rather than chromatic, because the colours
 * are the user's and cannot be chosen around: **a status chip is an outline in
 * its own colour; an instance is a neutral outline with a coloured dot.** The
 * instance keeps its identity, nothing outlined in a status-like hue ever
 * stands beside a status again, and the shape is the one the instance filters
 * at the top of the list already use — a reader who has seen one has seen
 * both.
 */
export function InstancePill({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-pill px-2 text-[12px] font-medium text-muted ring-1 ring-rule">
      <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
      {name}
    </span>
  )
}

/**
 * The anchor at the start of a row: a small outlined tile holding one glyph.
 *
 * Every list in this product was a wall of text starting at the same x with
 * nothing for the eye to catch on. The tile is that catch — and because it is
 * *the first thing on the row*, it is also the only place a state can be seen
 * without reading anything.
 *
 * It obeys the rule the rest of the list obeys: **a resting application says
 * nothing**. At rest the tile is a plain box glyph in the rule colour, which
 * means "an application" and no more. Only when the row has something to
 * report does it take the state's glyph and the state's colour — and then it
 * is the loudest mark on the row, at its leading edge.
 *
 * Outlined, not the reference's tinted square: ninety-nine tinted squares is
 * the field of rectangles this pass exists to remove, and a tinted square in
 * the *accent* — which is what the reference does — would spend the product's
 * one colour ninety-nine times per screen on a decoration.
 */
export function RowMark({ state, resting }: { state: string; resting: boolean }) {
  const s = stateStyle(state)
  const Icon = resting ? Box : s.icon
  // At rest the edge is the rule colour at full strength — the faintest token
  // there is — and a fraction of it would have disappeared on paper. A state
  // colour is a strong colour, so it is taken at the outline fraction like
  // every other chip.
  const color = resting ? 'var(--color-rule)' : s.color
  return (
    <span
      className="flex size-5 shrink-0 items-center justify-center rounded-tile"
      style={{
        boxShadow: `inset 0 0 0 1px ${resting ? color : tint(color, 'var(--tint-outline)')}`,
        color,
      }}
      aria-hidden="true"
    >
      <Icon size={12} strokeWidth={2.3} className={!resting && s.spin ? 'spin' : ''} />
    </span>
  )
}

/**
 * One labelled fact: a small letter-spaced grey capital over its value.
 *
 * This is the whole of where the "engineered" reading comes from — data that
 * is named and aligned, the way a spec sheet names it, rather than figures
 * standing in columns and an ⓘ in a header apologising for them.
 *
 * Stacked, not label-left-value-right as the reference has it. Two columns on
 * a 393px screen are about 160px each; a 60px label beside the value leaves
 * 100px for `git@github.com:…`, which truncates almost everything worth
 * reading. Stacking gives the value the full column and costs 13px a row.
 *
 * Renders nothing at all when there is no value. A spec sheet with six
 * em-dashes in it is not a spec sheet.
 */
export function Field({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  if (!value) return null
  return (
    <div className="min-w-0">
      <dt className="text-[10px] leading-[14px] font-semibold tracking-[0.12em] text-muted uppercase">
        {label}
      </dt>
      <dd className={`truncate text-[13px] leading-[17px] ${mono ? 't-mono' : ''}`} title={value}>
        {value}
      </dd>
    </div>
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
      ? 'bg-accent text-ink hover:opacity-90 active:opacity-80 disabled:hover:opacity-100'
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
 * Something went wrong, said in place — an outlined panel in the tone's hue,
 * with an icon, a sentence, and a way out.
 *
 * A bordered panel rather than a coloured stripe or a line of red text: the
 * stripe is invisible at the edge of a phone and the bare line is not
 * distinguishable from the content it interrupts. It used to carry a wash of
 * its hue as well; the border alone does the same job, and the panel now sits
 * on the page instead of painting over it.
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
      className="rounded-card bg-panel px-3 py-2.5"
      style={{ boxShadow: `inset 0 0 0 1px ${tint(c, 'var(--tint-outline)')}` }}
      role="status"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-px shrink-0" style={{ color: c }} aria-hidden="true">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] leading-snug font-semibold">{title}</p>
          {children && <div className="mt-1 text-[13px] leading-snug text-muted">{children}</div>}
        </div>
      </div>
      {action && <div className="mt-2.5 flex gap-2">{action}</div>}
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
        className="mx-auto mb-3 flex size-12 items-center justify-center rounded-pill text-muted ring-1 ring-rule"
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
