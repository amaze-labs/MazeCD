import { useMemo } from 'react'
import type { ResourceNode } from '../api/types'
import { surfaceOf, bucketOf } from '../lib/fleet'
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

/**
 * Nesting is drawn as vertical rules, one per ancestor, rather than paid for
 * in blank padding: a CronJob → Job → Pod chain stays legible three deep and
 * the name still owns the rest of the width.
 *
 * The kind sits above the name as a small muted label instead of holding a
 * fixed column beside it, because the names are what the eye is hunting for
 * and `inventory-db-f4f8899b6-x2k9v` needs every pixel.
 */
export function Tree({
  nodes,
  onSelect,
  selection = [],
  onToggleSelect,
}: {
  nodes: ResourceNode[]
  onSelect: (n: ResourceNode) => void
  selection?: ResourceNode[]
  onToggleSelect?: (n: ResourceNode) => void
}) {
  const roots = useMemo(() => build(nodes), [nodes])

  const render = (n: TreeNode, depth: number) => {
    const health = n.health?.status ?? ''
    const bucket = bucketOf({ health, sync: '' })
    return (
      <div key={`${n.group ?? ''}/${n.kind}/${n.namespace}/${n.name}`}>
        {/* The checkbox and the open button are siblings, not nested: a
            <button> may not contain interactive content like a checkbox. */}
        <div className="flex items-stretch pl-3">
          {Array.from({ length: depth }, (_, i) => (
            <span key={i} className="w-3.5 shrink-0 border-l border-rule" />
          ))}
          {onToggleSelect && (
            <label className="flex size-11 shrink-0 items-center justify-center">
              <input
                type="checkbox"
                checked={selection.some(
                  (s) => s.kind === n.kind && s.name === n.name && s.namespace === n.namespace,
                )}
                onChange={() => onToggleSelect(n)}
                className="size-5 accent-[#e8eef4]"
                aria-label={`Select ${n.name} for sync`}
              />
            </label>
          )}
          <button
            onClick={() => onSelect(n)}
            className={`relative min-h-11 min-w-0 flex-1 py-2.5 pr-4 pl-2.5 text-left active:brightness-125 ${surfaceOf(bucket)}`}
          >
            {/* A resource has one state, so its gutter has one segment; a
                healthy resource shows none at all. */}
            {health !== 'Healthy' && health !== '' && (
              <span className="gutter" aria-hidden="true">
                {health === 'Progressing' ? (
                  <span className="sweep" />
                ) : (
                  <span style={{ background: healthColor(health) }} />
                )}
              </span>
            )}
            <span className="block text-[11px] leading-[14px] text-muted">{n.kind}</span>
            <span className="t-name block text-[15px]">{n.name}</span>
          </button>
        </div>
        {n.children.map((c) => render(c, depth + 1))}
      </div>
    )
  }

  if (nodes.length === 0) {
    return (
      <p className="px-8 py-12 text-center text-[15px] leading-relaxed text-muted">
        ArgoCD reports no resources for this application. If it was just created, sync it to
        create them.
      </p>
    )
  }
  return <div className="py-1">{roots.map((n) => render(n, 0))}</div>
}

// Exported so the pure tree-building logic can be unit tested directly.
export { build }
