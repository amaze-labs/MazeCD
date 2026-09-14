import { describe, expect, test } from 'vitest'
import { differs, entryOf, headline, splitPath } from './diff'
import type { ResourceDiff } from '../api/types'

/** A ResourceDiff the way the wire carries one: the states are JSON strings,
 * and a side that does not exist is the string "null". */
const diff = (target: unknown, live: unknown, extra: Partial<ResourceDiff> = {}): ResourceDiff => {
  const targetState = target === null ? 'null' : JSON.stringify(target)
  const liveState = live === null ? 'null' : JSON.stringify(live)
  return {
    kind: 'Deployment',
    group: 'apps',
    namespace: 'doc-archive',
    name: 'doc-archive',
    targetState,
    liveState,
    normalizedLiveState: liveState,
    predictedLiveState: targetState,
    modified: targetState !== liveState,
    ...extra,
  }
}

const deploy = (tag: string, replicas: number, labels: Record<string, string> = {}) => ({
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: { name: 'doc-archive', labels },
  spec: {
    replicas,
    template: { spec: { containers: [{ name: 'doc-archive', image: `registry/doc:${tag}` }] } },
  },
})

describe('entryOf', () => {
  test('names the leaves that differ and nothing else', () => {
    const e = entryOf(diff(deploy('1.4.2', 3), deploy('1.4.1', 2)))
    expect(e.presence).toBe('both')
    expect(e.changes).toEqual([
      { path: 'spec.replicas', from: '2', to: '3' },
      {
        path: 'spec.template.spec.containers.0.image',
        from: 'registry/doc:1.4.1',
        to: 'registry/doc:1.4.2',
      },
    ])
  })

  test('a leaf only Git has is an addition, one only the cluster has a removal', () => {
    const e = entryOf(diff(deploy('1.4.2', 3, { tier: 'web' }), deploy('1.4.2', 3, { old: 'yes' })))
    expect(e.changes).toEqual([
      { path: 'metadata.labels.tier', from: undefined, to: 'web' },
      { path: 'metadata.labels.old', from: 'yes' },
    ])
  })

  test('an absent side is the string "null", and contributes no phantom leaf', () => {
    const git = entryOf(diff(deploy('1.4.2', 1), null))
    expect(git.presence).toBe('git-only')
    expect(differs(git)).toBe(true)
    expect(git.changes.every((c) => c.path !== '' && c.from === undefined)).toBe(true)

    const cluster = entryOf(diff(null, deploy('1.4.2', 1)))
    expect(cluster.presence).toBe('cluster-only')
    expect(cluster.changes.every((c) => c.path !== '' && c.to === undefined)).toBe(true)
  })

  test('the normalized pair wins over the raw one, so server noise cancels', () => {
    const git = deploy('1.4.2', 3)
    const live = { ...deploy('1.4.2', 3), metadata: { name: 'doc-archive', resourceVersion: '9' } }
    const e = entryOf({
      ...diff(git, live),
      // What ArgoCD's normalizers leave: both sides agree once the noise is gone.
      normalizedLiveState: JSON.stringify(git),
      predictedLiveState: JSON.stringify(git),
    })
    expect(e.changes).toEqual([])
  })

  test('a resource ArgoCD calls modified still differs when no leaf does', () => {
    const same = deploy('1.4.2', 3)
    const e = entryOf({ ...diff(same, same), modified: true })
    expect(e.changes).toEqual([])
    expect(differs(e)).toBe(true)
  })

  test('two identical sides are identical', () => {
    const e = entryOf(diff(deploy('1.4.2', 3), deploy('1.4.2', 3)))
    expect(differs(e)).toBe(false)
    expect(e.kind).toBe('apps/Deployment')
  })

  test('an emptied map is a change, not an absence', () => {
    const e = entryOf(diff({ data: {} }, { data: { LOG_LEVEL: 'info' } }))
    expect(e.changes).toEqual([
      { path: 'data', from: undefined, to: '{}' },
      { path: 'data.LOG_LEVEL', from: 'info' },
    ])
  })
})

describe('headline', () => {
  const same = entryOf(diff(deploy('1', 1), deploy('1', 1)))
  const drift = entryOf(diff(deploy('2', 1), deploy('1', 1)))

  test('counts only what differs', () => {
    expect(headline([same, drift, same])).toBe('1 of 3 resources differs from Git.')
    expect(headline([drift, drift, same])).toBe('2 of 3 resources differ from Git.')
  })

  test('says so honestly when nothing differs at all', () => {
    expect(headline([same, same])).toBe('All 2 resources match what Git asks for.')
    expect(headline([])).toMatch(/no managed resources/)
  })
})

test('splitPath puts the field last and the scenery first', () => {
  expect(splitPath('spec.template.spec.containers.0.image')).toEqual([
    'spec.template.spec.containers.0.',
    'image',
  ])
  expect(splitPath('data')).toEqual(['', 'data'])
})
