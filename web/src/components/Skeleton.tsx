/**
 * What the screen looks like while it is still arriving.
 *
 * Not a spinner. A spinner says "wait" and nothing else; a skeleton says what
 * is coming, and it says it in the shape the thing will actually have — so the
 * eye has already found the age column, the name and the resource count before
 * the first byte lands, and nothing moves when it does.
 *
 * Which means these are not generic grey bars: every measurement here is
 * copied from the component it stands in for. `AppRowSkeleton` is `AppRow`'s
 * grid, its three tracks, its padding and its border, with the text replaced.
 * If a row's geometry changes and this does not, the list will jump when the
 * data arrives, and that jump is the bug this exists to prevent.
 */

/** The name bar, varied down the list: eight identical rows read as a
 * pattern rather than as a list of applications with different names. */
const NAME_WIDTHS = ['62%', '44%', '78%', '55%', '70%', '38%', '66%', '50%']

function AppRowSkeleton({ i }: { i: number }) {
  return (
    <div
      className="grid grid-cols-[3.25rem_minmax(0,1fr)_2.25rem] items-center gap-x-2.5 rounded-card border border-rule bg-panel px-2.5 py-1.5"
      aria-hidden="true"
    >
      {/* The mark and the age, in AppRow's leading column. The tile is drawn
          outlined rather than as a skeleton bar, because it is the one thing
          on the row that is already there before the data is. */}
      <span className="col-start-1 row-span-2 flex flex-col items-end gap-0.5">
        <span className="size-5 shrink-0 rounded-tile ring-1 ring-rule" />
        <span className="skel h-3.5 w-7" />
      </span>
      <span className="skel col-start-2 row-start-1 h-[17px]" style={{ width: NAME_WIDTHS[i % 8] }} />
      {/* The meta line is a state word and an instance pill and a revision,
          not one long bar: a single wide block there read as a second title
          and made the skeleton look like a two-line list it is not. */}
      <span className="col-start-2 row-start-2 mt-0.5 flex items-center gap-1.5">
        <span className="skel h-6 w-16 rounded-pill" />
        <span className="skel h-3 w-14" />
      </span>
      <span className="skel col-start-3 row-span-2 ml-auto h-3.5 w-5" />
    </div>
  )
}

/** Eight rows: what fits on the phone this is built for, so the skeleton
 * fills the screen the list will fill and the page does not grow under the
 * thumb when the answer arrives. */
export function AppListSkeleton() {
  return (
    <div className="mt-2 flex flex-col gap-1.5 px-4 pb-2" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <AppRowSkeleton key={i} i={i} />
      ))}
    </div>
  )
}

/** The detail header: title, the two state badges, the instance line and the
 * one button — in their places, at their sizes. */
export function AppDetailSkeleton() {
  return (
    <div aria-hidden="true">
      <span className="skel block h-[23px] w-[64%]" />
      <div className="mt-1.5 flex gap-1.5">
        <span className="skel h-7 w-28 rounded-pill" />
        <span className="skel h-7 w-24 rounded-pill" />
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="skel h-6 w-16 rounded-pill" />
        <span className="skel h-3 w-24" />
      </div>
      <span className="skel mt-2.5 block h-11 w-full rounded-control" />
    </div>
  )
}

/** The tree: rows at the tap height they will have, stepped in the way a
 * tree steps in, so the indentation is legible before the names are. */
const TREE_DEPTHS = [0, 1, 2, 0, 1, 2, 0, 0]

export function TreeSkeleton() {
  return (
    <div className="flex flex-col px-4 py-1" aria-hidden="true">
      {TREE_DEPTHS.map((d, i) => (
        <div key={i} className="flex">
          {Array.from({ length: d }, (_, j) => (
            <span key={j} className="w-3.5 shrink-0 border-l border-rule" />
          ))}
          <div className="my-px flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-card bg-panel px-2">
            <span className="skel size-7 shrink-0 rounded-control" />
            <span className="skel h-3.5" style={{ width: NAME_WIDTHS[(i + 2) % 8] }} />
          </div>
        </div>
      ))}
    </div>
  )
}
