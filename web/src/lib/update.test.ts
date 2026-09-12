import { expect, test } from 'vitest'
import { isStale } from './update'

test('a different server version means this bundle is stale', () => {
  expect(isStale('1.4.0', '1.3.0')).toBe(true)
})

test('the same version is not stale', () => {
  expect(isStale('1.4.0', '1.4.0')).toBe(false)
})

test('unknown versions never trigger a reload loop', () => {
  expect(isStale('', '1.4.0')).toBe(false)
  expect(isStale('1.4.0', 'dev')).toBe(false)
  expect(isStale('dev', 'dev')).toBe(false)
})
