import { afterEach, describe, expect, test, vi } from 'vitest'
import { streamLogs } from './logs'
import type { ResourceNode } from '../api/types'

const node: ResourceNode = { group: '', kind: 'Pod', name: 'web-abc', namespace: 'web-prod', version: 'v1' }

/** A ReadableStream that yields each chunk (already UTF-8 encoded) with nothing buffered ahead of time. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(chunks[i]))
      i++
    },
  })
}

function stubFetch(body: ReadableStream<Uint8Array>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body)),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('streamLogs', () => {
  test('a JSON object split across two chunks is parsed once reassembled', async () => {
    stubFetch(streamOf(['{"result":{"content":"hello ', 'world"}}\n']))
    const lines: string[] = []
    await streamLogs({ instance: 'a', app: 'b', node, onLine: (l) => lines.push(l), signal: new AbortController().signal })
    expect(lines).toEqual(['hello world'])
  })

  test('blank lines are ignored', async () => {
    stubFetch(streamOf(['{"result":{"content":"one"}}\n\n\n{"result":{"content":"two"}}\n']))
    const lines: string[] = []
    await streamLogs({ instance: 'a', app: 'b', node, onLine: (l) => lines.push(l), signal: new AbortController().signal })
    expect(lines).toEqual(['one', 'two'])
  })

  test('a non-JSON line falls back to the raw line', async () => {
    stubFetch(streamOf(['not json at all\n', '{"result":{"content":"ok"}}\n']))
    const lines: string[] = []
    await streamLogs({ instance: 'a', app: 'b', node, onLine: (l) => lines.push(l), signal: new AbortController().signal })
    expect(lines).toEqual(['not json at all', 'ok'])
  })

  test('stops reading once its signal aborts', async () => {
    const ctrl = new AbortController()
    const encoder = new TextEncoder()
    let pulls = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++
        if (pulls === 1) {
          controller.enqueue(encoder.encode('{"result":{"content":"first"}}\n'))
          ctrl.abort()
          return
        }
        // A real aborted fetch stream errors instead of continuing to
        // produce chunks; simulate that so the loop has to stop on its own.
        controller.error(new DOMException('aborted', 'AbortError'))
      },
    })
    stubFetch(body)
    const lines: string[] = []
    await expect(
      streamLogs({ instance: 'a', app: 'b', node, onLine: (l) => lines.push(l), signal: ctrl.signal }),
    ).rejects.toThrow()
    expect(lines).toEqual(['first'])
  })
})
