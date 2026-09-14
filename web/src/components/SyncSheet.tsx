import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronRight, CircleCheck } from 'lucide-react'
import { Sheet } from './Sheet'
import { Button, Fact, Mark } from './ui'
import { refKey } from './Tree'
import { syncApp, type SyncRequest } from '../api/actions'
import { useOnline } from '../lib/online'
import { toast } from '../lib/toast'
import type { AppDetail } from '../api/types'

/**
 * SYNCHRONIZE — the first thing in MazeCD that changes a cluster.
 *
 * THE PROBLEM THIS SHEET HAS AND THE OTHER TWO DO NOT: a dozen flags, a
 * resource list and a destructive button, on a phone. Read top to bottom it is
 * three screens of scroll, and the one question that matters — *what is about
 * to happen to my cluster* — would be answered three screens above the button
 * that does it.
 *
 * Three decisions answer it, all of them in the language the rest of the app
 * already speaks:
 *
 * 1. **The summary is pinned to the button.** A sentence in plain English,
 *    recomputed on every toggle, sitting directly above Synchronize and
 *    visible however far the sheet is scrolled. It names the scope, the
 *    revision, and the two things that surprise people — that prune deletes,
 *    and that a selective sync leaves the application OutOfSync. If you read
 *    nothing else in this sheet you still cannot press the button blind.
 *
 * 2. **The four that change the outcome are always on screen; the seven that
 *    change the mechanics are folded away.** Prune, dry run, apply only and
 *    force decide what happens to the cluster. Validate=false and friends
 *    decide how kubectl gets there. A native `<details>` carries the second
 *    group, and its band says how many are on, so nothing hides silently. The
 *    resource list folds the same way, its band carrying the count.
 *
 * 3. **Prune's propagation policy appears only when prune is on**, directly
 *    under it, because that is the only time it does anything — and it is not
 *    sent otherwise.
 *
 * Nothing here is filled and nothing is coloured. "On" is the inset ink ring
 * the view switch already uses, the section bands are the grey strip the
 * resource groups already sit on, and the only weight between Cancel and
 * Synchronize is the two hairlines the design already defines.
 */

/** ArgoCD's sync options, as they travel: a list of `Key=value` strings. One
 * table drives the rows, the request and the count on the band. */
const OPTIONS = [
  { key: 'skipSchemaValidation', label: 'Skip schema validation', wire: 'Validate=false' },
  { key: 'createNamespace', label: 'Auto-create namespace', wire: 'CreateNamespace=true' },
  { key: 'pruneLast', label: 'Prune last', wire: 'PruneLast=true' },
  { key: 'applyOutOfSyncOnly', label: 'Apply out of sync only', wire: 'ApplyOutOfSyncOnly=true' },
  {
    key: 'respectIgnoreDifferences',
    label: 'Respect ignore differences',
    wire: 'RespectIgnoreDifferences=true',
  },
  { key: 'serverSideApply', label: 'Server-side apply', wire: 'ServerSideApply=true' },
  // ArgoCD implements REPLACE as a sync option like any other, so it lives in
  // the list rather than stranded in a box of its own.
  { key: 'replace', label: 'Replace', wire: 'Replace=true' },
] as const

type OptionKey = (typeof OPTIONS)[number]['key']
const POLICIES = ['foreground', 'background', 'orphan'] as const

export type Flags = Record<OptionKey, boolean> & {
  prune: boolean
  dryRun: boolean
  applyOnly: boolean
  force: boolean
  policy: (typeof POLICIES)[number]
}

const NO_FLAGS: Flags = {
  prune: false,
  dryRun: false,
  applyOnly: false,
  force: false,
  policy: 'foreground',
  skipSchemaValidation: false,
  createNamespace: false,
  pruneLast: false,
  applyOutOfSyncOnly: false,
  respectIgnoreDifferences: false,
  serverSideApply: false,
  replace: false,
}

type Managed = NonNullable<AppDetail['status']['resources']>[number]

/**
 * The request ArgoCD is sent.
 *
 * The one thing here that is not a transcription of the form: **naming every
 * resource is not the same as naming none.** A request that carries a
 * `resources` list is a *selective* sync, and ArgoCD leaves a selectively
 * synced application OutOfSync even when the list happens to cover all of it.
 * "All" therefore sends no list at all — it means the application, not its
 * current twelve resources — which is also what ArgoCD's own UI does.
 */
