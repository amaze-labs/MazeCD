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
        {/* The mark: health above, sync below — the same gutter the rows use. */}
        <span className="flex h-14 w-7 flex-col overflow-hidden rounded-full" aria-hidden="true">
          <span className="flex-[64] bg-healthy" />
          <span className="h-1" />
          <span className="flex-[28] bg-progressing" />
        </span>
        <h1 className="t-name text-[28px]">MazeCD</h1>
      </div>
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4">
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="h-14 rounded-control bg-inset px-4 text-[17px] outline-none placeholder:text-muted-tint focus:bg-raised"
          autoFocus
        />
        <Button tone="strong" type="submit" disabled={busy || password === ''} className="!h-14 !text-[17px] font-semibold">
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
        {error && <p className="text-center text-[14px] leading-snug text-degraded">{error}</p>}
      </form>
    </div>
  )
}
