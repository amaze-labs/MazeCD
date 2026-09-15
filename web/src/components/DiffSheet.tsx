import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronRight, CircleCheck, GitCompareArrows, RefreshCw, ServerOff } from 'lucide-react'
import { Sheet } from './Sheet'
import { Button, Callout, EmptyState } from './ui'
import { SheetListSkeleton } from './Skeleton'
import { useManagedResources } from '../api/queries'
import { differs, entryOf, headline, splitPath, type Change, type Entry } from '../lib/diff'
import { ago } from '../lib/ago'
import { useOnline } from '../lib/online'
import { shortRev } from '../lib/rev'

/**
 * WHAT DIFFERS — the answer to the question every yellow row has been asking.
 *
 * MazeCD shows almost nothing on purpose, and `OutOfSync` was the one state
 * it could not follow up on: the operator saw the word, could not see the
 * difference, and opened a laptop. That journey is the one this app exists to
 * save, so this sheet is not a developer's diff viewer bolted on — it is the
 * second half of a sentence the list has been leaving unfinished.
 *
 * WHAT IS ON SCREEN WHEN IT OPENS, and what has to be asked for.
 *
 * A unified diff of six Kubernetes objects is two hundred lines, of which
 * three matter, and at 390px the other hundred and ninety-seven are all you
 * can see. So nothing here is a document. `lib/diff.ts` walks both objects to
 * their leaves and returns the ones that disagree, and this draws them —
 * every changed field of every drifted resource, open, with no tap at all:
 *
 *     spec.template.spec.containers.0.image
 *     - registry.internal/doc-archive:1.4.1
 *     + registry.internal/doc-archive:1.4.2
 *
 * That is the whole of what an operator standing somewhere with a phone needs
 * from "what is different?", and in the ordinary case it is three lines.
 *
 * Three things are folded, because none of them is the answer:
 *  - **the resources that match**, in one group at the bottom whose band says
 *    how many. They are still listed — "nothing differs" and "we did not look"
 *    are different claims, and a diff that only ever shows differences never
 *    has to decide what "no change" looks like;
 *  - **a resource that exists on only one side**, whose every field is a
 *    difference and whose answer is the one line on its band. Nobody reads
 *    forty added fields; they read "only in Git" and press Synchronize;
 *  - **the tail of a long change list**, once there is a tail worth folding.
 *
 * IT IS A SNAPSHOT AND IT SAYS SO. `managed-resources` is not a stream —
 * ArgoCD offers a watch for applications and for a resource tree, which is
 * what `lib/live.ts` holds open, and none for this. So the sheet says what it
 * is, prints how old the reading is, and offers to take another. It does not
 * poll: the state behind a diff is exactly the state that must not move while
 * somebody is reading it.
 *
 * NO RED AND NO GREEN. A diff wants them and cannot have them here: on this
 * screen red is `Degraded` and green is `Healthy`, and six red lines under a
 * healthy application would be six false readings of the one thing this
 * palette spends colour on. The diff is told the way a terminal tells it with
 * the colour off — a `-` and a `+` in a fixed gutter, the cluster's value in
 * dim ink and Git's in full — and the two signs are named in words at the top
 * so nothing has to be learned. `<del>` and `<ins>` carry the same fact to a
 * screen reader, which a colour never could.
 */

