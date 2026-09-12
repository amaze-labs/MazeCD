import { useQuery } from '@tanstack/react-query'
import { useInstances } from '../api/queries'
import { api } from '../api/client'
import { useAuth } from '../lib/auth'

export function Settings() {
  const instances = useInstances()
  const { logout } = useAuth()
  const version = useQuery({
    queryKey: ['version'],
    queryFn: () => api.get<{ version: string }>('/api/version'),
    refetchInterval: false,
  })

  return (
    <div>
      <header className="pt-safe border-b border-border px-4 pb-3">
        <h1 className="text-xl font-semibold">Settings</h1>
      </header>

      <section className="p-4">
        <h2 className="text-sm font-medium text-muted">Instances</h2>
        <p className="mt-1 text-xs text-muted">
          Defined in the mounted configuration file. Editing them means updating the config and
          restarting MazeCD.
        </p>
        <ul className="mt-3 divide-y divide-border">
          {(instances.data ?? []).map((i) => (
            <li key={i.name} className="flex items-start gap-3 py-3">
              <span className="mt-1 h-8 w-1.5 shrink-0 rounded-full" style={{ background: i.color }} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {i.name}
                  {i.production && <span className="ml-2 text-xs text-[#f4c030]">production</span>}
                </p>
                <p className="truncate text-xs text-muted">{i.url}</p>
                {i.error && <p className="mt-1 text-xs text-[#e96d76]">{i.error}</p>}
              </div>
              <span
                className="mt-1 size-2.5 shrink-0 rounded-full"
                style={{ background: i.reachable && i.tokenValid ? '#18be94' : '#e96d76' }}
                title={i.reachable && i.tokenValid ? 'Connected' : 'Unavailable'}
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="p-4">
        <h2 className="text-sm font-medium text-muted">About</h2>
        <p className="mt-2 text-sm">
          Server build <span className="font-mono">{version.data?.version ?? '…'}</span>
        </p>
        <p className="text-sm">
          Client build <span className="font-mono">{__BUILD_VERSION__}</span>
        </p>
      </section>

      <section className="p-4">
        <button
          onClick={() => void logout()}
          className="h-12 w-full rounded-xl border border-border text-sm"
        >
          Sign out
        </button>
      </section>
    </div>
  )
}
