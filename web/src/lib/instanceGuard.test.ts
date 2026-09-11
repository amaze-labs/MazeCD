import { describe, expect, test } from 'vitest'
import { isProductionGuard } from './instanceGuard'
import type { InstanceInfo } from '../api/types'

const instance = (name: string, production: boolean): InstanceInfo => ({
  name,
  production,
  color: '#000',
  url: 'https://argocd.internal',
  reachable: true,
  tokenValid: true,
})

describe('isProductionGuard', () => {
  test('treats the instance as production while the instances query has not resolved', () => {
    expect(isProductionGuard(undefined, 'prod')).toBe(true)
  })

  test('reflects the matching instance once resolved: production stays guarded', () => {
    expect(isProductionGuard([instance('prod', true), instance('dev', false)], 'prod')).toBe(true)
  })

  test('reflects the matching instance once resolved: non-production is not guarded', () => {
    expect(isProductionGuard([instance('prod', true), instance('dev', false)], 'dev')).toBe(false)
  })

  test('an unknown instance name is treated as production even once resolved', () => {
    expect(isProductionGuard([instance('prod', true), instance('dev', false)], 'typo')).toBe(true)
  })

  test('an empty resolved list is treated as production', () => {
    expect(isProductionGuard([], 'anything')).toBe(true)
  })
})
