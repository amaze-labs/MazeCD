export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/**
 * MazeCD marks its own session rejections with this header. A 401 without it
 * came from ArgoCD through the instance proxy -- an expired or revoked
 * instance token -- and must surface as an ordinary upstream error, not as a
 * logout: bouncing to the login screen on every poll would leave the operator
 * in a loop with no way to read what ArgoCD actually said.
 */
const AUTH_HEADER = 'X-MazeCD-Auth'

let onUnauthenticated: () => void = () => {}

/** Registered by the auth provider so a dead session lands on the login screen. */
export function setUnauthenticatedHandler(fn: () => void) {
  onUnauthenticated = fn
}

/** Path of an ArgoCD API call routed through the instance proxy. */
export function argoPath(instance: string, path: string): string {
  return `/api/i/${encodeURIComponent(instance)}/${path}`
}

async function extractError(res: Response): Promise<string> {
  const text = await res.text()
  try {
    const body = JSON.parse(text) as { error?: string; message?: string; detail?: string }
    return body.error ?? body.message ?? body.detail ?? text
  } catch {
    return text.trim() || res.statusText
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (res.status === 401 && res.headers.get(AUTH_HEADER)) {
    onUnauthenticated()
    throw new ApiError(401, 'session expired')
  }
  if (!res.ok) {
    throw new ApiError(res.status, await extractError(res))
  }
  if (res.status === 204 || res.headers.get('Content-Length') === '0') {
    return undefined as T
  }
  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
