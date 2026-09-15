import { useMemo } from 'react'
import { ChevronRight, Heart, PackageOpen } from 'lucide-react'
import type { ResourceNode, SyncStatus } from '../api/types'
import { healthLoud } from '../lib/fleet'
import { stateStyle } from '../lib/status'
import { EmptyState, ResourceMarks } from './ui'

type TreeNode = ResourceNode & { children: TreeNode[] }

/** The key both views and the sync lookup agree on. */
export const refKey = (n: { group?: string; kind: string; name: string; namespace: string }) =>
  `${n.group ?? ''}/${n.kind}/${n.namespace}/${n.name}`

/** ArgoCD returns a flat node list with parentRefs; rebuild the hierarchy. */
function build(nodes: ResourceNode[]): TreeNode[] {
  const byKey = new Map<string, TreeNode>()
  for (const n of nodes) byKey.set(refKey(n), { ...n, children: [] })
  const roots: TreeNode[] = []
  for (const n of byKey.values()) {
    const parent = n.parentRefs?.length ? byKey.get(refKey(n.parentRefs[0])) : undefined
    if (parent) parent.children.push(n)
    else roots.push(n)
  }
  const sort = (list: TreeNode[]) => {
    list.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
    list.forEach((n) => sort(n.children))
  }
  sort(roots)
  return roots
}

/** The fully-qualified kind, which is what a group is named by: `apps/Deployment`,
 * `external-secrets.io/ExternalSecret`, or a bare `ConfigMap` for core. */
export const qualifiedKind = (n: ResourceNode) => (n.group ? `${n.group}/${n.kind}` : n.kind)

export type SyncLookup = (n: ResourceNode) => SyncStatus | undefined

function Empty() {
  return (
    <EmptyState icon={<PackageOpen size={22} strokeWidth={1.6} />} title="No resources">
      ArgoCD reports nothing under this application. If it was only just created, it has not been
      synced yet — nothing is wrong, there is simply nothing there.
    </EmptyState>
  )
}

/**
 * RESOURCES, GROUPED BY KIND — the default, and the reason the tree became a
 * mode you switch into rather than the only way to read this screen. Twelve
 * resources in nine groups read as one continuous texture, and a bracket down
 * the side of each group's members was too quiet to fix it.
 *
 * A GROUP IS A BAND AND EVERYTHING UNDER IT. The kind sits on a strip of
 * raised ground running edge to edge, with its count hard right, and the
 * group is that band plus every member beneath it until the next band.
 * Nothing else parts them: no rule between groups, because the band's own
 * edge already says it and a line would say it twice; no vertical guide,
 * because the band makes belonging a matter of position rather than of
 * connection. The only hairline left inside the block is the one between two
 * members, inset to 16px so it cannot be mistaken for a band edge. Air goes
 * ABOVE each band and none below it, so the band reads as the top of its
 * block rather than as a divider floating between equal gaps.
 *
 * ONE LEFT EDGE. With the bracket gone the members do not indent: the band's
 * label and every name under it start at the same 16px as the application
 * name, the table labels and the list rows.
 *
 * The two marks in the right column are the other half of the rail's
 * language. A resource has health and sync but no auto-sync of its own, so it
 * gets no rail — a rail there would be half a mark pretending to be a whole
 * one — and instead gets a heart and a circled check, grey when ordinary,
 * coloured when not, and a dim `?` where ArgoCD did not report that state at
 * all. Most of a tree is `?` for sync: only the application's own managed
 * resources carry one, and a Pod three levels down is not one of them.
 */
