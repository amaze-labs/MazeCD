import { describe, expect, test } from 'vitest'
import { fold } from './DiffSheet'
import type { Change } from '../lib/diff'

const changes = (n: number): Change[] =>
  Array.from({ length: n }, (_, i) => ({ path: `spec.f${i}`, from: 'a', to: 'b' }))

/**
 * The fold exists to stop one resource burying the five under it. What was
 * wrong with it was the bottom end: seven changes used to hide exactly one
 * line behind a summary row, a chevron and a tap, which costs more than the
 * line it saved.
 */
describe('fold', () => {
  test('a list that fits a screen is not folded at all', () => {
    const c = changes(6)
    expect(fold(c)).toEqual({ shown: c, rest: [] })
  })

  test('a list barely over a screen is shown whole rather than folded by one', () => {
    for (const n of [7, 8, 9]) expect(fold(changes(n)).rest).toEqual([])
  })

  test('a genuinely long list is cut back to one screenful', () => {
    const { shown, rest } = fold(changes(40))
    expect(shown).toHaveLength(6)
    expect(rest).toHaveLength(34)
    expect([...shown, ...rest]).toEqual(changes(40))
  })

  test('nothing is ever dropped', () => {
    for (const n of [0, 1, 9, 10, 41]) {
      const { shown, rest } = fold(changes(n))
      expect(shown.length + rest.length).toBe(n)
    }
  })
})