export function syncBody(flags: Flags, revision: string, chosen: Managed[], total: number): SyncRequest {
  const items: string[] = OPTIONS.filter((o) => flags[o.key]).map((o) => o.wire)
  // Only prune deletes anything, so the propagation policy is only sent when
  // it can govern a deletion.
  if (flags.prune) items.push(`PrunePropagationPolicy=${flags.policy}`)
  const force = flags.force || undefined
  return {
    revision: revision.trim() || undefined,
    prune: flags.prune || undefined,
    dryRun: flags.dryRun || undefined,
    strategy: flags.applyOnly ? { apply: { force } } : { hook: { force } },
    resources:
      chosen.length === total
        ? undefined
        : chosen.map((r) => ({
            group: r.group,
            kind: r.kind,
            name: r.name,
            namespace: r.namespace,
          })),
    syncOptions: items.length > 0 ? { items } : undefined,
  }
}

/** What is about to happen, in words, above the button that does it. */
export function summarize(o: {
  dryRun: boolean
  prune: boolean
  picked: number
  total: number
  revision: string
}): string {
  // An application ArgoCD has never compared reports no managed resources at
  // all, so there is nothing to select and nothing to deselect -- and it is
  // exactly the application somebody reaches for Sync on. `syncBody` already
  // gets this right (no resources named is a whole-application sync); only
  // this sentence and the button's disabled state ever disagreed.
  if (o.total > 0 && o.picked === 0)
    return 'Nothing is selected, so there is nothing to synchronize.'
  const all = o.picked === o.total
  const scope = all ? 'the whole application' : `${o.picked} of ${o.total} resources`
  const rev = o.revision.trim() || 'the target revision'
  if (o.dryRun) {
    return `Dry run: ArgoCD compares ${scope} against ${rev} and changes nothing in the cluster.`
  }
  const notes = []
  if (o.prune) notes.push('Resources removed from Git are deleted.')
  if (!all) notes.push('The application stays OutOfSync until the rest follows.')
  return [`Synchronizes ${scope} to ${rev}.`, ...notes].join(' ')
}

/** A checkbox in this design's grammar: no fill anywhere, so "on" is the inset
 * ink ring the active view-switch segment already wears, plus the check. */
function Box({ on }: { on: boolean }) {
  return (
    <span
      className="grid size-[19px] flex-none place-items-center rounded-[6px] text-text"
      style={{ boxShadow: `inset 0 0 0 1px var(${on ? '--edge-active' : '--edge-strong'})` }}
      aria-hidden="true"
    >
      {on && <Check size={12} strokeWidth={1.9} />}
    </span>
  )
}

function Toggle({
  label,
  note,
  on,
  onChange,
}: {
  label: string
  note: string
  on: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex min-h-[54px] w-full items-center gap-3 border-b border-rule px-4 text-left"
    >
      <Box on={on} />
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] leading-[1.25]">{label}</span>
        <span className="t-mono mt-[3px] block truncate text-[10.5px] leading-[1.2] text-dim">
          {note}
        </span>
      </span>
    </button>
  )
}

/** The grey strip a group sits on, exactly as the resource list uses it. */
function band(extra = '') {
  return `t-mono flex h-10 items-center gap-3 bg-band px-4 text-[12px] ${extra}`
}

