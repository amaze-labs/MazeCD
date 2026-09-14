import { ChevronRight, FileCode, ServerOff } from 'lucide-react'
import { Sheet } from './Sheet'
import { Button, Callout, EmptyState, Fact } from './ui'
import { SheetListSkeleton } from './Skeleton'
import { useManifests } from '../api/queries'
import { shortRev } from '../lib/rev'

/**
 * DESIRED MANIFESTS — what Git renders, before anything is applied.
 *
 * THERE ARE NOW TWO MANIFEST VIEWS IN THIS APP AND THEY ANSWER OPPOSITE
 * QUESTIONS. The resource sheet's tab reads
 * `applications/{name}/resource?...` — one object, as the *cluster* has it
 * this second, `status` block and all. This reads
 * `applications/{name}/manifests` — every object of the whole application, as
 * the *repository* renders it at a revision, which nothing may ever have
 * applied. One is "what is running", the other is "what is supposed to run".
 *
 * Confusing the two is how an operator concludes a sync worked when it did
 * not, so neither is left to be inferred: this sheet is titled for the
 * desired side and says so in its first sentence, the other's tab was renamed
 * "Live manifest", and the ⋮ entry that opens this one says which it is.
 *
 * EVERYTHING IS FOLDED. Five objects is four hundred lines of YAML and no
 * operator on a phone wants it poured onto the screen: what they want first
 * is the *inventory* — which objects this application is made of — and then
 * one of them. So the list is bands, and a band opens the object under it.
 *
 * The bodies are pretty-printed JSON rather than YAML. Every manifest arrives
 * as a JSON string, and a YAML emitter that gets quoting subtly wrong prints
 * a manifest that is not the manifest — which on this screen is worse than
 * braces.
 */

/** `kind` and `metadata.name` out of one rendered manifest, so a band can
 * name the object without the operator opening it. A manifest that does not
 * parse still gets a band, saying that. */
function describe(raw: string): { kind: string; name: string; body: string } {
  try {
    const o = JSON.parse(raw) as {
      kind?: string
      apiVersion?: string
      metadata?: { name?: string; namespace?: string }
    }
    const group = o.apiVersion?.includes('/') ? o.apiVersion.split('/')[0] : ''
    return {
      kind: group ? `${group}/${o.kind ?? 'object'}` : (o.kind ?? 'object'),
      name: o.metadata?.name ?? '—',
      body: JSON.stringify(o, null, 2),
    }
  } catch {
    return { kind: 'unreadable', name: 'could not be parsed', body: raw }
  }
}

export function ManifestsSheet({
  instance,
  name,
  onClose,
}: {
  instance: string
  name: string
  onClose: () => void
}) {
  const q = useManifests(instance, name)
  const manifests = q.data?.manifests ?? []
  const revision = q.data?.revision
  const shortRevision = shortRev(revision)

  return (
    <Sheet open onClose={onClose} title="Desired manifests" icon={<FileCode size={15} />}>
      {q.isLoading ? (
        <div className="-mx-4">
          <SheetListSkeleton />
        </div>
      ) : q.isError ? (
        <Callout
          icon={<ServerOff size={17} strokeWidth={2} />}
          title="Could not render the manifests"
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
          <p className="text-[13px] leading-snug text-muted">
            What {instance} renders from Git for {name} — the desired state, whether or not the
            cluster has it yet. A resource&rsquo;s own sheet has the live copy.
          </p>
          <dl className="m-0 -mx-4 mt-3 border-y border-rule">
            <Fact label="revision" value={shortRevision} />
            <Fact label="namespace" value={q.data?.namespace} />
            <Fact label="cluster" value={q.data?.server} />
            <Fact label="source" value={q.data?.sourceType} />
          </dl>

          <div className="mt-3.5 -mx-4">
            {manifests.map((raw, i) => {
              const m = describe(raw)
              return (
                <details key={`${m.kind}/${m.name}/${i}`} className="group [&+details]:pt-1.5">
                  <summary className="t-mono flex h-10 cursor-pointer list-none items-center gap-3 bg-band px-4 text-[12px] [&::-webkit-details-marker]:hidden">
                    <span className="truncate">{m.name}</span>
                    <span className="ml-auto flex flex-none items-center gap-2 text-[11.5px] text-muted">
                      {m.kind}
                      <ChevronRight
                        size={11}
                        strokeWidth={1.5}
                        className="transition-transform group-open:rotate-90"
                        aria-hidden="true"
                      />
                    </span>
                  </summary>
                  <pre className="t-mono mx-4 my-2 max-h-[46dvh] overflow-auto rounded-control bg-ink p-3 text-[11px] leading-relaxed text-muted">
                    {m.body}
                  </pre>
                </details>
              )
            })}
            {manifests.length === 0 && (
              <EmptyState icon={<FileCode size={22} strokeWidth={1.6} />} title="Nothing rendered">
                {instance} produced no manifests for this application at this revision. That is
                either an empty path in the repository or a render that failed — the events say
                which.
              </EmptyState>
            )}
          </div>
        </>
      )}
    </Sheet>
  )
}
