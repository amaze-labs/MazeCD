import { Link } from 'react-router-dom'
import type { App } from '../api/types'
import { StatusDot } from './StatusDot'

export function AppRow({ app, color }: { app: App; color: string }) {
  const busy = app.operationPhase === 'Running' || app.operationPhase === 'Terminating'
  return (
    <Link
      to={`/apps/${encodeURIComponent(app.instance)}/${encodeURIComponent(app.name)}`}
      className="flex items-center gap-3 border-b border-border px-4 py-3 active:bg-surface-2"
    >
      <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: color }} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{app.name}</span>
          {busy && <span className="text-xs text-accent">{app.operationPhase}</span>}
        </span>
        <span className="mt-0.5 flex gap-2 text-xs text-muted">
          <span>{app.instance}</span>
          <span>·</span>
          <span className="truncate">{app.destNamespace || app.project}</span>
        </span>
      </span>
      <StatusDot health={app.health} sync={app.sync} />
    </Link>
  )
}
