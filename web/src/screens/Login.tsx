import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { ApiError } from '../api/client'

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
          ? 'Too many attempts. Try again in a few minutes.'
          : 'Wrong password.',
      )
    } finally {
      setBusy(false)
      setPassword('')
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">MazeCD</h1>
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4">
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="h-14 rounded-xl border border-border bg-surface px-4 text-lg outline-none focus:border-accent"
          autoFocus
        />
        <button
          type="submit"
          disabled={busy || password === ''}
          className="h-14 rounded-xl bg-accent text-lg font-medium text-bg disabled:opacity-40"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <p className="text-center text-sm text-[#e96d76]">{error}</p>}
      </form>
    </div>
  )
}
