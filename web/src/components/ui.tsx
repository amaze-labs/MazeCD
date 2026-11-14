import type { ReactNode } from 'react'
import { Check, CircleCheck, GitCompareArrows, Heart, Zap, ZapOff } from 'lucide-react'
import { kindIcon, stateStyle } from '../lib/status'

/**
 * The vocabulary the whole interface is built from — the Maze family's, on a
 * phone: cards on a grey ground, mono labels over machine facts, states said
 * with badges, one dark segment for whatever is selected.
 *
 * ONE RULE STILL CARRIES IT: **the ordinary reading is quiet, and only the
 * exception is loud.** A healthy application gets a soft green badge and no
 * rail; a degraded one gets a filled red badge, a red rail, a tinted row and
 * its reason on a line of its own. Ninety-one loud verdicts would emphasise
 * nothing.
 */

/**
 * A colour at a fraction of itself, over whatever is behind it. `percent`
 * takes a CSS custom property as well as a number, because the same amount of
 * a status colour is a different amount of tint on white and on a dark card.
 */
export const tint = (color: string, percent: number | string) =>
  `color-mix(in oklab, ${color} ${typeof percent === 'number' ? `${percent}%` : percent}, transparent)`

/** The 3px edge of a row in its state's colour. The row must be `relative`. */
export function Rail({ health }: { health: string }) {
  return (
    <i
      className="rail"
      style={{ '--rail': stateStyle(health).color } as React.CSSProperties}
      aria-hidden="true"
    />
  )
}

/**
 * A state as a badge, the way the rest of the family says one: mono, upper
 * case, on a soft ground of its own colour. Degraded and Missing are filled —
 * the one state that has to be seen from arm's length.
 */
export function Badge({ state, label, className = '' }: { state: string; label?: string; className?: string }) {
  const s = stateStyle(state)
  const filled = state === 'Degraded' || state === 'Missing'
  return (
    <span
      className={`t-mono inline-flex h-[19px] flex-none items-center rounded-badge px-1.5 text-[9.5px] font-semibold tracking-[0.09em] whitespace-nowrap uppercase ${className}`}
      style={
        filled
          ? { background: s.color, color: 'var(--color-on-status)' }
          : { background: tint(s.color, 'var(--tint-soft)'), color: s.color }
      }
    >
      {label ?? s.label}
    </span>
  )
}

/** A neutral tag: an instance, a project, a kind. */
export function Chip({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`t-mono inline-flex h-[21px] flex-none items-center gap-1 rounded-badge bg-panel px-1.5 text-[10.5px] text-muted ring-1 ring-[var(--edge-strong)] ring-inset ${className}`}
    >
      {children}
    </span>
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
        <GitCompareArrows size={12} strokeWidth={2} aria-hidden="true" />
      ) : unknown ? null : (
        <Check size={12} strokeWidth={2.6} aria-hidden="true" />
      )}
      {out ? 'Out of sync' : unknown ? 'Unknown' : 'Synced'}
    </span>
  )
}

/**
 * Auto-sync: a bolt when ArgoCD will reconcile this itself; struck through,
 * with the word `manual`, when nothing moves until someone presses sync.
 */
export function AutoMark({ auto, verbose }: { auto: boolean; verbose?: boolean }) {
  return (
    <span
      className={`flex items-center gap-1 ${auto ? 'text-mark' : 'text-text'}`}
      title={
        auto
          ? 'auto-sync: ArgoCD reconciles this application itself'
          : 'manual: nothing moves until someone presses sync'
      }
    >
      {auto ? (
        <Zap size={11} strokeWidth={1.8} aria-hidden="true" />
      ) : (
        <ZapOff size={11} strokeWidth={1.8} aria-hidden="true" />
      )}
      <span className="sr-only">{auto ? 'auto-sync' : ''}</span>
      {verbose ? (auto ? 'auto-sync' : 'manual') : !auto && 'manual'}
    </span>
  )
}

