import { Link, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useOnline } from '../lib/online'
import { AppsIcon, SettingsIcon } from './ui'

export function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const online = useOnline()
  const tab = (to: string, label: string, icon: ReactNode) => {
    const on = pathname === to
    return (
      <Link
        to={to}
        aria-current={on ? 'page' : undefined}
        className={`relative flex flex-1 flex-col items-center gap-1 pt-2.5 pb-1 ${
          on ? 'text-text' : 'text-muted'
        }`}
      >
        {on && (
          <span
            className="absolute top-0 h-0.5 w-6 rounded-full bg-text"
            aria-hidden="true"
          />
        )}
        {icon}
        <span className="text-[11px] leading-[14px]">{label}</span>
      </Link>
    )
  }
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="flex-1 pb-24">
        {!online && (
          <p className="bg-surface-outofsync px-4 py-2 text-center text-[13px] leading-snug text-outofsync">
            Offline. Nothing here is newer than the last successful refresh.
          </p>
        )}
        {children}
      </main>
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 flex border-t border-rule bg-panel/95 backdrop-blur">
        {tab('/', 'Applications', <AppsIcon />)}
        {tab('/settings', 'Settings', <SettingsIcon />)}
      </nav>
    </div>
  )
}
