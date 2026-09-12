import { expect, test } from 'vitest'
import { isStale, shouldReload } from './update'

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

test('a stale version with no prior reload should reload', () => {
  expect(shouldReload('1.4.0', '1.3.0', null)).toBe(true)
})

test('a version already reloaded for does not reload again', () => {
  expect(shouldReload('1.4.0', '1.3.0', '1.4.0')).toBe(false)
})

test('a newer version after a previous reload reloads again', () => {
  expect(shouldReload('1.5.0', '1.3.0', '1.4.0')).toBe(true)
})

test('a non-stale version never reloads regardless of history', () => {
  expect(shouldReload('1.4.0', '1.4.0', '1.3.0')).toBe(false)
})