/**
 * HOW MUCH OF ONE RESOURCE'S CHANGE LIST IS SHOWN, and when the rest folds.
 *
 * Six survives, because six is the one thing it ever honestly claimed: six
 * field blocks is about the height of a 393px phone, so past six a single
 * resource buries every resource under it and the operator is scrolling
 * rather than reading.
 *
 * The count was never the broken part. The boundary was. A resource with
 * seven changes folded exactly one line away and charged a summary row, a
 * chevron, a decision and a tap for it — hiding one line behind a control
 * costs more than the line does, every time. So nothing folds until there is
 * a tail worth folding: a list a little over a screenful is poured out whole
 * and scrolled, which is what the operator was about to do anyway, and only a
 * list that is genuinely long is cut back to a screenful.
 *
 * NOT FOLDED BY SIGNIFICANCE — "show `spec`, hide `metadata.annotations`" —
 * which is the other instrument on offer and the tempting one. That is a
 * deny-list of noisy paths under another name, and `lib/diff.ts` refused to
 * invent one for a reason that has not changed: nothing in this repository
 * has ever seen a real cluster's drift, and a guess about which fields are
 * noise is a guess that eventually hides the only field that mattered. A
 * count hides nothing an operator cannot get back with one tap.
 */
const VISIBLE = 6

/** The shortest tail worth a tap. Below this the fold is pure ceremony. */
const WORTH_FOLDING = 3

/** The change list, split into what is drawn and what is behind the fold. */
export function fold(changes: Change[]): { shown: Change[]; rest: Change[] } {
  if (changes.length <= VISIBLE + WORTH_FOLDING) return { shown: changes, rest: [] }
  return { shown: changes.slice(0, VISIBLE), rest: changes.slice(VISIBLE) }
}

/**
 * The age of the reading, ticking. Nothing else re-renders this sheet — the
 * query deliberately does not poll — so an age printed once would still say
 * "just now" three minutes later, which is the old silence wearing a
 * friendlier face. A minute is the resolution `ago` reports in.
 */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  return now
}

/** The grey strip a group sits on, exactly as the resource list uses it. */
const BAND = 't-mono flex h-10 items-center gap-3 bg-band px-4 text-[12px]'

/** One leaf, as a diff reads: the field named, then what the cluster has and
 * what Git asks for, each behind its sign. Values wrap rather than scroll —
 * an image digest is 80 characters and a phone is 40 — and they wrap under
 * the gutter, so the signs stay a column the eye can run down. */
function Line({ change }: { change: Change }) {
  const [scenery, field] = splitPath(change.path)
  return (
    <div className="px-4 py-2.5 [&+&]:border-t [&+&]:border-rule">
      <p className="t-mono mb-1.5 text-[10.5px] leading-[1.3] break-all text-dim">
        {scenery}
        <b className="font-normal text-muted">{field}</b>
      </p>
      {change.from !== undefined && (
        <p className="t-mono flex gap-2 text-[11.5px] leading-[1.35]">
          <span className="flex-none text-dim" aria-hidden="true">
            -
          </span>
          <del className="min-w-0 flex-1 break-all text-dim no-underline">{change.from}</del>
        </p>
      )}
      {change.to !== undefined && (
        <p className="t-mono flex gap-2 text-[11.5px] leading-[1.35]">
          <span className="flex-none text-muted" aria-hidden="true">
            +
          </span>
          <ins className="min-w-0 flex-1 break-all text-text no-underline">{change.to}</ins>
        </p>
      )}
    </div>
  )
}

/** The band's right-hand verdict: the one thing about this resource an
 * operator can act on without reading a single field. */
function verdict(e: Entry): string {
  if (e.presence === 'git-only') return 'only in Git'
  if (e.presence === 'cluster-only') return 'only in the cluster'
  const n = e.changes.length
  return n === 1 ? '1 change' : `${n} changes`
}

function Fold({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="t-mono flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[11.5px] text-muted [&::-webkit-details-marker]:hidden">
        {label}
        <ChevronRight
          size={11}
          strokeWidth={1.5}
          className="transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
      </summary>
      {children}
    </details>
  )
}

