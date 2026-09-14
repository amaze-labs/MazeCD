import { describe, expect, test } from 'vitest'
import { resolveTheme } from './theme'

describe('resolveTheme', () => {
  test('"system" is whatever the phone says, and follows it both ways', () => {
    expect(resolveTheme('system', true)).toBe('light')
    expect(resolveTheme('system', false)).toBe('dark')
  })

  test('an explicit choice outranks the phone, including against it', () => {
    expect(resolveTheme('dark', true)).toBe('dark')
    expect(resolveTheme('light', false)).toBe('light')
  })
})
