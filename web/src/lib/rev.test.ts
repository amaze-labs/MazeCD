import { describe, expect, test } from 'vitest'
import { shortRev } from './rev'

describe('shortRev', () => {
  test('a resolved sha is shortened to seven', () => {
    expect(shortRev('29f1b6c4e9a7d2f0b5c8e1a3d6f9b2c5e8a1d4f7')).toBe('29f1b6c')
  })

  test('a chart version or tag survives whole', () => {
    expect(shortRev('v1.2.3-hotfix')).toBe('v1.2.3-hotfix')
    expect(shortRev('main')).toBe('main')
  })

  test('nothing in, nothing out', () => {
    expect(shortRev(undefined)).toBeUndefined()
    expect(shortRev('')).toBe('')
  })
})
