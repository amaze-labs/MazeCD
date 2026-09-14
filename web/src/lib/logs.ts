import { argoPath } from '../api/client'
import { readLines } from './stream'
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

  await readLines(res.body, handleLine)
}
