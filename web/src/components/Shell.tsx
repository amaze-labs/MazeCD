import { Link, useLocation, useNavigationType } from 'react-router-dom'
import { useEffect, type ReactNode } from 'react'
import { useOnline } from '../lib/online'
import { useLiveApps } from '../lib/live'
import { Activity, LayoutList, SlidersHorizontal, TriangleAlert } from 'lucide-react'
import { useApps } from '../api/queries'
import { bucketOf } from '../lib/fleet'

export function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const navigation = useNavigationType()
  const online = useOnline()
  // One place, above every screen: the streams follow the session, not the
  // route, so navigating between the list and a detail never drops them.
  useLiveApps()
  const apps = useApps()
  // What the Attention tab holds, counted where the whole app can see it: the
  // number on the tab is the first thing read on opening MazeCD, and zero is
  // said by its absence.
  const attention = (apps.data?.apps ?? []).filter((a) => bucketOf(a) !== 'Healthy').length

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
  const tab = (to: string, label: string, icon: ReactNode, count = 0) => {
    // The list owns the application screens it opens, so its tab stays lit
    // while one of them is on screen.
    const on = pathname === to || (to === '/' && pathname.startsWith('/apps/'))
    return (
      <Link
        to={to}
        aria-current={on ? 'page' : undefined}
        aria-label={count > 0 ? `${label}, ${count}` : undefined}
        className={`relative flex flex-1 flex-col items-center gap-1 pt-2.5 pb-1 ${
          on ? 'text-text' : 'text-dim'
        }`}
      >
        {/* The logo's orange, and the only place it is spent on a screen
            that is not the logo: a status colour here would read as one. */}
        {on && <span className="absolute top-0 h-[3px] w-7 rounded-b-sm bg-brand" aria-hidden="true" />}
        <span className="relative">
          {icon}
          {count > 0 && (
            <b className="t-mono absolute -top-1.5 left-3.5 grid h-[17px] min-w-[18px] place-items-center rounded-full border-2 border-panel bg-degraded px-1 text-[9.5px] leading-none font-semibold text-on-status">
              {count}
            </b>
          )}
        </span>
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
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 flex border-t border-rule bg-panel">
        {tab('/', 'Applications', <LayoutList size={21} aria-hidden="true" />)}
        {tab('/attention', 'Attention', <TriangleAlert size={21} aria-hidden="true" />, attention)}
        {tab('/activity', 'Activity', <Activity size={21} aria-hidden="true" />)}
        {tab('/settings', 'Settings', <SlidersHorizontal size={21} aria-hidden="true" />)}
      </nav>
    </div>
  )
}
