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
    <div
      className="flex gap-[13px] border-b border-rule py-3 pr-4 pl-[13px]"
      aria-hidden="true"
    >
      {/* The rail is drawn at the rule colour rather than as a shimmering bar:
          it is the one thing on the row that is already there before the data
          is, and a rail with no health yet is not a state to animate. */}
      <span className="w-[3px] flex-none self-stretch bg-rule" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2.5">
          <span className="skel h-[17px]" style={{ width: NAME_WIDTHS[i % 8] }} />
          <span className="skel h-3.5 w-16 flex-none" />
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2.5">
          <span className="skel h-3 w-28" />
          <span className="skel h-3 w-20 flex-none" />
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2.5">
          <span className="skel h-3 w-24" />
          <span className="skel h-3 w-16 flex-none" />
        </div>
      </div>
    </div>
  )
}

/** Eight rows: what fits on the phone this is built for, so the skeleton
 * fills the screen the list will fill and the page does not grow under the
 * thumb when the answer arrives. */
export function AppListSkeleton() {
  return (
    <div aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
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
      <div className="flex gap-[13px] pt-1.5 pr-4 pb-4 pl-[13px]">
        <span className="w-[3px] flex-none self-stretch bg-rule" />
        <div className="min-w-0 flex-1">
          <span className="skel block h-3 w-24" />
          <span className="skel mt-1.5 block h-[27px] w-[62%]" />
          <span className="skel mt-2 block h-3.5 w-[70%]" />
        </div>
      </div>
      <div className="border-y border-rule">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex justify-between px-4 py-3 [&+&]:border-t [&+&]:border-rule">
            <span className="skel h-3 w-20" />
            <span className="skel h-3" style={{ width: NAME_WIDTHS[(i + 3) % 8] }} />
          </div>
        ))}
      </div>
      <div className="flex px-4 py-4.5">
        <span className="h-12 flex-1 rounded-control ring-1 ring-rule" />
      </div>
    </div>
  )
}

/** The grouped resources: bands at 40px with member rows at 60px under them,
 * in the rhythm the real list has. */
const GROUP_SIZES = [1, 1, 2, 1, 3]

export function TreeSkeleton() {
  return (
    <div aria-hidden="true">
      {GROUP_SIZES.map((n, g) => (
        <section key={g} className="[&+&]:pt-3">
          <div className="flex h-10 items-center bg-band px-4">
            <span className="skel h-3 w-32" />
          </div>
          <div className="px-4">
            {Array.from({ length: n }, (_, i) => (
              <div
                key={i}
                className="flex min-h-[60px] items-center gap-3 py-2.5 [&+div]:border-t [&+div]:border-rule"
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
