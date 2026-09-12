import type { ReactNode } from 'react'
import type { Health, SyncStatus } from '../api/types'
import { healthColor, syncColor } from '../lib/status'
import { healthLoud, syncLoud } from '../lib/fleet'

/**
 * The vocabulary the whole interface is built from.
 *
 * One idea carries it: a row's left edge is a two-segment gutter, health
 * above and sync below. Two states that used to be two identical green dots
 * are now two different *places*, which is readable at a glance and survives
 * being three pixels wide. The same device is the product's icon.
 */

const tint = (color: string, percent: number) =>
  `color-mix(in oklab, ${color} ${percent}%, transparent)`

/**
 * The status gutter. A resting application shows it at a whisper — it reads
 * as the column's spine, not as a signal. Anything else brings it up to full
 * strength, and a progressing application's health segment sweeps.
 *
 * Loudness comes from the same two predicates the fleet bar counts with, so
 * no row can draw a stripe the summary above it has filed under healthy.
 */
export function StatusGutter({ health, sync }: { health: Health; sync: SyncStatus }) {
  return (
    <span className="gutter" aria-hidden="true">
      {health === 'Progressing' ? (
        <span className="sweep" />
      ) : (
        <span style={{ background: tint(healthColor(health), healthLoud(health) ? 100 : 18) }} />
      )}
      <span style={{ background: tint(syncColor(sync), syncLoud(sync) ? 100 : 18) }} />
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
      className="inline-flex shrink-0 items-center rounded-pill px-1.5 py-px text-[12px] leading-4 font-medium"
      style={{
        background: tint(color, 16),
        color: `color-mix(in oklab, ${color} 40%, var(--color-text))`,
      }}
    >
      {name}
    </span>
  )
}

/** Health above, sync below, in words. Same order as the gutter. */
export function StatePair({ health, sync }: { health: Health; sync: SyncStatus }) {
  const line = (label: string, value: string, color: string) => (
    <span className="flex items-center gap-2">
      <span className="h-4 w-[3px] shrink-0 rounded-[1px]" style={{ background: color }} />
      <span className="text-[13px] text-muted">
        <span className="sr-only">{label}: </span>
        {value}
      </span>
    </span>
  )
  return (
    <span className="flex flex-col gap-1">
      {line('Health', health || 'Unknown', healthColor(health))}
      {line('Sync', sync || 'Unknown', syncColor(sync))}
    </span>
  )
}

/**
 * Every sheet that can change something names what it will change first:
 * acting on the wrong instance is the main hazard of a multi-instance client.
 */
export function SheetTarget({
  instance,
  color,
  production,
  name,
  detail,
}: {
  instance: string
  color: string
  production?: boolean
  name: string
  detail?: ReactNode
}) {
  return (
    <div className="rounded-pill bg-inset px-3 py-2.5">
      <span className="flex flex-wrap items-center gap-1.5">
        <InstancePill name={instance} color={color} />
        {production && (
          <span className="rounded-pill bg-outofsync/15 px-1.5 py-px text-[12px] leading-4 font-medium text-outofsync">
            production
          </span>
        )}
      </span>
      <p className="t-name mt-1.5 text-[17px]">{name}</p>
      {detail && <p className="mt-0.5 text-[13px] text-muted-tint">{detail}</p>}
    </div>
  )
}

/** Seven-character revisions, in the face reserved for machine identifiers. */
export function Revision({ sha, className = '' }: { sha?: string; className?: string }) {
  if (!sha) return null
  return <span className={`t-mono text-[12px] ${className}`}>{sha.slice(0, 7)}</span>
}

/* Icons: stroked, 22px, currentColor. Drawn rather than installed — five
   glyphs do not justify a dependency. */

const svg = (children: ReactNode, size = 22) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)

export const AppsIcon = () =>
  svg(
    <>
      <path d="M4 6h2M9 6h11" />
      <path d="M4 12h2M9 12h11" />
      <path d="M4 18h2M9 18h11" />
    </>,
  )

export const SettingsIcon = () =>
  svg(
    <>
      <path d="M3 7h10M17 7h4" />
      <circle cx="15" cy="7" r="2.2" />
      <path d="M3 17h4M11 17h10" />
      <circle cx="9" cy="17" r="2.2" />
    </>,
  )

export const BackIcon = () => svg(<path d="M14 5l-7 7 7 7" />, 18)

export const TrashIcon = () =>
  svg(
    <>
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M6 7l1 12h10l1-12" />
    </>,
    20,
  )