export function SyncSheet({
  instance,
  name,
  detail,
  onClose,
}: {
  instance: string
  name: string
  detail: AppDetail
  onClose: () => void
}) {
  const online = useOnline()
  const qc = useQueryClient()
  const managed = detail.status?.resources ?? []
  const total = managed.length
  const sorted = [...managed].sort((a, b) => refKey(a).localeCompare(refKey(b)))

  const [flags, setFlags] = useState<Flags>(NO_FLAGS)
  const [revision, setRevision] = useState(detail.spec?.source?.targetRevision ?? '')
  const [picked, setPicked] = useState<Set<string>>(() => new Set(managed.map(refKey)))
  const [busy, setBusy] = useState(false)
  /**
   * THE DRY RUN'S VERDICT, AND WHY IT IS NOT IN THE RESPONSE.
   *
   * ArgoCD answers a sync request — dry run or not — with an application whose
   * `status.operationState` it has just set to nil (`util/argo.SetAppOperation`,
   * see `api/actions.ts`). Reading a result off that response gives a constant,
   * which is what this sheet used to report as a receipt.
   *
   * The verdict is the operation the controller writes a second or two later,
   * and it arrives here on its own: `detail` is the live `['app', …]` query
   * that `lib/live.ts` feeds from ArgoCD's application watch. `waiting` holds
   * the `finishedAt` of whatever operation was on the application *before* the
   * request, which is the whole test for "this one is mine": nil first, then an
   * operation that finished at a time the old one did not.
   */
  const [waiting, setWaiting] = useState<{ was: string | undefined } | null>(null)
  const op = detail.status?.operationState
  const verdict = waiting && op?.finishedAt && op.finishedAt !== waiting.was ? op : null

  const set = <K extends keyof Flags>(k: K, v: Flags[K]) => setFlags((f) => ({ ...f, [k]: v }))
  const chosen = sorted.filter((r) => picked.has(refKey(r)))
  const summary = summarize({
    dryRun: flags.dryRun,
    prune: flags.prune,
    picked: chosen.length,
    total,
    revision,
  })
  const optionsOn = OPTIONS.filter((o) => flags[o.key]).length

  async function submit() {
    setBusy(true)
    setWaiting(null)
    try {
      await syncApp(instance, name, syncBody(flags, revision, chosen, total))
      if (flags.dryRun) {
        // A dry run changes nothing, so nothing is invalidated except the
        // application itself — whose operationState the request just cleared
        // upstream — and the sheet stays open: the operator reads the verdict
        // here and can turn the flag off and commit for real without
        // rebuilding the form. `waiting` is what makes the footer report it.
        setWaiting({ was: op?.finishedAt })
        await qc.invalidateQueries({ queryKey: ['app', instance, name] })
        toast(
          'ok',
          'Dry run requested',
          `${instance} is running it against ${name} and changes nothing either way. The verdict appears in the sheet when it lands.`,
        )
        return
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['app', instance, name] }),
        qc.invalidateQueries({ queryKey: ['tree', instance, name] }),
        qc.invalidateQueries({ queryKey: ['apps'] }),
      ])
      toast(
        'ok',
        'Sync started',
        // The application streams, so the phases arrive on their own; this
        // only has to say what was asked for — including the one outcome that
        // looks like a failure and is not.
        chosen.length === total
          ? `${instance} is synchronizing ${name}.`
          : `${instance} is synchronizing ${chosen.length} of ${total} resources. ${name} stays OutOfSync until the rest follows.`,
      )
      onClose()
    } catch (e) {
      // The sheet stays open on a failure. A token with read-only RBAC gives
      // 403 every time, and throwing away a dozen deliberate choices on the
      // way out helps nobody.
      toast('fail', 'That did not go through', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose} title="Synchronize">
      <dl className="m-0 -mx-4 border-b border-rule">
        <Fact label="application" value={name} />
        <Fact label="from" value={detail.spec?.source?.repoURL} />
      </dl>

      <label className="t-mono mt-3.5 mb-1.5 block text-[11px] text-dim" htmlFor="sync-revision">
        revision
      </label>
      <input
        id="sync-revision"
        value={revision}
        onChange={(e) => setRevision(e.target.value)}
        placeholder="HEAD"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="t-mono h-12 w-full rounded-control bg-inset px-3 text-[13px] outline-none placeholder:font-sans placeholder:text-muted focus:bg-raised"
      />

      <div className="mt-3.5 -mx-4">
        <div className={band()}>what it does</div>
        <Toggle
          label="Prune"
          note="delete what Git no longer has"
          on={flags.prune}
          onChange={(v) => set('prune', v)}
        />
        {flags.prune && (
          <div className="flex items-center gap-3 border-b border-rule px-4 py-2.5">
            <span className="t-mono flex-none text-[10.5px] text-dim">propagation</span>
            <span className="ml-auto flex rounded-control ring-1 ring-rule" role="group">
              {POLICIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={flags.policy === p}
                  onClick={() => set('policy', p)}
                  className={`t-mono flex h-10 items-center rounded-segment px-2.5 text-[11px] ${
                    flags.policy === p ? 'text-text' : 'text-dim'
                  }`}
                  style={
                    flags.policy === p ? { boxShadow: 'inset 0 0 0 1px var(--edge-active)' } : undefined
                  }
                >
                  {p}
                </button>
              ))}
            </span>
          </div>
        )}
        <Toggle
          label="Dry run"
          note="validate only, change nothing"
          on={flags.dryRun}
          onChange={(v) => set('dryRun', v)}
        />
        <Toggle
          label="Apply only"
          note="skip hooks"
          on={flags.applyOnly}
          onChange={(v) => set('applyOnly', v)}
        />
        <Toggle
          label="Force"
          note="override conflicts"
          on={flags.force}
          onChange={(v) => set('force', v)}
        />

        {/* Native disclosure, native keyboard, no state. The band says how
            many are on, so a folded group never hides a decision. */}
        <details className="group mt-1.5">
          <summary
            className={band('cursor-pointer list-none [&::-webkit-details-marker]:hidden')}
          >
            how it applies
            <span className="ml-auto flex items-center gap-2 text-[11.5px] text-muted">
              {optionsOn > 0 ? `${optionsOn} on` : 'default'}
              <ChevronRight
                size={11}
                strokeWidth={1.5}
                className="transition-transform group-open:rotate-90"
                aria-hidden="true"
              />
            </span>
          </summary>
          {OPTIONS.map((o) => (
            <Toggle
              key={o.key}
              label={o.label}
              note={o.wire}
              on={flags[o.key]}
              onChange={(v) => set(o.key, v)}
            />
          ))}
        </details>

        <details className="group mt-1.5">
          <summary
            className={band('cursor-pointer list-none [&::-webkit-details-marker]:hidden')}
          >
            resources
            <span className="ml-auto flex items-center gap-2 text-[11.5px] text-muted">
              {chosen.length} of {total} selected
              <ChevronRight
                size={11}
                strokeWidth={1.5}
                className="transition-transform group-open:rotate-90"
                aria-hidden="true"
              />
            </span>
          </summary>
          <div className="flex items-center gap-2.5 border-b border-rule px-4 py-2.5">
            <span className="t-mono flex-none text-[10.5px] text-dim">select</span>
            <span className="ml-auto flex items-center">
              {(
                [
                  ['all', () => sorted],
                  ['out of sync', () => sorted.filter((r) => r.status === 'OutOfSync')],
                  ['none', () => []],
                ] as const
              ).map(([label, pick], i) => (
                <span key={label} className="flex items-center">
                  {i > 0 && <i className="sep" aria-hidden="true" />}
                  <button
                    type="button"
                    onClick={() => setPicked(new Set(pick().map(refKey)))}
                    className="t-mono px-0.5 py-2 text-[11.5px] text-muted"
                  >
                    {label}
                  </button>
                </span>
              ))}
            </span>
          </div>
          {sorted.map((r) => {
            const key = refKey(r)
            const on = picked.has(key)

            return (
              <button
                key={key}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() =>
                  setPicked((cur) => {
                    const next = new Set(cur)
                    if (!next.delete(key)) next.add(key)
                    return next
                  })
                }
                className="flex min-h-[54px] w-full items-center gap-3 border-b border-rule px-4 text-left"
              >
                <Box on={on} />
                <span className="min-w-0 flex-1">
                  <span className="t-mono block truncate text-[12px] leading-[1.25]">{r.name}</span>
                  <span className="t-mono mt-[3px] block truncate text-[10.5px] leading-[1.2] text-dim">
                    {r.group ? `${r.group}/${r.kind}` : r.kind}
                    {r.namespace ? ` · ${r.namespace}` : ''}
                  </span>
                </span>
                {/* The same circled check the resource list behind this sheet
                    draws, for the same reason: ten rows of the amber *words*
                    "out of sync" emphasise nothing and drown the checkbox,
                    which is the decision actually being made on this row. */}
                <span className="flex w-[14px] flex-none justify-end text-mark">
                  <Mark state={r.status} icon={CircleCheck} />
                </span>
              </button>
            )
          })}
          {total === 0 && (
            <p className="px-4 py-4 text-[12.5px] leading-snug text-muted">
              ArgoCD reports no managed resources for this application, so there is nothing to
              choose between. Synchronize applies to all of it.
            </p>
          )}
        </details>
      </div>

      {/* THE SUMMARY IS PART OF THE BUTTON. It is the only thing in this sheet
          that is always on screen, and it is the answer to "what am I about to
          do". Cancel is drawn in the ordinary hairline, Synchronize in the
          brighter one the design reserves for a control that acts. */}
      <div className="sticky bottom-0 -mx-4 border-t border-rule bg-panel px-4 pt-3 pb-1">
        <p
          className={`mb-3 text-[12px] leading-[1.35] ${!online ? 'text-outofsync' : 'text-muted'}`}
        >
          {!online ? (
            'Offline. Nothing can be sent until the phone is back on a network.'
          ) : verdict ? (
            /* ArgoCD's own words for what its dry run did. The phase is the
               one thing worth a colour here, and only when it is bad: this
               screen's red already means Degraded, and a dry run that failed
               is the same kind of news. */
            <>
              Dry run{' '}
              <b
                className={`font-normal ${verdict.phase === 'Succeeded' ? 'text-text' : 'text-degraded'}`}
              >
                {verdict.phase.toLowerCase()}
              </b>
              {verdict.message ? `: ${verdict.message}` : '.'} Nothing was changed.
            </>
          ) : waiting ? (
            `Dry run requested. ${instance} reports the outcome here when it has run it; nothing is changed either way.`
          ) : (
            summary
          )}
        </p>
        <div className="flex gap-2.5">
          <Button tone="faint" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-[1.5]"
            onClick={() => void submit()}
            disabled={!online || busy || (total > 0 && chosen.length === 0)}
          >
            {busy ? 'Sending…' : flags.dryRun ? 'Dry run' : 'Synchronize'}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
