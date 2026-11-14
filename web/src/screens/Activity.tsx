import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, CornerDownRight, History, RefreshCw, ServerOff, X } from 'lucide-react'
import { useApps } from '../api/queries'
import { ScreenHeader } from '../components/ScreenHeader'
import { SheetListSkeleton } from '../components/Skeleton'
import { Button, Callout, Chip, EmptyState, Seg, tint } from '../components/ui'
import { byDay, toEntries, type Entry } from '../lib/activity'
import { shortRev } from '../lib/rev'

type Filter = 'all' | 'running' | 'failed' | 'manual'

const time = (at: number) =>
  new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/**
 * WHAT CHANGED, AND WHEN — the fleet's last operations, newest first, under
 * the day they happened. The answer to "what moved since yesterday?", which
 * until now meant opening applications one by one.
 *
 * Each application contributes its last operation only: that is all ArgoCD
 * keeps in an application's status, and all the list carries. See
 * `lib/activity.ts`.
 */
export function Activity() {
  const apps = useApps()
  const [filter, setFilter] = useState<Filter>('all')
  const entries = useMemo(() => toEntries(apps.data?.apps ?? []), [apps.data])
  const counts = useMemo(
    () => ({
      running: entries.filter((e) => e.running).length,
      failed: entries.filter((e) => e.failed).length,
      manual: entries.filter((e) => !e.automated).length,
    }),
    [entries],
  )
  const shown = entries.filter((e) =>
    filter === 'running' ? e.running : filter === 'failed' ? e.failed : filter === 'manual' ? !e.automated : true,
  )
  const days = byDay(shown)

  return (
    <div>
      <ScreenHeader
        title="Activity"
        sub={
          <>
            <b className="font-medium text-muted">last syncs</b> · newest first
          </>
        }
      />

      <Seg
        label="Show"
        className="mx-3.5"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'all' },
          { value: 'running', label: 'running', count: counts.running },
          { value: 'failed', label: 'failed', count: counts.failed },
          { value: 'manual', label: 'manual', count: counts.manual },
        ]}
      />

      {apps.isError && (
        <div className="mx-3.5 mt-2">
          <Callout
            icon={<ServerOff size={17} strokeWidth={2} />}
            title="MazeCD could not load the fleet"
            action={
              <Button className="!h-10" onClick={() => void apps.refetch()}>
                Try again
              </Button>
            }
          >
            <span className="t-mono block text-[11.5px]">{String(apps.error)}</span>
          </Callout>
        </div>
      )}

      {apps.isLoading && !apps.data ? (
        <div className="mt-3">
          <SheetListSkeleton />
        </div>
      ) : (
        days.map((d) => (
          <section key={d.key}>
            <h2 className="t-mono mx-[18px] mt-4 mb-1.5 flex items-center gap-2 text-[10px] tracking-[0.13em] text-muted uppercase">
              <b className="font-semibold text-text">{d.label.title}</b>
              {d.label.date}
              <span className="h-px flex-1 bg-[var(--edge-strong)]" aria-hidden="true" />
            </h2>
            <div className="card mx-3.5 overflow-hidden">
              {d.entries.map((e) => (
                <EntryRow key={`${e.app.instance}/${e.app.name}`} e={e} />
              ))}
            </div>
          </section>
        ))
      )}

      {apps.data && shown.length === 0 && !apps.isError && (
        <EmptyState icon={<History size={22} strokeWidth={1.8} />} title="Nothing here">
          {filter === 'all'
            ? 'ArgoCD has no operation recorded on any application yet.'
            : `No application's last operation is ${filter === 'manual' ? 'a manual one' : filter}.`}
        </EmptyState>
      )}
    </div>
  )
}

function EntryRow({ e }: { e: Entry }) {
  const { app } = e
  const color = e.failed
    ? 'var(--color-degraded)'
    : e.running
      ? 'var(--color-progressing)'
      : 'var(--color-healthy)'
  const rev = shortRev(app.operationRevision || app.revision)
  return (
    <Link
      to={`/apps/${encodeURIComponent(app.instance)}/${encodeURIComponent(app.name)}`}
      className="flex gap-2.5 px-3 py-2.5 active:brightness-[var(--press)] [&+&]:border-t [&+&]:border-rule"
      style={{
        background: e.failed
          ? `linear-gradient(${tint(color, 'var(--tint-row)')}, ${tint(color, 'var(--tint-row)')}), var(--color-panel)`
          : 'var(--color-panel)',
      }}
    >
      <span
        className="mt-px grid size-[26px] flex-none place-items-center rounded-[7px]"
        style={
          e.failed
            ? { background: color, color: 'var(--color-on-status)' }
            : { background: tint(color, 'var(--tint-soft)'), color }
        }
        aria-label={e.phase.toLowerCase() || 'succeeded'}
      >
        {e.failed ? (
          <X size={14} strokeWidth={3} aria-hidden="true" />
        ) : e.running ? (
          <RefreshCw size={13} strokeWidth={2.6} className="spin" aria-hidden="true" />
        ) : (
          <Check size={14} strokeWidth={3} aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="t-name min-w-0 flex-1 truncate text-[15px] leading-[1.2]">{app.name}</span>
          <time dateTime={new Date(e.at).toISOString()} className="t-mono flex-none text-[10.5px] text-dim">
            {time(e.at)}
          </time>
        </span>
        <span className="t-mono mt-[3px] flex items-center gap-[5px] text-[10.5px] whitespace-nowrap text-dim">
          <span className="min-w-0 truncate">
            <span className="text-muted">
              {app.instance}/{app.project}
            </span>
            <span className="mx-[5px] text-[var(--edge-strong)]">·</span>
            {e.running ? 'syncing to' : e.failed ? 'failed at' : 'synced to'}{' '}
            <span className="text-text">{rev}</span>
          </span>
          <span className="flex-1" />
          {e.automated ? 'auto' : app.operationInitiator ? <Chip className="!h-[17px] !text-[9.5px]">{app.operationInitiator}</Chip> : null}
        </span>
        {(e.failed || e.running) && app.operationMessage && (
          <span
            className="t-mono mt-1.5 flex gap-[5px] rounded-[6px] px-2 py-1 text-[10.5px] leading-[1.4]"
            style={{ background: tint(color, 'var(--tint-soft)'), color }}
          >
            <CornerDownRight size={12} strokeWidth={2.2} className="mt-px flex-none" aria-hidden="true" />
            <span className="line-clamp-3 [overflow-wrap:anywhere]">{app.operationMessage}</span>
          </span>
        )}
      </span>
    </Link>
  )
}
