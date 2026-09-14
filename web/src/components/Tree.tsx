import { useMemo } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ResourceNode } from '../api/types'
import { healthLoud } from '../lib/fleet'
import { stateStyle } from '../lib/status'
import { KindIcon, tint } from './ui'

type TreeNode = ResourceNode & { children: TreeNode[] }

/** ArgoCD returns a flat node list with parentRefs; rebuild the hierarchy. */
function build(nodes: ResourceNode[]): TreeNode[] {
  const key = (n: { group?: string; kind: string; name: string; namespace: string }) =>
    `${n.group ?? ''}/${n.kind}/${n.namespace}/${n.name}`
  const byKey = new Map<string, TreeNode>()
  for (const n of nodes) byKey.set(key(n), { ...n, children: [] })
  const roots: TreeNode[] = []
  for (const n of byKey.values()) {
    const parent = n.parentRefs?.length ? byKey.get(key(n.parentRefs[0])) : undefined
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

/**
 * Nesting is drawn as vertical rules, one per ancestor, rather than paid for
 * in blank padding: a CronJob → Job → Pod chain stays legible three deep and
 * the name still owns the rest of the width.
 *
 * Each row leads with its kind's glyph, tinted by the resource's own health,
 * so the shape of the tree is read before a single word of it. One line per
 * resource: the kind moved onto the name's line as a small muted word, which
 * halved every row and put the whole of a nine-resource tree on one screen.
 *
 * A troubled resource is marked with its status icon alone, not a worded
 * badge. The row is already tinted and its glyph already carries the colour;
 * a second `Degraded` in words was stealing thirty characters from pod names
 * that are the reason anyone opened this screen.
 */
export function Tree({
  nodes,
  onSelect,
}: {
  nodes: ResourceNode[]
  onSelect: (n: ResourceNode) => void
}) {
  const roots = useMemo(() => build(nodes), [nodes])

  const render = (n: TreeNode, depth: number) => {
    const health = n.health?.status ?? ''
    const loud = health !== '' && healthLoud(health)
    const s = stateStyle(loud ? health : 'Healthy')
    const StatusIcon = s.icon
    return (
      <div key={`${n.group ?? ''}/${n.kind}/${n.namespace}/${n.name}`}>
        <div className="flex items-stretch pl-4">
          {Array.from({ length: depth }, (_, i) => (
            <span key={i} className="w-3.5 shrink-0 border-l border-rule" />
          ))}
          <button
            onClick={() => onSelect(n)}
            className={`my-px flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-card px-2 text-left ${
              loud
                ? 'bg-surface-degraded ring-1 ring-degraded/25'
                : 'bg-panel active:bg-raised'
            }`}
          >
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-control"
              style={{
                background: tint(loud ? s.color : 'var(--color-muted)', loud ? 20 : 12),
                color: loud ? s.color : 'var(--color-muted)',
              }}
              aria-hidden="true"
            >
              <KindIcon kind={n.kind} size={15} />
            </span>
            <span className="min-w-0 flex-1 truncate">
              <span className="t-name text-[14px]">{n.name}</span>
              <span className="ml-1.5 text-[11px] text-muted">{n.kind}</span>
            </span>
            {loud && (
              <span className="shrink-0" style={{ color: s.color }}>
                <span className="sr-only">{s.label}</span>
                <StatusIcon size={16} strokeWidth={2.4} aria-hidden="true" />
              </span>
            )}
            <ChevronRight size={15} className="shrink-0 text-muted" aria-hidden="true" />
          </button>
        </div>
        {n.children.map((c) => render(c, depth + 1))}
      </div>
    )
  }

  if (nodes.length === 0) {
    return (
      <p className="px-8 py-12 text-center text-[15px] leading-relaxed text-muted">
        ArgoCD reports no resources for this application. If it was just created, it has not been
        synced yet.
      </p>
    )
  }
  return <div className="pt-1 pr-4 pb-2">{roots.map((n) => render(n, 0))}</div>
}

// Exported so the pure tree-building logic can be unit tested directly.
export { build }
