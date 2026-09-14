import type { ResourceDiff } from '../api/types'

/**
 * WHAT A DIFF IS, ON A PHONE.
 *
 * `OutOfSync` is the one state the rest of MazeCD cannot answer, and the
 * answer is almost never a document. It is one line: an image tag moved, a
 * replica count changed, a label appeared. A unified diff of six Kubernetes
 * objects is two hundred lines of context around those three, and at 390px
 * the context is all you can see.
 *
 * So this does not produce a text diff. It walks both objects to their leaves
 * and returns the leaves that disagree — `spec.replicas`, `2`, `3` — which is
 * the same information a unified diff carries, minus the hundreds of lines
 * that are identical on both sides and minus any need to scroll sideways.
 *
 * WHICH TWO SIDES. Not `liveState` and `targetState`, which is the obvious
 * pair and the wrong one: a live object from a real cluster carries
 * `resourceVersion`, `uid`, `creationTimestamp`, a `status` block and
 * whatever the last admission webhook wrote, none of it in Git, all of it
 * reported as a difference. ArgoCD already solved this — `normalizedLiveState`
 * is the live object after its normalizers, `predictedLiveState` what the live
 * object *would become*, so everything the server populates appears on both
 * sides and cancels. That pair is what ArgoCD's own diff view reads, and it is
 * what this reads, falling back to the raw pair when an instance sends no
 * normalized states at all.
 */

/** A side that does not exist. ArgoCD marshals the missing object with
 * encoding/json, so the wire value is the four characters of a JSON null —
 * not an empty string and not an absent field. */
const ABSENT = 'null'

export type Presence = 'both' | 'git-only' | 'cluster-only'

/** One leaf that disagrees. `from` is the cluster, `to` is Git; either is
 * absent when the leaf exists on only one side. */
export type Change = { path: string; from?: string; to?: string }

export type Entry = {
  key: string
  name: string
  /** `apps/Deployment`, or a bare `ConfigMap` for core — the same qualified
   * kind the resource list names a group by. */
  kind: string
  namespace: string
  presence: Presence
  changes: Change[]
  /** ArgoCD's own verdict. Kept because it can disagree with ours: it is
   * computed from the raw pair, so a difference that normalization removes —
   * or one that is only a reordering — shows up here and in no leaf. A
   * resource nobody can name a change in is still a resource ArgoCD will act
   * on, and saying "identical" about it would be a lie. */
  modified: boolean
}

function parse(state: string | undefined): unknown {
  if (!state || state === ABSENT) return null
  try {
    return JSON.parse(state)
  } catch {
    return null
  }
}

/**
 * Every leaf of an object, by dotted path. Arrays are indexed, so
 * `spec.template.spec.containers.0.image` is the path that carries the image
 * tag — long, but it is the only honest name for that field.
 *
 * An empty object or array is itself a leaf: a map that Git emptied is a
 * change, and a diff that walked into it and found nothing would report none.
 *
 * Values are rendered rather than quoted. A string keeps its own characters,
 * so an image tag is `registry/app:1.4.2` and not `"registry/app:1.4.2"` —
 * which does mean the string `"3"` and the number `3` print the same. That
 * distinction matters in Kubernetes about once a year; quotation marks on
 * every value on the screen matter every time.
 */
function leaves(value: unknown, prefix = '', out = new Map<string, string>()): Map<string, string> {
  if (value === null || typeof value !== 'object') {
    out.set(prefix, typeof value === 'string' ? value : String(value))
    return out
  }
  const entries: [string, unknown][] = Array.isArray(value)
    ? value.map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) {
    out.set(prefix, Array.isArray(value) ? '[]' : '{}')
    return out
  }
  for (const [k, v] of entries) leaves(v, prefix ? `${prefix}.${k}` : k, out)
  return out
}

/** The qualified kind, exactly as the resource list names a group by. */
export const qualified = (d: { group?: string; kind: string }) =>
  d.group ? `${d.group}/${d.kind}` : d.kind

/**
 * One managed resource, read as a difference.
 *
 * The change list is built in the *target's* own key order — apiVersion,
 * kind, metadata, spec, the order a manifest is written in — with leaves that
 * only the cluster has appended after. No sort: a manifest's own order is
 * more readable than an alphabetical one, and it is free.
 */
export function entryOf(d: ResourceDiff): Entry {
  const live = parse(d.normalizedLiveState ?? d.liveState)
  const target = parse(d.predictedLiveState ?? d.targetState)
  const presence: Presence =
    d.liveState === ABSENT ? 'git-only' : d.targetState === ABSENT ? 'cluster-only' : 'both'

  // A side that does not exist contributes no leaves at all. Walking `null`
  // would otherwise record one leaf at the empty path — a phantom change on
  // every resource that is only in Git or only in the cluster.
  const from = live === null ? new Map<string, string>() : leaves(live)
  const to = target === null ? new Map<string, string>() : leaves(target)
  const changes: Change[] = []
  for (const [path, value] of to) {
    if (from.get(path) !== value) changes.push({ path, from: from.get(path), to: value })
  }
  for (const [path, value] of from) {
    if (!to.has(path)) changes.push({ path, from: value })
  }

  return {
    key: `${d.group ?? ''}/${d.kind}/${d.namespace}/${d.name}`,
    name: d.name,
    kind: qualified(d),
    namespace: d.namespace,
    presence,
    changes,
    modified: d.modified === true || presence !== 'both',
  }
}

/** Differs, for the purposes of the two lists the sheet draws. A resource
 * ArgoCD calls modified is in the first list even when no leaf of it changed,
 * because ArgoCD is the one that will act on it. */
export const differs = (e: Entry) => e.modified || e.changes.length > 0

/**
 * The one sentence at the top: how much of this application is drifted. It is
 * the answer the list has been asking for on every yellow row, so it is said
 * in words before anything is rendered, and it is said even when the answer
 * is none.
 */
export function headline(entries: Entry[]): string {
  const bad = entries.filter(differs).length
  const n = entries.length
  const res = (k: number) => `${k} resource${k === 1 ? '' : 's'}`
  if (n === 0) return 'ArgoCD reports no managed resources for this application.'
  if (bad === 0) return `All ${res(n)} match what Git asks for.`
  return `${bad} of ${res(n)} ${bad === 1 ? 'differs' : 'differ'} from Git.`
}

/** A leaf's path, split for display: everything up to the last segment is
 * scenery, the last segment is the field. `…containers.0.` then `image`. */
export function splitPath(path: string): [string, string] {
  const i = path.lastIndexOf('.')
  return i < 0 ? ['', path] : [path.slice(0, i + 1), path.slice(i + 1)]
}
