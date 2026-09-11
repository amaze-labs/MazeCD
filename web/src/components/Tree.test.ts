import { describe, expect, test } from 'vitest'
import { build } from './Tree'
import type { ResourceNode } from '../api/types'

const node = (kind: string, name: string, parent?: { kind: string; name: string }): ResourceNode => ({
  group: 'apps',
  kind,
  name,
  namespace: 'ns',
  version: 'v1',
  parentRefs: parent
    ? [{ group: 'apps', kind: parent.kind, name: parent.name, namespace: 'ns' }]
    : undefined,
})

describe('build', () => {
  test('reconstructs a parent/child hierarchy from a flat list, sorted by kind then name', () => {
    const flat: ResourceNode[] = [
      node('Pod', 'web-2', { kind: 'ReplicaSet', name: 'web-rs' }),
      node('ReplicaSet', 'web-rs', { kind: 'Deployment', name: 'web' }),
      node('Deployment', 'web'),
      node('Pod', 'web-1', { kind: 'ReplicaSet', name: 'web-rs' }),
      node('Service', 'web-svc'),
    ]

    const roots = build(flat)

    // Two roots: Deployment and Service, sorted by kind then name.
    expect(roots.map((r) => r.name)).toEqual(['web', 'web-svc'])

    const deployment = roots[0]
    expect(deployment.children.map((c) => c.name)).toEqual(['web-rs'])

    const rs = deployment.children[0]
    expect(rs.children.map((c) => c.name)).toEqual(['web-1', 'web-2'])
  })

  test('a node whose declared parent is missing from the list becomes a root instead of vanishing', () => {
    const flat: ResourceNode[] = [
      node('Pod', 'orphan', { kind: 'ReplicaSet', name: 'gone-rs' }),
      node('Deployment', 'web'),
    ]

    const roots = build(flat)

    expect(roots.map((r) => r.name).sort()).toEqual(['orphan', 'web'])
  })

  test('an empty list produces no roots', () => {
    expect(build([])).toEqual([])
  })
})
