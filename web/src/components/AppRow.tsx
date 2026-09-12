import { Link } from 'react-router-dom'
import type { App } from '../api/types'
import { InstancePill, Revision, StatusGutter } from './ui'
import { bucketOf, surfaceOf } from '../lib/fleet'

/**
 * The list endpoint carries no health message — only health, sync and the
 * last operation phase — so the third line says the most specific true thing
 * those three support. The detail screen has the real message from ArgoCD.
 */
function reason(app: App): string {
  if (app.operationPhase === 'Failed' || app.operationPhase === 'Error')
    return 'Last sync failed. Open for the reason.'
  if (app.operationPhase === 'Terminating') return 'Sync is being terminated.'
  if (app.health === 'Missing') return 'Resources are missing from the cluster.'
  return 'ArgoCD reports this application unhealthy.'
}

export function AppRow({ app, color }: { app: App; color: string }) {
  const bucket = bucketOf(app)
  const busy = app.operationPhase === 'Running'
  const quiet = bucket === 'Healthy' || bucket === 'Progressing'
  return (
    <Link
      to={`/apps/${encodeURIComponent(app.instance)}/${encodeURIComponent(app.name)}`}
      className={`relative block py-3 pr-4 pl-5 active:brightness-125 ${surfaceOf(bucket)}`}
    >
      <StatusGutter health={app.health} sync={app.sync} />
      <span className="sr-only">
        {app.health || 'Unknown'} health, {app.sync || 'Unknown'} sync.{' '}
      </span>
      <h2 className="t-name text-[22px]">{app.name}</h2>
      <div className="mt-1 flex items-center gap-2">
        <InstancePill name={app.instance} color={color} />
        <span className={`min-w-0 flex-1 truncate text-[13px] ${quiet ? 'text-muted' : 'text-muted-tint'}`}>
          {app.destNamespace || app.project}
        </span>
        {busy ? (
          <span className="shrink-0 text-[12px] text-progressing">Syncing</span>
        ) : (
          <Revision sha={app.revision} className={quiet ? 'text-muted' : 'text-muted-tint'} />
        )}
      </div>
      {bucket === 'Degraded' && (
        <p className="mt-1 text-[13px] leading-snug text-text-degraded">{reason(app)}</p>
      )}
    </Link>
  )
}
