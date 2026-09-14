import { useQuery } from '@tanstack/react-query'
import { CircleCheck, KeyRound, LogOut, Moon, Server, ServerOff, Smartphone, Sun, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useInstances } from '../api/queries'
import { api } from '../api/client'
import { useAuth } from '../lib/auth'
import { Button, EmptyState, InstancePill, tint } from '../components/ui'
import { setTheme, useThemeChoice, type ThemeChoice } from '../lib/theme'
import type { InstanceInfo } from '../api/types'

/**
 * The connection, in the same grammar as everything else: an icon, a word and
 * a colour. Not an ArgoCD health state, so it does not borrow the badge — but
 * it is read the same way, and a bare green word was the last place on this
 * screen still speaking 2010s admin table.
 */
function link(i: InstanceInfo): { word: string; icon: LucideIcon; color: string } {
  if (!i.reachable)
    return { word: 'Unreachable', icon: TriangleAlert, color: 'var(--color-degraded)' }
  if (!i.tokenValid)
    return { word: 'Token rejected', icon: KeyRound, color: 'var(--color-outofsync)' }
  return { word: 'Connected', icon: CircleCheck, color: 'var(--color-healthy)' }
}

/** Three, not a switch. "System" is the absence of a decision, and once a
 * decision has been made a two-state control can never give it back. */
const THEMES: { value: ThemeChoice; label: string; icon: LucideIcon }[] = [
  { value: 'system', label: 'System', icon: Smartphone },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

export function Settings() {
  const instances = useInstances()
  const { logout } = useAuth()
  const theme = useThemeChoice()
  const version = useQuery({
    queryKey: ['version'],
    queryFn: () => api.get<{ version: string }>('/api/version'),
    refetchInterval: false,
  })

  return (
    <div className="px-4">
      <header className="pt-safe pb-4">
        <h1 className="t-name text-[19px]">Settings</h1>
      </header>

      <section>
        <h2 className="text-[12px] font-semibold tracking-wider text-muted uppercase">Instances</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          These come from the configuration file mounted into MazeCD. To change one, edit the file
          and restart the server.
        </p>
        <ul className="mt-3 flex flex-col gap-0.5">
          {(instances.data ?? []).map((i) => {
            const state = link(i)
            const StateIcon = state.icon
            return (
              <li
                key={i.name}
                className="flex items-center gap-3 rounded-card bg-panel px-3 py-2.5 shadow-[var(--shadow-card)]"
              >
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-control"
                  style={{
                    boxShadow: `inset 0 0 0 1px ${tint(i.color, 'var(--tint-outline)')}`,
                    color: i.color,
                  }}
                  aria-hidden="true"
                >
                  <Server size={17} strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <InstancePill name={i.name} color={i.color} />
                    {i.production && (
                      <span className="inline-flex h-6 items-center rounded-pill px-2 text-[12px] font-medium text-outofsync ring-1 ring-outofsync/65">
                        production
                      </span>
                    )}
                    <span
                      className="inline-flex h-6 items-center gap-1.5 rounded-pill px-2 text-[12px] font-medium"
                      style={{
                        boxShadow: `inset 0 0 0 1px ${tint(state.color, 'var(--tint-outline)')}`,
                        color: state.color,
                      }}
                    >
                      <StateIcon size={13} strokeWidth={2.2} aria-hidden="true" />
                      {state.word}
                    </span>
                  </div>
                  <p className="t-mono mt-1 truncate text-[12px] text-muted">{i.url}</p>
                  {i.error && (
                    <p className="mt-1 text-[13px] leading-snug text-text-degraded">{i.error}</p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
        {(instances.data ?? []).length === 0 && !instances.isLoading && (
          <div className="-mx-4">
            <EmptyState
              icon={<ServerOff size={22} strokeWidth={2} />}
              title="No instances configured"
            >
              MazeCD reads its instances from the configuration file mounted into the server.
              Add one there and restart it, and the fleet appears here.
            </EmptyState>
          </div>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-[12px] font-semibold tracking-wider text-muted uppercase">
          Appearance
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          MazeCD follows the phone unless you tell it otherwise. The choice is remembered on this
          device.
        </p>
        <div
          className="mt-3 flex gap-1 rounded-control bg-panel p-1 shadow-[var(--shadow-card)]"
          role="group"
          aria-label="Theme"
        >
          {THEMES.map(({ value, label, icon: Icon }) => {
            const on = theme === value
            return (
              <button
                key={value}
                type="button"
                aria-pressed={on}
                onClick={() => setTheme(value)}
                className={`flex h-11 flex-1 items-center justify-center gap-2 rounded-[8px] text-[14px] font-medium transition-colors ${
                  on ? 'text-text ring-1 ring-rule' : 'text-muted hover:text-text'
                }`}
              >
                <Icon size={16} strokeWidth={2.2} aria-hidden="true" />
                {label}
              </button>
            )
          })}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-[12px] font-semibold tracking-wider text-muted uppercase">Build</h2>
        <dl className="mt-2 flex flex-col gap-1 rounded-card bg-panel px-3 py-2.5 text-[14px] shadow-[var(--shadow-card)]">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Server</dt>
            <dd className="t-mono text-[13px]">{version.data?.version ?? '…'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Client</dt>
            <dd className="t-mono text-[13px]">{__BUILD_VERSION__}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-6 pb-4">
        <Button className="w-full" onClick={() => void logout()}>
          <LogOut size={17} aria-hidden="true" />
          Sign out
        </Button>
      </section>
    </div>
  )
}
