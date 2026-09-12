import { describe, expect, test } from 'vitest'
import { bucketOf, countBy, healthLoud, syncLoud, surfaceOf, type Bucket } from './fleet'
import type { App, Health, SyncStatus } from '../api/types'

const HEALTHS: Health[] = ['Healthy', 'Progressing', 'Degraded', 'Suspended', 'Missing', 'Unknown', '']
const SYNCS: SyncStatus[] = ['Synced', 'OutOfSync', 'Unknown', '']

const app = (health: Health, sync: SyncStatus): App => ({
  instance: 'home',
  name: 'inventory-db',
  namespace: 'argocd',
  project: 'default',
  destServer: '',
  destNamespace: 'inventory-web',
  health,
  sync,
  revision: 'a8f3acc1234567',
})

describe('bucketOf', () => {
  test('a row draws a loud gutter segment only when the fleet bar counts it as something other than healthy', () => {
    // This is the whole contract between the summary and the rows beneath
    // it: if either predicate is loud, the app must not land in Healthy.
    for (const health of HEALTHS) {
      for (const sync of SYNCS) {
        const resting = bucketOf({ health, sync }) === 'Healthy'
        expect({ health, sync, resting }).toEqual({
          health,
          sync,
          resting: !healthLoud(health) && !syncLoud(sync),
        })
      }
    }
  })

  test('suspended and unknown are their own buckets, not folded into healthy', () => {
    expect(bucketOf({ health: 'Suspended', sync: 'Synced' })).toBe('Suspended')
    expect(bucketOf({ health: 'Unknown', sync: 'Synced' })).toBe('Unknown')
    expect(bucketOf({ health: '', sync: 'Synced' })).toBe('Unknown')
    expect(bucketOf({ health: 'Healthy', sync: 'Synced' })).toBe('Healthy')
  })

  test('the loudest state wins: broken beats out of sync beats in flight', () => {
    expect(bucketOf({ health: 'Degraded', sync: 'OutOfSync' })).toBe('Degraded')
    expect(bucketOf({ health: 'Missing', sync: 'OutOfSync' })).toBe('Degraded')
    expect(bucketOf({ health: 'Progressing', sync: 'OutOfSync' })).toBe('OutOfSync')
    expect(bucketOf({ health: 'Progressing', sync: 'Synced' })).toBe('Progressing')
  })
})

describe('countBy', () => {
  test('the segments sum to the fleet, whatever ArgoCD reports', () => {
    const fleet = HEALTHS.flatMap((h) => SYNCS.map((s) => app(h, s)))
    const counts = countBy(fleet)
    const total = Object.values(counts).reduce((n, c) => n + c, 0)
    expect(total).toBe(fleet.length)
  })
})

describe('surfaceOf', () => {
  test('only the two buckets that need acting on take a tinted surface', () => {
    const tinted = (['Degraded', 'OutOfSync', 'Progressing', 'Suspended', 'Unknown', 'Healthy'] as Bucket[])
      .filter((b) => surfaceOf(b).includes('bg-surface-'))
    expect(tinted).toEqual(['Degraded', 'OutOfSync'])
  })
})
