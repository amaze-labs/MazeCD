import { kindIcon, stateStyle } from '../lib/status'

/**
 * The vocabulary the whole interface is built from.
 *
 * One idea carries it: state is a filled badge — icon, word, ArgoCD's colour —
 * never a stripe and never colour alone. A three-pixel gutter clipped against
 * the edge of a phone was unreadable and looked like a rendering artefact; a
 * badge survives a glance, a screenshot, and colour blindness.
 */

export const tint = (color: string, percent: number) =>
  `color-mix(in oklab, ${color} ${percent}%, transparent)`

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
        // 12%, not more: a heavier fill lifts the badge's own background far
        // enough that #e96d76 on a degraded card drops under 4.5:1.
        background: tint(s.color, 12),
        boxShadow: `inset 0 0 0 1px ${tint(s.color, 32)}`,
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
