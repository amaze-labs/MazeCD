import type { Health, SyncStatus } from '../api/types'
import { healthColor, syncColor } from '../lib/status'

export function StatusDot({ health, sync }: { health: Health; sync: SyncStatus }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`size-2.5 rounded-full ${health === 'Progressing' ? 'animate-pulse' : ''}`}
        style={{ background: healthColor(health) }}
        title={`Health: ${health || 'Unknown'}`}
      />
      <span
        className="size-2.5 rounded-full"
        style={{ background: syncColor(sync) }}
        title={`Sync: ${sync || 'Unknown'}`}
      />
    </span>
  )
}
