import { describe, expect, test } from 'vitest'
import { ago } from './ago'

const NOW = Date.parse('2026-09-14T12:00:00Z')
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString()

describe('ago', () => {
  test('picks the largest unit that has a whole number in it', () => {
    expect(ago(minutesAgo(0.4), NOW)?.short).toBe('now')
    expect(ago(minutesAgo(1), NOW)?.short).toBe('1m')
    expect(ago(minutesAgo(59), NOW)?.short).toBe('59m')
    expect(ago(minutesAgo(60), NOW)?.short).toBe('1h')
    expect(ago(minutesAgo(60 * 24 - 1), NOW)?.short).toBe('23h')
    expect(ago(minutesAgo(60 * 24), NOW)?.short).toBe('1d')
    expect(ago(minutesAgo(60 * 24 * 412), NOW)?.short).toBe('412d')
  })

  test('the long form is a sentence, and counts one thing singular', () => {
    expect(ago(minutesAgo(1), NOW)?.long).toBe('1 minute ago')
    expect(ago(minutesAgo(2), NOW)?.long).toBe('2 minutes ago')
    expect(ago(minutesAgo(0), NOW)?.long).toBe('less than a minute ago')
  })

  test("an instance whose clock runs ahead reads as now, never as negative", () => {
    expect(ago(minutesAgo(-90), NOW)?.short).toBe('now')
  })

  test('absent or unparseable is null, so the row can draw unknown', () => {
    expect(ago(undefined, NOW)).toBeNull()
    expect(ago('', NOW)).toBeNull()
    expect(ago('not a date', NOW)).toBeNull()
  })
})
