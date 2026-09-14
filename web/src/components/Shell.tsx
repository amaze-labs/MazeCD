import { Link, useLocation, useNavigationType } from 'react-router-dom'
import { useEffect, type ReactNode } from 'react'
import { useOnline } from '../lib/online'
import { useLiveApps } from '../lib/live'
import { LayoutList, SlidersHorizontal } from 'lucide-react'

export function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const navigation = useNavigationType()
  const online = useOnline()
  // One place, above every screen: the streams follow the session, not the
  // route, so navigating between the list and a detail never drops them.
  useLiveApps()

  /**
   * A NEW SCREEN STARTS AT THE TOP. THE ONE YOU CAME BACK TO DOES NOT.
   *
   * Scrolling here is the window's — nothing in this tree is an overflow
   * container — and a plain `BrowserRouter` swaps the route's element under a
   * window that keeps its offset. Tap the fiftieth row of the list and the
   * detail, which is shorter, renders somewhere in its middle.
   *
   * Only on PUSH. Coming back to ninety-nine rows and losing your place is the
   * same bug wearing different clothes, and the browser already restores that
   * offset itself on POP — it can, because the list renders from the query
   * cache in the same frame rather than after a fetch. `npm run live` checks
   * both halves, because this is entirely about real scroll in a real browser.
   */
  useEffect(() => {
    if (navigation === 'PUSH') window.scrollTo(0, 0)
  }, [pathname, navigation])
  const tab = (to: string, label: string, icon: ReactNode) => {
    const on = pathname === to
    return (
      <Link
        to={to}
        aria-current={on ? 'page' : undefined}
        // Ink on black, not the accent. This bar is on screen for the whole
        // of both screens the design governs, and that palette spends colour
        // only on status -- a magenta strip above ninety-nine status rows is
        // the loudest non-data thing in the product.
        className={`relative flex flex-1 flex-col items-center gap-1 pt-2.5 pb-1 ${
          on ? 'text-text' : 'text-dim'
        }`}
      >
        {on && (
          <span
            className="absolute top-0 h-0.5 w-6 bg-text"
            aria-hidden="true"
          />
        )}
        {icon}
        <span className="t-mono text-[10.5px] leading-[14px]">{label}</span>
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
          <p className="border-b border-outofsync/60 px-4 py-2 text-center text-[12.5px] leading-snug text-outofsync">
            Offline. Nothing here is newer than the last successful refresh.
          </p>
        )}
        {children}
      </main>
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 flex border-t border-rule bg-ink">
        {tab('/', 'Applications', <LayoutList size={21} aria-hidden="true" />)}
        {tab('/settings', 'Settings', <SlidersHorizontal size={21} aria-hidden="true" />)}
      </nav>
    </div>
  )
}
