import { describe, expect, test } from 'vitest'
import { confirmReason } from './ResourceSheet'
import type { InstanceInfo } from '../api/types'

const inst = (name: string, production: boolean): InstanceInfo => ({
  name,
  production,
  color: '#fff',
  url: `https://${name}.internal`,
  reachable: true,
  tokenValid: true,
})

const fleet = [inst('home', false), inst('orders', true)]

describe('confirmReason', () => {
  test('an instance that is not production runs on the tap', () => {
    expect(confirmReason(fleet, 'home')).toBe(null)
  })

  test('an instance marked production confirms, and says so', () => {
    expect(confirmReason(fleet, 'orders')).toBe('production')
  })

  // The failure mode the guardrail exists to avoid: an earlier production
  // check defaulted to false while the instance list was loading, so it
  // protected nothing exactly when the data had not arrived.
  test('confirms while the instance list is still loading', () => {
    expect(confirmReason(undefined, 'orders')).toBe('unknown')
  })

  test('confirms when the fetch failed and left an empty fleet', () => {
    expect(confirmReason([], 'orders')).toBe('unknown')
  })

  test('confirms for an instance the list does not name', () => {
    expect(confirmReason(fleet, 'utility')).toBe('unknown')
  })
})
