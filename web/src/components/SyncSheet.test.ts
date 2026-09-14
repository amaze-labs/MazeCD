import { describe, expect, test } from 'vitest'
import { summarize, syncBody, type Flags } from './SyncSheet'

const OFF: Flags = {
  prune: false,
  dryRun: false,
  applyOnly: false,
  force: false,
  policy: 'foreground',
  skipSchemaValidation: false,
  createNamespace: false,
  pruneLast: false,
  applyOutOfSyncOnly: false,
  respectIgnoreDifferences: false,
  serverSideApply: false,
  replace: false,
}

const res = (kind: string, name: string) => ({ group: '', kind, name, namespace: 'ns' })
const all = [res('Deployment', 'web'), res('Service', 'web'), res('ConfigMap', 'web')]

describe('syncBody', () => {
  test('a plain sync of everything names no resources and no options', () => {
    expect(syncBody(OFF, 'main', all, all.length)).toEqual({
      revision: 'main',
      prune: undefined,
      dryRun: undefined,
      strategy: { hook: { force: undefined } },
      resources: undefined,
      syncOptions: undefined,
    })
  })

  test('a partial selection is sent as a resource list', () => {
    const body = syncBody(OFF, 'main', all.slice(0, 2), all.length)
    expect(body.resources).toEqual([
      { group: '', kind: 'Deployment', name: 'web', namespace: 'ns' },
      { group: '', kind: 'Service', name: 'web', namespace: 'ns' },
    ])
  })

  test('every option travels as a Key=value string, and the policy only with prune', () => {
    const on: Flags = {
      ...OFF,
      prune: true,
      policy: 'background',
      skipSchemaValidation: true,
      createNamespace: true,
      pruneLast: true,
      applyOutOfSyncOnly: true,
      respectIgnoreDifferences: true,
      serverSideApply: true,
      replace: true,
    }
    expect(syncBody(on, 'HEAD', all, all.length).syncOptions?.items).toEqual([
      'Validate=false',
      'CreateNamespace=true',
      'PruneLast=true',
      'ApplyOutOfSyncOnly=true',
      'RespectIgnoreDifferences=true',
      'ServerSideApply=true',
      'Replace=true',
      'PrunePropagationPolicy=background',
    ])
    const noPrune = syncBody({ ...on, prune: false }, 'HEAD', all, all.length)
    expect(noPrune.syncOptions?.items).not.toContain('PrunePropagationPolicy=background')
  })

  test('force rides on whichever strategy apply-only chose', () => {
    expect(syncBody({ ...OFF, force: true }, '', all, 3).strategy).toEqual({ hook: { force: true } })
    expect(syncBody({ ...OFF, force: true, applyOnly: true }, '', all, 3).strategy).toEqual({
      apply: { force: true },
    })
  })

  test('an empty revision is omitted rather than sent as an empty string', () => {
    expect(syncBody(OFF, '   ', all, 3).revision).toBeUndefined()
  })
})

describe('summarize', () => {
  const base = { dryRun: false, prune: false, picked: 3, total: 3, revision: 'main' }

  test('says the scope and the revision', () => {
    expect(summarize(base)).toBe('Synchronizes the whole application to main.')
  })

  test('a dry run says it changes nothing', () => {
    expect(summarize({ ...base, dryRun: true })).toContain('changes nothing')
  })

  test('prune says that it deletes', () => {
    expect(summarize({ ...base, prune: true })).toContain('deleted')
  })

  test('a selective sync warns that the application stays OutOfSync', () => {
    const s = summarize({ ...base, picked: 1 })
    expect(s).toContain('1 of 3 resources')
    expect(s).toContain('stays OutOfSync')
  })

  test('nothing selected says so', () => {
    expect(summarize({ ...base, picked: 0 })).toContain('Nothing is selected')
  })

  test('an application with no managed resources is still a whole-application sync', () => {
    // ArgoCD populates status.resources only after a comparison, so this is an
    // application it has never compared -- not one with nothing selected.
    expect(summarize({ ...base, picked: 0, total: 0 })).toBe(
      'Synchronizes the whole application to main.',
    )
  })
})
