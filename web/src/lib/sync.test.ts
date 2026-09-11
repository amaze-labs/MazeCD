import { describe, expect, test } from 'vitest'
import { buildSyncRequest, defaultSyncOptions } from './sync'

describe('buildSyncRequest', () => {
  test('a plain sync defaults the revision to HEAD and runs hooks', () => {
    const req = buildSyncRequest(defaultSyncOptions())
    expect(req.revision).toBe('HEAD')
    expect(req.prune).toBe(false)
    expect(req.dryRun).toBe(false)
    expect(req.strategy).toEqual({ hook: { force: false } })
    expect(req.syncOptions).toBeUndefined()
    expect(req.resources).toBeUndefined()
    expect(req.retryStrategy).toBeUndefined()
  })

  test('prune and dryRun map to their own fields', () => {
    const req = buildSyncRequest({ ...defaultSyncOptions(), prune: true, dryRun: true })
    expect(req.prune).toBe(true)
    expect(req.dryRun).toBe(true)
  })

  test('force lands inside the selected strategy, not at the top level', () => {
    const withHooks = buildSyncRequest({ ...defaultSyncOptions(), force: true })
    expect(withHooks.strategy).toEqual({ hook: { force: true } })
    expect('force' in withHooks).toBe(false)

    const skipping = buildSyncRequest({ ...defaultSyncOptions(), force: true, skipHooks: true })
    expect(skipping.strategy).toEqual({ apply: { force: true } })
  })

  test('replace is a syncOptions item, not a boolean', () => {
    const req = buildSyncRequest({ ...defaultSyncOptions(), replace: true })
    expect(req.syncOptions).toEqual({ items: ['Replace=true'] })
  })

  test('selected resources are sent as references', () => {
    const req = buildSyncRequest({
      ...defaultSyncOptions(),
      resources: [{ group: 'apps', kind: 'Deployment', name: 'web', namespace: 'web-prod' }],
    })
    expect(req.resources).toEqual([
      { group: 'apps', kind: 'Deployment', name: 'web', namespace: 'web-prod' },
    ])
  })

  test('an explicit revision is preserved', () => {
    const req = buildSyncRequest({ ...defaultSyncOptions(), revision: 'v1.4.2' })
    expect(req.revision).toBe('v1.4.2')
  })

  test('retry adds a bounded backoff strategy', () => {
    const req = buildSyncRequest({ ...defaultSyncOptions(), retry: true })
    expect(req.retryStrategy).toEqual({
      limit: 2,
      backoff: { duration: '5s', factor: 2, maxDuration: '3m' },
    })
  })
})
