import { describe, expect, test } from 'vitest'
import { pretty } from './DiffTab'

describe('pretty', () => {
  test('objects with keys in a different order compare equal', () => {
    const a = JSON.stringify({ b: 1, a: 2 })
    const b = JSON.stringify({ a: 2, b: 1 })
    expect(pretty(a)).toBe(pretty(b))
  })

  test('arrays whose elements are reordered compare different (array order is meaningful)', () => {
    const a = JSON.stringify({ items: ['x', 'y'] })
    const b = JSON.stringify({ items: ['y', 'x'] })
    expect(pretty(a)).not.toBe(pretty(b))
  })

  test('nested objects canonicalize at every level', () => {
    const a = JSON.stringify({ outer: { z: 1, y: { d: 1, c: 2 } } })
    const b = JSON.stringify({ outer: { y: { c: 2, d: 1 }, z: 1 } })
    expect(pretty(a)).toBe(pretty(b))
  })

  test('a non-JSON string passes through unchanged', () => {
    expect(pretty('not json at all')).toBe('not json at all')
  })

  test('an empty string produces an empty string', () => {
    expect(pretty('')).toBe('')
  })
})
