/**
 * What the screen looks like while it is still arriving.
 *
 * Not a spinner. A spinner says "wait" and nothing else; a skeleton says what
 * is coming, and it says it in the shape the thing will actually have — so the
 * eye has already found the rail, the name and the verdict column before the
 * first byte lands, and nothing moves when it does.
 *
 * Which means these are not generic grey bars: every measurement here is
 * copied from the component it stands in for. If a row's geometry changes and
 * this does not, the list will jump when the data arrives, and that jump is
 * the bug this exists to prevent.
 */

/** The name bar, varied down the list: eight identical rows read as a pattern
 * rather than as a list of applications with different names. */
const NAME_WIDTHS = ['62%', '44%', '78%', '55%', '70%', '38%', '66%', '50%']

function AppRowSkeleton({ i }: { i: number }) {
  return (
    <div className="py-2 pr-3 pl-3.5 [&+&]:border-t [&+&]:border-rule" aria-hidden="true">
      <div className="flex items-center justify-between gap-2.5">
        <span className="skel h-[16px] rounded-[3px]" style={{ width: NAME_WIDTHS[i % 8] }} />
        <span className="skel h-[19px] w-16 flex-none rounded-badge" />
      </div>
      <div className="mt-[5px] flex items-center justify-between gap-2.5">
        <span className="skel h-2.5 w-44 rounded-[3px]" />
        <span className="skel h-2.5 w-8 flex-none rounded-[3px]" />
      </div>
    </div>
  )
}

/** Ten rows: what fits on the phone this is built for, so the skeleton
 * fills the screen the list will fill and the page does not grow under the
 * thumb when the answer arrives. */
export function AppListSkeleton() {
  return (
    <div className="card mx-3.5 mt-2 overflow-hidden" aria-hidden="true">
      {Array.from({ length: 10 }, (_, i) => (
        <AppRowSkeleton key={i} i={i} />
      ))}
    </div>
  )
}

/** The detail header and the table under it: the rail, the project line, the
 * name at 26px, the three verdicts, seven ruled facts and the one button. */
export function AppDetailSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="card mx-3.5 px-3.5 pt-3 pb-3">
        <span className="skel block h-[21px] w-32 rounded-badge" />
        <span className="skel mt-2.5 block h-[28px] w-[62%] rounded-[4px]" />
        <span className="skel mt-2.5 block h-[26px] w-[70%] rounded-badge" />
      </div>
      <div className="card mx-3.5 mt-2 grid grid-cols-2 gap-px overflow-hidden !bg-rule">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={`bg-panel px-3.5 pt-2.5 pb-3 ${i >= 4 ? 'col-span-2' : ''}`}>
            <span className="skel block h-2 w-16 rounded-[2px]" />
            <span className="skel mt-2 block h-3 rounded-[3px]" style={{ width: NAME_WIDTHS[(i + 3) % 8] }} />
          </div>
        ))}
      </div>
      <div className="mx-3.5 mt-2 grid grid-cols-2 gap-2">
        <span className="card h-11" />
        <span className="h-11 rounded-control bg-skel" />
      </div>
    </div>
  )
}

/** The grouped resources: bands at 40px with member rows at 60px under them,
 * in the rhythm the real list has. */
const GROUP_SIZES = [1, 1, 2, 1, 3]

export function TreeSkeleton() {
  return (
    <div className="mx-3.5 flex flex-col gap-2" aria-hidden="true">
      {GROUP_SIZES.map((n, g) => (
        <section key={g} className="card overflow-hidden">
          <div className="flex h-9 items-center border-b border-rule bg-band px-3.5">
            <span className="skel h-3 w-32" />
          </div>
          <div className="px-3.5">
            {Array.from({ length: n }, (_, i) => (
              <div
                key={i}
                className="flex min-h-[54px] items-center gap-3 py-2 [&+div]:border-t [&+div]:border-rule"
              >
                <span className="min-w-0 flex-1">
                  <span className="skel block h-3.5" style={{ width: NAME_WIDTHS[(g + i) % 8] }} />
                  <span className="skel mt-1.5 block h-2.5 w-20" />
                </span>
                <span className="skel h-3 w-[46px] flex-none" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

/** What both of the read-only sheets are waiting for: a list of resources
 * under bands. The same 40px band and the same ruled rows they will draw, so
 * nothing jumps when the answer lands. */
export function SheetListSkeleton() {
  return (
    <div aria-hidden="true">
      {[2, 1, 3].map((n, g) => (
        <section key={g} className="[&+&]:pt-3">
          <div className="flex h-10 items-center bg-band px-4">
            <span className="skel h-3" style={{ width: NAME_WIDTHS[g] }} />
          </div>
          {Array.from({ length: n }, (_, i) => (
            <div key={i} className="px-4 py-2.5 [&+div]:border-t [&+div]:border-rule">
              <span className="skel block h-2.5 w-[46%]" />
              <span className="skel mt-2 block h-2.5" style={{ width: NAME_WIDTHS[(g + i) % 8] }} />
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
