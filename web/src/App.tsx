import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { Login } from './screens/Login'
import { Shell } from './components/Shell'
import { Apps } from './screens/Apps'
import { AppDetailScreen } from './screens/AppDetail'
import { Settings } from './screens/Settings'

function Routed() {
  const { authenticated } = useAuth()
  if (authenticated === undefined) {
    return <div className="flex min-h-dvh items-center justify-center text-muted">…</div>
  }
  if (!authenticated) return <Login />
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Apps />} />
        <Route path="/apps/:instance/:name" element={<AppDetailScreen />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  )
}

export function App() {
  return (
    <AuthProvider>
      <Routed />
    </AuthProvider>
  )
}
