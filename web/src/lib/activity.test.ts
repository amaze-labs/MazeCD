import { describe, expect, test } from 'vitest'
import { byDay, dayLabel, toEntries } from './activity'
import type { App } from '../api/types'

const app = (name: string, extra: Partial<App>): App => ({
  instance: 'home',
  name,
  namespace: 'argocd',
  project: 'p',
  destServer: '',
  destNamespace: name,
  health: 'Healthy',
  sync: 'Synced',
  revision: 'abc',
  autoSync: true,
  ...extra,
})

describe('toEntries', () => {
  test('newest first, a running one placed by when it started, and no operation means no entry', () => {
    const e = toEntries([
      app('old', { operationPhase: 'Succeeded', operationFinishedAt: '2026-11-10T10:00:00Z' }),
      app('never', {}),
      app('now', { operationPhase: 'Running', operationStartedAt: '2026-11-14T09:41:00Z' }),
      app('failed', { operationPhase: 'Failed', operationFinishedAt: '2026-11-13T18:44:00Z', operationInitiator: 'admin' }),
      app('auto', { operationPhase: 'Succeeded', operationFinishedAt: '2026-11-14T08:00:00Z', operationInitiator: 'automated' }),
    ])
    expect(e.map((x) => x.app.name)).toEqual(['now', 'auto', 'failed', 'old'])
    expect(e[0]).toMatchObject({ running: true, failed: false })
    expect(e[1]).toMatchObject({ automated: true })
    expect(e[2]).toMatchObject({ failed: true, automated: false })
  })

  test('a running operation with no start time is left out rather than placed at now', () => {
    expect(toEntries([app('x', { operationPhase: 'Running' })])).toEqual([])
  })
})

describe('dayLabel', () => {
  const now = new Date(2026, 10, 14, 12, 0).getTime()
  test('today, yesterday, a weekday within the week, then a date', () => {
    expect(dayLabel(new Date(2026, 10, 14, 0, 5).getTime(), now).title).toBe('Today')
    expect(dayLabel(new Date(2026, 10, 13, 23, 59).getTime(), now).title).toBe('Yesterday')
    expect(dayLabel(new Date(2026, 10, 12, 9, 0).getTime(), now).title).toBe('Thursday')
    expect(dayLabel(new Date(2026, 9, 2, 9, 0).getTime(), now).title).toBe('2 October')
  })

  test('byDay keeps the order and starts a group at each new day', () => {
    const e = toEntries([
      app('a', { operationFinishedAt: new Date(2026, 10, 14, 9).toISOString() }),
      app('b', { operationFinishedAt: new Date(2026, 10, 14, 8).toISOString() }),
      app('c', { operationFinishedAt: new Date(2026, 10, 13, 8).toISOString() }),
    ])
    expect(byDay(e, now).map((g) => [g.label.title, g.entries.length])).toEqual([
      ['Today', 2],
      ['Yesterday', 1],
    ])
  })
})
