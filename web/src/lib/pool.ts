/**
 * Run `fn` over every item with at most `limit` in flight, and count how
 * it went rather than throwing: a refresh of the whole fleet is fifty-odd
 * requests, and one instance that says no must not stop the others or hide
 * how many did go through.
 */
export async function runLimited<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<unknown>,
): Promise<{ ok: number; failed: number }> {
  let next = 0
  let ok = 0
  let failed = 0
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]
      try {
        await fn(item)
        ok++
      } catch {
        failed++
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return { ok, failed }
}
