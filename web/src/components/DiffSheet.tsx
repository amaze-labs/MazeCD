import { useMemo, type ReactNode } from 'react'
import { ChevronRight, CircleCheck, GitCompareArrows, ServerOff } from 'lucide-react'
import { Sheet } from './Sheet'
import { Button, Callout, EmptyState } from './ui'
import { SheetListSkeleton } from './Skeleton'
import { useManagedResources } from '../api/queries'
import { differs, entryOf, headline, splitPath, type Change, type Entry } from '../lib/diff'

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
 *  - **the tail of a long change list**, past the first six.
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

/** How many changes of one resource are shown before the rest is folded. Six
 * is about a phone screen; past that the operator is reading a manifest, not
 * a difference, and should be asked whether they meant to. */
const VISIBLE = 6

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
  const shown = entry.presence === 'both' ? entry.changes.slice(0, VISIBLE) : []
  const rest = entry.changes.slice(shown.length)
  return (
    <section className="[&+&]:pt-3">
      <div className={BAND}>
        <span className="truncate text-text">{entry.name}</span>
        <span className="ml-auto flex-none text-[11.5px] text-muted">{verdict(entry)}</span>
      </div>
      <p className="t-mono px-4 pt-2 pb-1 text-[10.5px] leading-[1.2] text-dim">
        {entry.kind}
        {entry.namespace ? ` · ${entry.namespace}` : ''}
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
  const items = q.data?.items
  const entries = useMemo(() => (items ?? []).map(entryOf), [items])
  const drifted = entries.filter(differs)
  const same = entries.filter((e) => !differs(e))

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
          {/* The legend, once, in words: the whole reason this does not need
              a colour. */}
          <p className="t-mono mt-2 flex items-center text-[11px] text-dim">
            <b className="font-normal">-</b>
            <span className="ml-1.5">in the cluster</span>
            <i className="sep" aria-hidden="true" />
            <b className="font-normal">+</b>
            <span className="ml-1.5">in Git{revision ? ` at ${revision.slice(0, 7)}` : ''}</span>
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
