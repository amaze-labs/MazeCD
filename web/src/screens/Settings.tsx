import { useQuery } from '@tanstack/react-query'
import { useInstances } from '../api/queries'
import { api } from '../api/client'
import { useAuth } from '../lib/auth'
import { InstancePill } from '../components/ui'
import type { InstanceInfo } from '../api/types'

/** One word for the connection, because a coloured dot said nothing. */
function link(i: InstanceInfo): { word: string; className: string } {
  if (!i.reachable) return { word: 'Unreachable', className: 'text-degraded' }
  if (!i.tokenValid) return { word: 'Token rejected', className: 'text-outofsync' }
  return { word: 'Connected', className: 'text-healthy' }
}

export function Settings() {
  const instances = useInstances()
  const { logout } = useAuth()
  const version = useQuery({
    queryKey: ['version'],
    queryFn: () => api.get<{ version: string }>('/api/version'),
    refetchInterval: false,
  })

  return (
    <div className="px-4">
      <header className="pt-safe pb-3">
        <h1 className="t-name text-[26px]">Settings</h1>
      </header>

      <section className="border-t border-rule pt-4">
        <h2 className="t-name text-[17px]">Instances</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          These come from the configuration file mounted into MazeCD. To change one, edit the file
          and restart the server.
        </p>
        <ul className="mt-3 flex flex-col gap-0.5">
          {(instances.data ?? []).map((i) => {
            const state = link(i)
            return (
              <li key={i.name} className="rounded-pill bg-panel px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <InstancePill name={i.name} color={i.color} />
                  {i.production && (
                    <span className="rounded-pill bg-outofsync/15 px-1.5 py-px text-[12px] leading-4 font-medium text-outofsync">
                      production
                    </span>
                  )}
                  <span className={`ml-auto shrink-0 text-[13px] ${state.className}`}>
                    {state.word}
                  </span>
                </div>
                <p className="t-mono mt-1.5 truncate text-[12px] text-muted">{i.url}</p>
                {i.error && (
                  <p className="mt-1 text-[13px] leading-snug text-text-degraded">{i.error}</p>
                )}
              </li>
            )
          })}
          {(instances.data ?? []).length === 0 && (
            <li className="py-8 text-center text-[15px] leading-relaxed text-muted">
              No instances are configured. Add one to the configuration file and restart MazeCD.
            </li>
          )}
        </ul>
      </section>

      <section className="mt-6 border-t border-rule pt-4">
        <h2 className="t-name text-[17px]">Build</h2>
        <dl className="mt-2 flex flex-col gap-1 text-[15px]">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Server</dt>
            <dd className="t-mono text-[13px]">{version.data?.version ?? '…'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Client</dt>
            <dd className="t-mono text-[13px]">{__BUILD_VERSION__}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-6 pb-4">
        <button
          onClick={() => void logout()}
          className="h-12 w-full rounded-control border border-rule text-[15px] active:bg-raised"
        >
          Sign out
        </button>
      </section>
    </div>
  )
}
