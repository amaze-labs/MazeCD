import { Link, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useOnline } from '../lib/online'
import { useLiveApps } from '../lib/live'
import { LayoutList, SlidersHorizontal } from 'lucide-react'

export function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const online = useOnline()
  // One place, above every screen: the streams follow the session, not the
  // route, so navigating between the list and a detail never drops them.
  useLiveApps()
  const tab = (to: string, label: string, icon: ReactNode) => {
    const on = pathname === to
    return (
      <Link
        to={to}
        aria-current={on ? 'page' : undefined}
        // Where you are, in MazeCD's own colour. One of the four places the
        // accent appears, and the only one that is on screen all the time.
        className={`relative flex flex-1 flex-col items-center gap-1 pt-2.5 pb-1 ${
          on ? 'text-accent' : 'text-muted'
        }`}
      >
        {on && (
          <span
            className="absolute top-0 h-0.5 w-6 rounded-full bg-accent"
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
          // A rule under it rather than a band of amber behind it: this
          // strip spans the whole width and sits above every screen, so it
          // was the single largest field of colour in the product.
          <p className="border-b border-outofsync/60 px-4 py-2 text-center text-[13px] leading-snug text-outofsync">
            Offline. Nothing here is newer than the last successful refresh.
          </p>
        )}
        {children}
      </main>
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 flex border-t border-rule bg-panel">
        {tab('/', 'Applications', <LayoutList size={21} aria-hidden="true" />)}
        {tab('/settings', 'Settings', <SlidersHorizontal size={21} aria-hidden="true" />)}
      </nav>
    </div>
  )
}
