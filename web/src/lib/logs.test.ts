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

/**
 * A ReadableStream that errors as soon as `signal` fires, mirroring what a
 * real aborted fetch body does. Paired with a `fetch` stub that honours
 * `init.signal`, this is what actually exercises `streamLogs`' abort wiring
 * — unlike a stub that ignores its arguments.
 */
function streamAbortableOn(chunks: string[], signal: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let i = 0
  return new ReadableStream({
    start(controller) {
      signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
    },
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

function stubAbortableFetch(chunks: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      return new Response(streamAbortableOn(chunks, init!.signal!))
    }),
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

  test('a trailing line without a newline is still delivered once the stream ends', async () => {
    // A dropped connection can end mid-record: the server's last write has
    // no trailing "\n", so it never goes through the split('\n') path.
    stubFetch(streamOf(['{"result":{"content":"one"}}\n', '{"result":{"content":"two"}}']))
    const lines: string[] = []
    await streamLogs({ instance: 'a', app: 'b', node, onLine: (l) => lines.push(l), signal: new AbortController().signal })
    expect(lines).toEqual(['one', 'two'])
  })

  test('a mid-stream read error stops the loop and rejects', async () => {
    const ctrl = new AbortController()
    const encoder = new TextEncoder()
    let pulls = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++
        if (pulls === 1) {
          controller.enqueue(encoder.encode('{"result":{"content":"first"}}\n'))
          return
        }
        controller.error(new Error('connection reset'))
      },
    })
    stubFetch(body)
    const lines: string[] = []
    await expect(
      streamLogs({ instance: 'a', app: 'b', node, onLine: (l) => lines.push(l), signal: ctrl.signal }),
    ).rejects.toThrow()
    expect(lines).toEqual(['first'])
  })

  test('aborting mid-stream stops delivery: no further onLine calls after the abort', async () => {
    const ctrl = new AbortController()
    stubAbortableFetch([
      '{"result":{"content":"first"}}\n',
      '{"result":{"content":"second"}}\n',
      '{"result":{"content":"third"}}\n',
    ])
    const lines: string[] = []
    await expect(
      streamLogs({
        instance: 'a',
        app: 'b',
        node,
        onLine: (l) => {
          lines.push(l)
          if (l === 'first') ctrl.abort()
        },
        signal: ctrl.signal,
      }),
    ).rejects.toThrow()
    // Only the line delivered before the abort fired; "second"/"third" never
    // reach onLine because the stream errors out from under the read loop.
    expect(lines).toEqual(['first'])
  })
})