export function Groups({
  nodes,
  syncOf,
  onSelect,
}: {
  nodes: ResourceNode[]
  syncOf: SyncLookup
  onSelect: (n: ResourceNode) => void
}) {
  const groups = useMemo(() => {
    const roots = build(nodes)
    const kids = new Map<string, number>()
    const walk = (list: TreeNode[]) => {
      for (const n of list) {
        kids.set(refKey(n), n.children.length)
        walk(n.children)
      }
    }
    walk(roots)

    const by = new Map<string, ResourceNode[]>()
    for (const n of nodes) {
      const k = qualifiedKind(n)
      const list = by.get(k)
      if (list) list.push(n)
      else by.set(k, [n])
    }
    return [...by.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([kind, members]) => ({
        kind,
        members: members.sort((a, b) => a.name.localeCompare(b.name)),
        kids,
      }))
  }, [nodes])

  if (nodes.length === 0) return <Empty />

  return (
    <div>
      {groups.map(({ kind, members, kids }) => (
        <section key={kind} className="[&+&]:pt-3">
          <div className="t-mono flex h-10 items-center bg-band px-4">
            <span className="truncate text-[12px]">{kind}</span>
            <span className="ml-auto pl-3 text-[11.5px] text-muted">{members.length}</span>
          </div>
          <div className="px-4">
            {members.map((n) => {
              const health = n.health?.status
              const bad = !!health && healthLoud(health)
              const children = kids.get(refKey(n)) ?? 0
              return (
                <button
                  key={refKey(n)}
                  onClick={() => onSelect(n)}
                  className="flex min-h-[60px] w-full items-center gap-3 py-2.5 text-left [&+button]:border-t [&+button]:border-rule"
                >
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-[14px] leading-[1.25] font-medium tracking-[-0.005em] ${bad ? 'text-degraded' : ''}`}
                    >
                      {n.name}
                    </span>
                    <span className="t-mono mt-1 block text-[10.5px] leading-[1.2] text-dim">
                      {n.namespace || 'cluster-scoped'}
                    </span>
                  </span>
                  {children > 0 && (
                    <span
                      className="t-mono mr-1 flex flex-none items-center gap-[3px] text-[10.5px] text-muted"
                      title={`${children} resource${children === 1 ? '' : 's'} under this one`}
                    >
                      {children}
                      <ChevronRight size={9} strokeWidth={1.5} aria-hidden="true" />
                    </span>
                  )}
                  <ResourceMarks health={health} sync={syncOf(n)} />
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

/**
 * The same twelve resources as a hierarchy, for the question grouping cannot
 * answer: which Pod belongs to which ReplicaSet. Nesting is drawn as vertical
 * rules, one per ancestor, rather than paid for in blank padding, so a
 * CronJob → Job → Pod chain stays legible three deep and the name still owns
 * the width.
 *
 * One mark per row, at the head: a heart in the resource's own health. No
 * sync mark here — the kind has taken the right-hand column, and a resource's
 * place in the hierarchy is what this mode is for.
 */
export function Tree({
  nodes,
  onSelect,
}: {
  nodes: ResourceNode[]
  onSelect: (n: ResourceNode) => void
}) {
  const roots = useMemo(() => build(nodes), [nodes])

  const render = (n: TreeNode) => {
    const health = n.health?.status
    const bad = !!health && healthLoud(health)
    return (
      <div key={refKey(n)}>
        <button
          onClick={() => onSelect(n)}
          className="flex h-11 w-full items-center gap-[9px] text-left"
          title={health ? stateStyle(health).label : 'health not reported'}
        >
          <span
            className="flex-none"
            style={{ color: health ? stateStyle(health).color : 'var(--color-suspended)' }}
            aria-hidden="true"
          >
            <Heart size={12} strokeWidth={1.25} />
          </span>
          <span className={`truncate text-[14px] font-medium ${bad ? 'text-degraded' : ''}`}>
            {n.name}
          </span>
          <span className="t-mono ml-auto flex-none pl-3 text-[10.5px] whitespace-nowrap text-dim">
            {n.kind}
          </span>
        </button>
        {n.children.length > 0 && (
          <div className="ml-[5px] border-l border-rule pl-[15px]">
            {n.children.map(render)}
          </div>
        )}
      </div>
    )
  }

  if (nodes.length === 0) return <Empty />
  return <div className="px-4 pt-1.5 pb-2">{roots.map(render)}</div>
}

// Exported so the pure tree-building logic can be unit tested directly.
export { build }
