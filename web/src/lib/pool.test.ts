import { describe, expect, test } from 'vitest'
import { runLimited } from './pool'

describe('runLimited', () => {
  test('never has more than `limit` calls in flight, and still runs every item', async () => {
    let inFlight = 0
    let peak = 0
    const seen: number[] = []
    const r = await runLimited([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((res) => setTimeout(res, 1))
      seen.push(n)
      inFlight--
    })
    expect(peak).toBe(3)
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(r).toEqual({ ok: 7, failed: 0 })
  })

  test('a failure is counted, not thrown, and does not stop the rest', async () => {
    const r = await runLimited(['a', 'b', 'c'], 2, async (s) => {
      if (s === 'b') throw new Error('nope')
    })
    expect(r).toEqual({ ok: 2, failed: 1 })
  })

  test('an empty list resolves at once', async () => {
    expect(await runLimited([], 4, async () => {})).toEqual({ ok: 0, failed: 0 })
  })
})
