import { describe, expect, test, vi } from 'vitest'
import { applyEvent, toApp } from './live'
import { readLines, streamJson } from './stream'
import type { AppDetail, AppsResponse, Health } from '../api/types'

const argoApp = (name: string, health: Health, phase?: string): AppDetail => ({
  metadata: { name, namespace: 'argocd' },
  spec: { project: 'home', destination: { server: 'https://k8s', namespace: name } },
  status: {
    health: { status: health },
    sync: { status: 'Synced', revision: 'abc1234' },
    operationState: phase ? { phase } : undefined,
  },
})

describe('toApp', () => {
  test('maps an ArgoCD Application onto the same shape /api/apps produces', () => {
    const a = argoApp('grafana', 'Progressing', 'Running')
    expect(toApp('home', a)).toEqual({
      instance: 'home',
      name: 'grafana',
      namespace: 'argocd',
      project: 'home',
      destServer: 'https://k8s',
      destNamespace: 'grafana',
      health: 'Progressing',
      healthMessage: undefined,
      sync: 'Synced',
      revision: 'abc1234',
      operationPhase: 'Running',
    })
  })

  test('an application ArgoCD has said nothing about yet reads as empty, not undefined', () => {
    const bare = { metadata: { name: 'x', namespace: 'argocd' }, spec: { project: 'p', destination: {} }, status: {} } as AppDetail
    expect(toApp('home', bare)).toMatchObject({ health: '', sync: '', revision: '', destServer: '' })
  })
})

describe('applyEvent', () => {
  const fleet = (): AppsResponse => ({
    apps: [
      toApp('home', argoApp('grafana', 'Healthy')),
      toApp('home', argoApp('loki', 'Healthy')),
      toApp('orders', argoApp('grafana', 'Healthy')),
    ],
    errors: [],
  })

  test('MODIFIED replaces only the matching instance/name pair', () => {
    const next = applyEvent(fleet(), 'MODIFIED', toApp('home', argoApp('grafana', 'Degraded')))!
    expect(next.apps).toHaveLength(3)
    expect(next.apps.find((a) => a.instance === 'home' && a.name === 'grafana')!.health).toBe('Degraded')
    // The same name on another instance is a different application.
    expect(next.apps.find((a) => a.instance === 'orders' && a.name === 'grafana')!.health).toBe('Healthy')
  })

  test('ADDED inserts an application the fleet had never seen', () => {
    const next = applyEvent(fleet(), 'ADDED', toApp('home', argoApp('push-relay', 'Healthy')))!
    expect(next.apps.map((a) => `${a.instance}/${a.name}`)).toContain('home/push-relay')
    expect(next.apps).toHaveLength(4)
  })

  test('DELETED removes it, and a repeat of the same DELETED changes nothing', () => {
    const once = applyEvent(fleet(), 'DELETED', toApp('home', argoApp('loki', 'Healthy')))!
    expect(once.apps).toHaveLength(2)
    const twice = applyEvent(once, 'DELETED', toApp('home', argoApp('loki', 'Healthy')))
    expect(twice).toBe(once) // same object: no re-render for a no-op
  })

  test('the instance error banner survives an event', () => {
    const prev = { ...fleet(), errors: [{ instance: 'utility', message: 'unreachable' }] }
    expect(applyEvent(prev, 'MODIFIED', toApp('home', argoApp('loki', 'Degraded')))!.errors).toEqual(
      prev.errors,
    )
  })

  test('an empty cache stays empty: one instance replaying is not the fleet', () => {
    expect(applyEvent(undefined, 'ADDED', toApp('home', argoApp('grafana', 'Healthy')))).toBeUndefined()
  })
})

describe('readLines', () => {
  const bodyOf = (chunks: string[]) => {
    const encoder = new TextEncoder()
    let i = 0
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i >= chunks.length) return controller.close()
        controller.enqueue(encoder.encode(chunks[i++]))
      },
    })
  }

  test('reassembles a record split across chunks and delivers the unterminated tail', async () => {
    const lines: string[] = []
    await readLines(bodyOf(['{"a":', '1}\n{"b":2}']), (l) => lines.push(l))
    expect(lines).toEqual(['{"a":1}', '{"b":2}'])
  })
})

describe('streamJson', () => {
  const respond = (status: number, chunks: string[]) => {
    const encoder = new TextEncoder()
    let i = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i >= chunks.length) return controller.close()
        controller.enqueue(encoder.encode(chunks[i++]))
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(status === 200 ? body : null, { status })))
  }

  test('onOpen fires once, before any value', async () => {
    respond(200, ['{"n":1}\n', '{"n":2}\n'])
    const order: string[] = []
    await streamJson<{ n: number }>(
      '/x',
      new AbortController().signal,
      () => order.push('open'),
      (v) => order.push(`n=${v.n}`),
    )
    vi.unstubAllGlobals()
    expect(order).toEqual(['open', 'n=1', 'n=2'])
  })

  test('a line that is not JSON is skipped, and the stream keeps going', async () => {
    respond(200, ['garbage\n', '{"n":7}\n'])
    const seen: number[] = []
    await streamJson<{ n: number }>('/x', new AbortController().signal, () => {}, (v) => seen.push(v.n))
    vi.unstubAllGlobals()
    expect(seen).toEqual([7])
  })

  test('a non-2xx rejects without ever reporting itself open', async () => {
    respond(502, [])
    const opened = vi.fn()
    await expect(
      streamJson('/x', new AbortController().signal, opened, () => {}),
    ).rejects.toThrow(/502/)
    vi.unstubAllGlobals()
    expect(opened).not.toHaveBeenCalled()
  })
})
