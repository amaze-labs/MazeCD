import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { ApiError } from '../api/client'
import { Button } from '../components/ui'

export function Login() {
  const { login } = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(password)
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? 'Too many attempts. Wait a few minutes, then try again.'
          : 'That password was not accepted. Check it and try again.',
      )
    } finally {
      setBusy(false)
      setPassword('')
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
      <div className="flex flex-col items-center gap-4">
        {/* The mark: the same SVG the browser uses as the favicon, so the
            login screen and the home-screen icon can never drift apart. */}
        <img src="/favicon.svg" alt="" className="h-14 w-14 rounded-[12px]" />
        <h1 className="t-title text-[30px]">MazeCD</h1>
        <p className="t-mono -mt-2 text-[11px] text-dim">every ArgoCD instance, one screen · {__BUILD_VERSION__}</p>
      </div>
      <form onSubmit={submit} className="card flex w-full max-w-sm flex-col gap-3 p-3">
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="h-12 rounded-control bg-panel px-4 text-[16px] ring-1 ring-[var(--edge-strong)] outline-none ring-inset placeholder:text-dim focus:ring-[var(--edge-active)]"
          autoFocus
        />
        <Button tone="strong" type="submit" disabled={busy || password === ''} className="!h-12 !text-[16px]">
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
        {error && <p className="text-center text-[14px] leading-snug text-degraded">{error}</p>}
      </form>
    </div>
  )
}
