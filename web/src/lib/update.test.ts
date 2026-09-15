import { afterEach, expect, test, vi } from 'vitest'
import { RELOAD_KEY, checkVersion, isStale, shouldReload } from './update'

/** A minimal in-memory stand-in for sessionStorage, so tests don't depend on
 * a DOM environment. */
function fakeStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

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

test('a throwing getItem skips the offer entirely', () => {
  vi.stubGlobal('sessionStorage', {
    getItem: () => {
      throw new Error('storage blocked')
    },
    setItem: vi.fn(),
  })
  const onAvailable = vi.fn()
  checkVersion('1.4.0', '1.3.0', onAvailable)
  expect(onAvailable).not.toHaveBeenCalled()
})

test('a throwing setItem is offered, but applying it does not reload', () => {
  vi.stubGlobal('sessionStorage', {
    getItem: () => null,
    setItem: () => {
      throw new Error('storage blocked')
    },
  })
  const reload = vi.fn()
  vi.stubGlobal('window', { location: { reload } })
  const onAvailable = vi.fn()

  checkVersion('1.4.0', '1.3.0', onAvailable)
  expect(onAvailable).toHaveBeenCalledTimes(1)

  const apply = onAvailable.mock.calls[0][0] as () => void
  apply()
  expect(reload).not.toHaveBeenCalled()
})

test('applying a genuine reload records the version at apply time, not offer time', () => {
  const storage = fakeStorage()
  vi.stubGlobal('sessionStorage', storage)
  const reload = vi.fn()
  vi.stubGlobal('window', { location: { reload } })
  const onAvailable = vi.fn()

  checkVersion('1.4.0', '1.3.0', onAvailable)
  expect(storage.getItem(RELOAD_KEY)).toBeNull() // merely offering records nothing yet
  expect(reload).not.toHaveBeenCalled()

  const apply = onAvailable.mock.calls[0][0] as () => void
  apply()
  expect(storage.getItem(RELOAD_KEY)).toBe('1.4.0')
  expect(reload).toHaveBeenCalledTimes(1)
})

test('re-offering the same version after it was applied is harmless', () => {
  const storage = fakeStorage()
  vi.stubGlobal('sessionStorage', storage)
  vi.stubGlobal('window', { location: { reload: vi.fn() } })

  const firstOffer = vi.fn()
  checkVersion('1.4.0', '1.3.0', firstOffer)
  ;(firstOffer.mock.calls[0][0] as () => void)()

  const secondOffer = vi.fn()
  checkVersion('1.4.0', '1.3.0', secondOffer)
  expect(secondOffer).not.toHaveBeenCalled()
})

test('apply uses the supplied reload, after recording the version', () => {
  const storage = fakeStorage()
  vi.stubGlobal('sessionStorage', storage)
  const windowReload = vi.fn()
  vi.stubGlobal('window', { location: { reload: windowReload } })
  const handoff = vi.fn(() => {
    expect(storage.getItem(RELOAD_KEY)).toBe('1.4.0')
  })
  const onAvailable = vi.fn()

  checkVersion('1.4.0', '1.3.0', onAvailable, handoff)
  ;(onAvailable.mock.calls[0][0] as () => void)()

  expect(handoff).toHaveBeenCalledTimes(1)
  expect(windowReload).not.toHaveBeenCalled()
})
