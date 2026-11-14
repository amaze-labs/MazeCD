import type { ReactNode } from 'react'

/**
 * The top of a tab's screen, as every Maze tool opens: the logo, the title,
 * and a mono line under it with the version and what the screen is counting.
 * The logo is the app's own icon, so a screenshot of any screen says which
 * product it is.
 */
export function ScreenHeader({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <header className="pt-safe flex items-center gap-2.5 px-3.5 pb-3">
      <img src="/favicon.svg" alt="MazeCD" className="size-[34px] flex-none rounded-[8px]" />
      <div className="min-w-0 flex-1">
        <h1 className="t-title text-[23px]">{title}</h1>
        <p className="t-mono mt-1 truncate text-[10px] text-dim">
          <b className="font-medium text-muted">MazeCD {__BUILD_VERSION__}</b>
          {sub && <> · {sub}</>}
        </p>
      </div>
      {action}
    </header>
  )
}
