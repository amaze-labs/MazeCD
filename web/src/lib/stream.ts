/**
 * Reading a long-lived HTTP response as it arrives.
 *
 * ArgoCD says everything that streams — pod logs, the application watch, the
 * resource-tree watch — in the same dialect: one JSON object per line, over a
 * chunked response that never ends on its own. So there is one reader here,
 * not one per caller.
 */

/**
 * Delivers each newline-terminated record of `body` as it arrives.
 *
 * The last line gets delivered too, even without its terminator: a server can
 * close mid-record (a pod restarts, an instance drops) and dropping that tail
 * silently loses the most recent thing it said.
 */
export async function readLines(
  body: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const raw of lines) onLine(raw)
  }
  onLine(buffer)
}

/**
 * Opens `url` and reads it as newline-delimited JSON until the server closes
 * it or `signal` aborts. Resolves when the stream ends, rejects when it
 * could not be opened or died mid-flight — the caller decides what to do
 * about either.
 *
 * `onOpen` fires once the response headers say the connection is real, which
 * is the moment a caller can trust it is connected and resynchronise.
 *
 * A line that is not JSON is dropped rather than thrown: grpc-gateway can
 * emit framing of its own, and one unparseable line must not kill a stream
 * that is otherwise healthy.
 */
export async function streamJson<T>(
  url: string,
  signal: AbortSignal,
  onOpen: () => void,
  onValue: (value: T) => void,
): Promise<void> {
  const res = await fetch(url, { credentials: 'same-origin', signal })
  if (!res.ok || !res.body) {
    throw new Error(`stream ${url} failed: ${res.status}`)
  }
  onOpen()
  await readLines(res.body, (raw) => {
    if (!raw.trim()) return
    try {
      onValue(JSON.parse(raw) as T)
    } catch {
      // Not a record: ignore it and keep reading.
    }
  })
}
