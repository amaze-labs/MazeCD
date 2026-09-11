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

  const handleLine = (raw: string) => {
    if (!raw.trim()) return
    try {
      const parsed = JSON.parse(raw) as { result?: { content?: string } }
      if (parsed.result?.content !== undefined) args.onLine(parsed.result.content)
    } catch {
      args.onLine(raw)
    }
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
    for (const raw of lines) handleLine(raw)
  }
  // The server can close the connection mid-record (e.g. the pod restarts):
  // whatever is left in `buffer` is the last line, just without its
  // trailing newline. Run it through the same path rather than dropping it.
  handleLine(buffer)
}
