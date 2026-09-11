import { useMemo } from 'react'
import type { ResourceNode } from '../api/types'
import { healthColor } from '../lib/status'

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

export function Tree({
  nodes,
  onSelect,
}: {
  nodes: ResourceNode[]
  onSelect: (n: ResourceNode) => void
}) {
  const roots = useMemo(() => build(nodes), [nodes])

  const render = (n: TreeNode, depth: number) => (
    <div key={`${n.group ?? ''}/${n.kind}/${n.namespace}/${n.name}`}>
      <button
        onClick={() => onSelect(n)}
        className="flex min-h-11 w-full items-center gap-2 border-b border-border px-4 py-2.5 text-left active:bg-surface-2"
        style={{ paddingLeft: `${1 + depth * 0.9}rem` }}
      >
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: healthColor(n.health?.status ?? '') }}
        />
        <span className="w-28 shrink-0 truncate text-xs text-muted">{n.kind}</span>
        <span className="min-w-0 flex-1 truncate text-sm">{n.name}</span>
      </button>
      {n.children.map((c) => render(c, depth + 1))}
    </div>
  )

  if (nodes.length === 0) {
    return <p className="p-8 text-center text-sm text-muted">No managed resources.</p>
  }
  return <div>{roots.map((n) => render(n, 0))}</div>
}

// Exported so the pure tree-building logic can be unit tested directly.
export { build }
