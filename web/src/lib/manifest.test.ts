import { describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import { prettyManifest, toYaml } from './manifest'

describe('prettyManifest', () => {
  test('one line of JSON comes back as YAML', () => {
    const out = prettyManifest('{"apiVersion":"apps/v1","kind":"ReplicaSet","metadata":{"name":"x"}}')
    expect(out).toBe('apiVersion: apps/v1\nkind: ReplicaSet\nmetadata:\n  name: x\n')
  })

  test('managedFields is dropped, the rest of metadata is kept', () => {
    const out = prettyManifest(
      JSON.stringify({ metadata: { name: 'x', labels: { a: 'b' }, managedFields: [{ manager: 'k' }] } }),
    )
    expect(parse(out)).toEqual({ metadata: { name: 'x', labels: { a: 'b' } } })
  })

  test('text that does not parse is returned as it came', () => {
    expect(prettyManifest('not json')).toBe('not json')
  })

  test('nothing in, empty out', () => {
    expect(prettyManifest(undefined)).toBe('')
    expect(prettyManifest('')).toBe('')
  })
})

describe('toYaml', () => {
  test('strings that YAML 1.1 would read as something else stay strings', () => {
    const o = { port: '8080', mode: '0755', a: 'yes', b: 'on', c: 'no', d: '', e: '~', f: 'x: y' }
    const out = toYaml(o)
    expect(parse(out, { version: '1.1' })).toEqual(o)
  })

  test('a long string is not folded onto a second line', () => {
    const long = 'a'.repeat(200) + ' b'
    expect(toYaml({ s: long })).toBe(`s: ${long}\n`)
  })

  test('a multi-line string round-trips', () => {
    const o = { script: 'line1\nline2\n' }
    expect(parse(toYaml(o), { version: '1.1' })).toEqual(o)
  })
})