function Resource({ entry }: { entry: Entry }) {
  // A one-sided resource folds its whole field list: the band already said
  // the only thing anyone reads it for.
  const { shown, rest } =
    entry.presence === 'both' ? fold(entry.changes) : { shown: [], rest: entry.changes }
  return (
    <section className="[&+&]:pt-3">
      {/* TWO RESOURCES OF ONE NAME. A Helm chart names its Deployment, its
          Service and its ServiceAccount after the release, so this sheet used
          to draw two and three adjacent bands all reading `doc-archive` with
          nothing on any of them to say which object the fields underneath
          belonged to. The kind is the thing that tells them apart, so it is on
          the band and not in a line below it. It is the *name* that truncates
          when the two will not fit: a cut name is still a name, a cut kind is
          no longer a disambiguator. */}
      <div className={BAND}>
        <span className="min-w-0 truncate text-text">{entry.name}</span>
        <span className="flex-none text-[11px] text-dim">{entry.kind}</span>
        <span className="ml-auto flex-none text-[11.5px] text-muted">{verdict(entry)}</span>
      </div>
      <p className="t-mono px-4 pt-2 pb-1 text-[10.5px] leading-[1.2] text-dim">
        in {entry.namespace || 'cluster-scope'}
      </p>
      {entry.presence === 'git-only' && (
        <p className="px-4 pt-1.5 pb-1 text-[12.5px] leading-snug text-muted">
          The cluster does not have this. Synchronizing creates it.
        </p>
      )}
      {entry.presence === 'cluster-only' && (
        <p className="px-4 pt-1.5 pb-1 text-[12.5px] leading-snug text-muted">
          Git does not have this. Only a sync with prune removes it.
        </p>
      )}
      {shown.map((c) => (
        <Line key={c.path} change={c} />
      ))}
      {rest.length > 0 && (
        <Fold
          label={
            shown.length === 0
              ? `all ${rest.length} field${rest.length === 1 ? '' : 's'}`
              : `${rest.length} more`
          }
        >
          {rest.map((c) => (
            <Line key={c.path} change={c} />
          ))}
        </Fold>
      )}
      {/* ArgoCD says this resource is modified and no leaf of it disagrees:
          a difference its normalizers removed, or one that is only a
          reordering. Saying "identical" here would be a lie about the thing
          ArgoCD is going to act on, so it says exactly what it knows. */}
      {entry.presence === 'both' && entry.changes.length === 0 && (
        <p className="px-4 pt-1.5 pb-2 text-[12.5px] leading-snug text-muted">
          ArgoCD reports a difference, but no field of the two objects
          disagrees — it is in something its normalizers removed, or in the
          order of a list.
        </p>
      )}
    </section>
  )
}

