import { argoPath } from '../api/client'
import type { ResourceNode } from '../api/types'

/**
 * ArgoCD streams pod logs as newline-delimited JSON objects
 * ({"result":{"content":"…"}}), so the response is read incrementally rather
 * than awaited as a whole.
 */
export async function streamLogs(args: {
  instance: string
  app: string
  node: ResourceNode
  container?: string
  tailLines?: number
  onLine: (line: string) => void
  signal: AbortSignal
}) {
  const params = new URLSearchParams({
    podName: args.node.name,
    namespace: args.node.namespace,
    tailLines: String(args.tailLines ?? 200),
    follow: 'true',
  })
  if (args.container) params.set('container', args.container)

  const res = await fetch(argoPath(args.instance, `applications/${args.app}/logs?${params}`), {
    credentials: 'same-origin',
    signal: args.signal,
  })
  if (!res.ok || !res.body) {
    throw new Error(`log stream failed: ${res.status} ${await res.text()}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const raw of lines) {
      if (!raw.trim()) continue
      try {
        const parsed = JSON.parse(raw) as { result?: { content?: string } }
        if (parsed.result?.content !== undefined) args.onLine(parsed.result.content)
      } catch {
        args.onLine(raw)
      }
    }
  }
}