/**
 * The other half of the language, for a resource: two marks in a fixed right
 * column, a heart for health and a circled check for sync, each in ArgoCD's
 * own colour for the state, and a violet `?` where ArgoCD did not report that
 * state at all — which for sync is most of a resource tree, since only the
 * application's own managed resources carry one.
 *
 * `?` is not "unknown health". It is "nobody said", and that is a different
 * claim from a status ArgoCD named Unknown.
 */
export function Mark({ state, icon: Icon }: { state: string | undefined; icon: typeof Heart }) {
  if (!state) {
    return (
      <span
        className="t-mono w-[12px] text-center text-[12px] leading-none"
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
      <Icon size={13} strokeWidth={2} aria-hidden="true" />
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

/** One fact for `Facts`: a label and a value, or nothing at all. */
export type FactItem = {
  label: string
  value?: string
  node?: ReactNode
  /** Takes the whole row: a URL, a message. */
  wide?: boolean
  /** Language rather than a machine fact: set in the sans and allowed to wrap. */
  prose?: boolean
}

/**
 * The key/value card, as the rest of the family draws one: a grid of cells,
 * each a mono label over its value, parted by hairlines. Facts with no value
 * are not drawn at all — a card of em-dashes is not a specification — and
 * when that leaves a half-width cell alone on its row, it takes the row.
 */
export function Facts({ items, className = '' }: { items: FactItem[]; className?: string }) {
  const shown = items.filter((f) => f.value || f.node)
  const spans: boolean[] = []
  let col = 0
  shown.forEach((f, i) => {
    if (f.wide) {
      spans.push(true)
      col = 0
      return
    }
    const next = shown[i + 1]
    const alone = col === 0 && (!next || next.wide === true)
    spans.push(alone)
    col = alone ? 0 : (col + 1) % 2
  })
  if (shown.length === 0) return null
  return (
    <dl className={`card m-0 grid grid-cols-2 gap-px overflow-hidden !bg-rule ${className}`}>
      {shown.map((f, i) => (
        <div key={f.label} className={`min-w-0 bg-panel px-3.5 pt-2.5 pb-3 ${spans[i] ? 'col-span-2' : ''}`}>
          <dt className="t-label">{f.label}</dt>
          <dd
            className={`m-0 mt-1 ${
              f.prose ? 'text-[13px] leading-[1.4]' : 't-mono truncate text-[12px]'
            }`}
            title={f.value}
          >
            {f.node ?? f.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** A Kubernetes kind as its glyph. */
export function KindIcon({ kind, size = 17 }: { kind: string; size?: number }) {
  // oxlint-disable-next-line react/static-components
  const Icon = kindIcon(kind)
  return <Icon size={size} strokeWidth={2} aria-hidden="true" />
}

/** A state, said out loud in a header: the badge, with its icon. */
export function StatusBadge({ state, label }: { state: string; label?: string }) {
  const s = stateStyle(state)
  // oxlint-disable-next-line react/static-components
  const Icon = s.icon
  const filled = state === 'Degraded' || state === 'Missing'
  return (
    <span
      className="t-mono inline-flex h-7 shrink-0 items-center gap-1.5 rounded-badge px-2 text-[10.5px] font-semibold tracking-[0.08em] uppercase"
      style={
        filled
          ? { background: s.color, color: 'var(--color-on-status)' }
          : { background: tint(s.color, 'var(--tint-soft)'), color: s.color }
      }
    >
      <Icon size={13} strokeWidth={2.2} className={s.spin ? 'spin' : ''} aria-hidden="true" />
      {label ?? s.label}
    </span>
  )
}

/** The instance, with a dot of the colour its configuration gives it. */
export function InstancePill({ name, color }: { name: string; color: string }) {
  return (
    <Chip className="!h-7 !px-2.5 !text-[11.5px]">
      <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
      {name}
    </Chip>
  )
}

/**
 * A segmented control: the options in one box, the chosen one on the dark
 * solid. The instance tabs, the resource views, the theme.
 */
export function Seg<T extends string>({
  options,
  value,
  onChange,
  label,
  className = '',
}: {
  options: { value: T; label: ReactNode; count?: number }[]
  value: T
  onChange: (v: T) => void
  label: string
  className?: string
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      // Each segment is as wide as its words and the spare room is shared
      // out, so `home-utility 59` gets the width it needs instead of a
      // quarter of the bar; when the names add up to more than the bar,
      // it scrolls sideways rather than letting a word out of its box.
      className={`flex gap-px overflow-x-auto overflow-y-hidden rounded-control bg-panel p-[3px] ring-1 ring-[var(--edge-strong)] ring-inset [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={`t-mono flex h-[30px] flex-auto items-center justify-center gap-1 rounded-segment px-2.5 text-[11.5px] whitespace-nowrap ${
              on ? 'bg-solid text-on-solid' : 'text-muted active:bg-raised'
            }`}
          >
            {o.label}
            {o.count !== undefined && (
              <span className={`text-[10px] ${on ? 'opacity-60' : 'text-dim'}`}>{o.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * THE CONTROL. One radius, a white face with a hairline; `strong` is the
 * family's dark primary — Sync, Sign in — and the one button per screen that
 * commits to something.
 *
 * `disabled:hover:` is not redundant with the opacity. Without it a disabled
 * control still changes under the cursor, which reads as "this works, click
 * harder" — and the buttons here are disabled exactly when the phone is
 * offline, which is when a false invitation costs the most.
 */
export function Button({
  tone = 'quiet',
  className = '',
  ...props
}: { tone?: 'quiet' | 'strong' | 'faint' | 'brand' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const shape =
    'inline-flex h-11 select-none items-center justify-center gap-2 rounded-control px-4 text-[14px] font-semibold disabled:opacity-40'
  const skin =
    tone === 'strong'
      ? 'bg-solid text-on-solid active:opacity-85 disabled:active:opacity-40'
      : tone === 'brand'
        ? 'bg-brand text-[#14171a] active:opacity-85'
        : tone === 'faint'
          ? 'text-muted ring-1 ring-rule ring-inset active:bg-raised'
          : 'bg-panel text-text ring-1 ring-[var(--edge-strong)] ring-inset active:bg-raised disabled:active:bg-panel'
  return <button {...props} className={`${shape} ${skin} ${className}`} />
}

/** A square icon button with a hairline, for a header. */
export function IconButton({
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`grid size-9 flex-none place-items-center rounded-control bg-panel text-text ring-1 ring-[var(--edge-strong)] ring-inset active:bg-raised disabled:opacity-40 ${className}`}
    />
  )
}

const TONE = {
  neutral: 'var(--color-unknown)',
  degraded: 'var(--color-degraded)',
  outofsync: 'var(--color-outofsync)',
} as const
export type Tone = keyof typeof TONE

/**
 * Something went wrong, said in place — a card edged and tinted in the
 * tone's hue, with an icon, a sentence, and a way out.
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
      className="card px-3.5 py-3"
      style={{
        borderColor: tint(c, 'var(--tint-outline)'),
        background: `linear-gradient(${tint(c, 'var(--tint-row)')}, ${tint(c, 'var(--tint-row)')}), var(--color-panel)`,
      }}
      role="status"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-px shrink-0" style={{ color: c }} aria-hidden="true">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] leading-snug font-semibold">{title}</p>
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
    <div className="card mx-3.5 my-6 px-3 py-6 text-center">
      <span
        className="mx-auto mb-3 flex size-12 items-center justify-center rounded-control bg-band text-dim"
        aria-hidden="true"
      >
        {icon}
      </span>
      <h2 className="t-name text-[17px]">{title}</h2>
      {children && (
        <p className="mx-auto mt-2 max-w-[34ch] text-[13px] leading-relaxed text-muted">{children}</p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}
