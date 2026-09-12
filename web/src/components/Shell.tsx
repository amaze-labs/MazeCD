import { Link, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useOnline } from '../lib/online'

export function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const online = useOnline()
  const tab = (to: string, label: string) => (
    <Link
      to={to}
      className={`flex-1 py-3 text-center text-sm ${
        pathname === to ? 'text-accent' : 'text-muted'
      }`}
    >
      {label}
    </Link>
  )
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="flex-1 pb-20">
        {!online && (
          <div className="bg-[#3a2d1d] px-4 py-2 text-center text-sm">
            Offline — showing nothing newer than the last successful refresh.
          </div>
        )}
        {children}
      </main>
      <nav className="pb-safe fixed inset-x-0 bottom-0 flex border-t border-border bg-surface/95 backdrop-blur">
        {tab('/', 'Apps')}
        {tab('/settings', 'Settings')}
      </nav>
    </div>
  )
}