export function DiffSheet({
  instance,
  name,
  revision,
  onClose,
}: {
  instance: string
  name: string
  revision?: string
  onClose: () => void
}) {
  const q = useManagedResources(instance, name)
  const online = useOnline()
  const now = useNow()
  const items = q.data?.items
  const entries = useMemo(() => (items ?? []).map(entryOf), [items])
  const drifted = entries.filter(differs)
  const same = entries.filter((e) => !differs(e))
  const taken = ago(q.dataUpdatedAt ? new Date(q.dataUpdatedAt).toISOString() : undefined, now)

  return (
    <Sheet open onClose={onClose} title="What differs" icon={<GitCompareArrows size={15} />}>
      {q.isLoading ? (
        <div className="-mx-4">
          <SheetListSkeleton />
        </div>
      ) : q.isError ? (
        <Callout
          icon={<ServerOff size={17} strokeWidth={2} />}
          title="Could not compare this application"
          action={
            <Button className="!h-10" onClick={() => void q.refetch()}>
              Try again
            </Button>
          }
        >
          <span className="t-mono block text-[11.5px]">{String(q.error)}</span>
        </Callout>
      ) : (
        <>
          <p className="text-[13px] leading-snug">{headline(entries)}</p>

          {/* WHEN THIS WAS READ, AND THAT IT WILL NOT READ ITSELF AGAIN.
              Two honest answers existed and this is the second one. The first
              — keep it live — has nothing to be live from: ArgoCD publishes a
              watch for an application and one for its resource tree, which is
              what `lib/live.ts` holds open, and none at all for
              `managed-resources`, so "live" could only ever have meant a
              timer. A timer is the answer that is worse than both: it re-cuts
              the page under a thumb halfway down a forty-field diff, it makes
              every instance re-render the application from Git for as long as
              a sheet is open, and it cannot be honest on a phone that has no
              signal — `useOnline` knows, and a diff claiming to be live
              offline would be a fresh lie in the place of the old one.
              So: say what it is, say how old it is, and let it be retaken by
              the one person who knows they have stopped reading. */}
          <div className="mt-2.5 flex items-center gap-3">
            <span className="t-mono min-w-0 flex-1 text-[11px] leading-[1.3] text-dim">
              snapshot, taken {!taken || taken.short === 'now' ? 'just now' : `${taken.short} ago`}
            </span>
            {/* `faint`, not the brighter edge Refresh and Sync carry behind
                this sheet: re-reading is a read, and the loudest thing on a
                sheet whose whole point is the answer should not be the offer
                to fetch it again. */}
            <Button
              tone="faint"
              className="!h-9 flex-none !px-3 !text-[11.5px]"
              onClick={() => void q.refetch()}
              disabled={!online || q.isFetching}
            >
              <RefreshCw
                size={12}
                strokeWidth={1.6}
                className={q.isFetching ? 'spin' : ''}
                aria-hidden="true"
              />
              {q.isFetching ? 'Reading' : 'Read again'}
            </Button>
          </div>

          {/* The legend, once, in words: the whole reason this does not need
              a colour. */}
          <p className="t-mono mt-3 flex items-center text-[11px] text-dim">
            <b className="font-normal">-</b>
            <span className="ml-1.5">in the cluster</span>
            <i className="sep" aria-hidden="true" />
            <b className="font-normal">+</b>
            <span className="ml-1.5">in Git{revision ? ` at ${shortRev(revision)}` : ''}</span>
          </p>

          <div className="mt-3.5 -mx-4">
            {drifted.map((e) => (
              <Resource key={e.key} entry={e} />
            ))}

            {drifted.length === 0 && entries.length > 0 && (
              <EmptyState icon={<CircleCheck size={22} strokeWidth={1.6} />} title="Nothing differs">
                ArgoCD compared every managed resource against Git and found no difference. If the
                application still says OutOfSync, a hard refresh is what makes it re-render the
                manifests and look again.
              </EmptyState>
            )}
            {entries.length === 0 && (
              <EmptyState
                icon={<GitCompareArrows size={22} strokeWidth={1.6} />}
                title="Nothing to compare"
              >
                ArgoCD reports no managed resources for this application. If it was only just
                created, it has not been synced yet — nothing is wrong, there is simply nothing
                there.
              </EmptyState>
            )}

            {/* The resources that match, named but out of the way. They are
                listed rather than dropped: "these are the same" is a reading,
                and silence about it is indistinguishable from not looking. */}
            {same.length > 0 && (
              <details className="group mt-3">
                <summary className={`${BAND} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
                  identical
                  <span className="ml-auto flex items-center gap-2 text-[11.5px] text-muted">
                    {same.length}
                    <ChevronRight
                      size={11}
                      strokeWidth={1.5}
                      className="transition-transform group-open:rotate-90"
                      aria-hidden="true"
                    />
                  </span>
                </summary>
                {same.map((e) => (
                  <div key={e.key} className="px-4 py-2.5 [&+div]:border-t [&+div]:border-rule">
                    <span className="t-mono block truncate text-[12px] leading-[1.25]">{e.name}</span>
                    <span className="t-mono mt-[3px] block truncate text-[10.5px] leading-[1.2] text-dim">
                      {e.kind}
                      {e.namespace ? ` · ${e.namespace}` : ''}
                    </span>
                  </div>
                ))}
              </details>
            )}
          </div>
        </>
      )}
    </Sheet>
  )
}
