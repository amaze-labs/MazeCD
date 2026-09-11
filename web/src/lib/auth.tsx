import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, setUnauthenticatedHandler } from '../api/client'

type AuthState = {
  /** undefined while the initial check is in flight. */
  authenticated: boolean | undefined
  login: (password: string) => Promise<void>
  logout: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    setUnauthenticatedHandler(() => setAuthenticated(false))
    api
      .get('/api/auth/me')
      .then(() => setAuthenticated(true))
      .catch(() => setAuthenticated(false))
  }, [])

  const login = useCallback(async (password: string) => {
    await api.post('/api/auth/login', { password })
    setAuthenticated(true)
  }, [])

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout')
    setAuthenticated(false)
  }, [])

  return <Ctx.Provider value={{ authenticated, login, logout }}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
