import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Play } from 'lucide-react'
import { Sheet } from './Sheet'
import { api, argoPath } from '../api/client'
import { useInstances } from '../api/queries'
import { listResourceActions, resourceParams, runResourceAction } from '../api/actions'
import { streamLogs } from '../lib/logs'
import { useOnline } from '../lib/online'
import { toast } from '../lib/toast'
import { Button, KindIcon, StatusBadge } from './ui'
import type { InstanceInfo, ResourceNode } from '../api/types'

/** "Live manifest", not "Manifest". There are two manifest views in this app
 * now and they answer opposite questions: this one is the object as the
 * cluster has it this second, `ManifestsSheet` is what Git renders for the
 * whole application. One word stops the two being confused. */
const TABS = ['Logs', 'Live manifest'] as const

export function ResourceSheet({
  node,
  instance,
  app,
  onClose,
}: {
  node: ResourceNode
  instance: string
  app: string
  onClose: () => void
}) {
  const isPod = node.kind === 'Pod'
  const [tab, setTab] = useState<(typeof TABS)[number]>(isPod ? 'Logs' : 'Live manifest')

  return (
    <Sheet open onClose={onClose} title={node.name} icon={<KindIcon kind={node.kind} />}>
      {/* The sheet's own title is the resource name; repeating it in a card
          underneath is the duplication this rebuild exists to remove. One
          line carries what the title does not: where it lives and how it is. */}
      <div className="flex flex-wrap items-center gap-2">
        {node.health?.status && <StatusBadge state={node.health.status} />}
        <span className="t-mono min-w-0 truncate text-[11.5px] text-muted">
          {instance}
          <i className="sep" aria-hidden="true" />
          {node.kind} in {node.namespace || 'cluster-scope'}
        </span>
      </div>
      {node.health?.message && (
        <p className="mt-2 px-3 py-2 text-[12.5px] leading-snug text-degraded ring-1 ring-degraded/45">
          {node.health.message}
        </p>
      )}

      {/* WHAT CAN BE DONE TO IT, above what can be read about it — the same
          order the detail screen behind this sheet puts them in: identity,
          facts, the buttons, then the list you scroll. Below the tabs it
          would sit under a log pane half the height of the phone, which is a
          hiding place. */}
      <Actions instance={instance} app={app} node={node} />

      <div className="mt-3 flex gap-2">
        {TABS.filter((t) => t !== 'Logs' || isPod).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`flex h-11 items-center rounded-pill px-3.5 text-[14px] ${
              tab === t ? 'text-text ring-1 ring-rule' : 'text-muted'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {tab === 'Logs' && isPod && <Logs instance={instance} app={app} node={node} />}
        {tab === 'Live manifest' && <Manifest instance={instance} app={app} node={node} />}
      </div>

    </Sheet>
  )
}

/**
 * What ArgoCD's shipped actions actually do, in the language the rest of this
 * app speaks. An action is one tap and there is no undo, so the row says what
 * the word means rather than leaving `promote-full` to be guessed at.
 *
 * Deliberately not exhaustive: an instance can carry any Lua action an
 * administrator wrote, and inventing a description for a name we have never
 * seen would be worse than saying nothing. An unknown action is drawn as its
 * name alone.
 */
const NOTES: Record<string, string> = {
  restart: 'roll every pod',
  pause: 'stop the rollout where it is',
  resume: 'let the rollout continue',
  suspend: 'stop the schedule firing',
  'create-job': 'run the job now',
  'promote-full': 'finish the rollout at once',
  refresh: 'fetch it from the store again',
}

/**
 * THE GUARDRAIL, AND WHICH WAY IT FAILS.
 *
 * `production` is a per-instance flag and it arrives with `useInstances()`,
 * which is a fetch like any other: it can be in flight, it can have failed,
 * and a deep link straight into a resource sheet is exactly the path where it
 * has not resolved yet. An earlier production check in this app read
 * `?.production` and defaulted to false, so the guardrail was absent for as
 * long as the data was missing — it looked like a guard and protected
 * nothing.
 *
 * So this asks the opposite question. Confirmation is skipped only when the
 * instance list has arrived AND names this instance AND says it is not
 * production. Anything else — still loading, the fetch failed, the name is
 * not in the list — confirms, and says *why* it is asking, because "orders is
 * marked production" is a claim and we do not have it yet.
 */
export function confirmReason(
  instances: InstanceInfo[] | undefined,
  instance: string,
): 'production' | 'unknown' | null {
  const found = instances?.find((i) => i.name === instance)
  if (!found) return 'unknown'
  return found.production ? 'production' : null
}

/**
 * The actions for one resource, and the three answers this section has to be
 * able to give plainly.
 *
 * **None** is the common answer, not a failure: a Pod, a Service and a
 * ConfigMap offer nothing, and most of a resource tree is those. It is said
 * in a sentence under the band rather than by drawing an empty box or by
 * dropping the section, because a section that is sometimes absent teaches
 * the operator to wonder whether it failed to load.
 *
 * **Disabled** is the third state: offered for this kind, refused right now.
 * The row is drawn, dimmed, and says so — hiding it would make the action
 * set look different from one moment to the next.
 *
 * Nothing here is coloured. Colour in this app means an ArgoCD state, and a
 * destructive button is not a state.
 */
function Actions({ instance, app, node }: { instance: string; app: string; node: ResourceNode }) {
  const online = useOnline()
  const qc = useQueryClient()
  const instances = useInstances()
  const [pending, setPending] = useState('')
  const [busy, setBusy] = useState('')

  const params = resourceParams(node)
  const q = useQuery({
    queryKey: ['actions', instance, app, node.kind, node.namespace, node.name],
    queryFn: () => listResourceActions(instance, app, params),
    // The set is a property of the kind, not of the moment; it does not join
    // the 30s poll any more than the manifest beside it does.
    refetchInterval: false,
  })
  const actions = q.data?.actions ?? []
  const reason = confirmReason(instances.data, instance)

  async function run(name: string) {
    setPending('')
    setBusy(name)
    try {
      await runResourceAction(instance, app, params, name)
      await Promise.all([
        // The action set itself, because `disabled` is a statement about now:
        // a Rollout that has just been paused is one whose `resume` has
        // stopped being greyed out.
        qc.invalidateQueries({ queryKey: ['actions', instance, app] }),
        qc.invalidateQueries({ queryKey: ['tree', instance, app] }),
        qc.invalidateQueries({ queryKey: ['app', instance, app] }),
        qc.invalidateQueries({ queryKey: ['apps'] }),
      ])
      // The receipt names all four things a later "did I do that?" needs: the
      // action, the resource, the instance and the application.
      toast('ok', `${name} requested`, `${instance} ran ${name} on ${node.kind} ${node.name}.`)
    } catch (e) {
      // ArgoCD answers 400 for an action it does not offer and for one it has
      // disabled since this list was read, so the message is worth keeping on
      // screen: it is the difference between "wrong kind" and "not now".
      toast('fail', 'That did not go through', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="-mx-4 mt-3.5" role="group" aria-label="Actions">
      <div className="t-mono flex h-10 items-center gap-3 bg-band px-4 text-[12px]">actions</div>

      {q.isLoading ? (
        <div className="flex h-[54px] items-center border-b border-rule px-4" aria-hidden="true">
          <span className="skel h-2.5 w-[34%]" />
        </div>
      ) : q.isError ? (
        <p className="border-b border-rule px-4 py-3 text-[12.5px] leading-snug text-degraded">
          Could not read the actions for this resource: {String(q.error)}
        </p>
      ) : actions.length === 0 ? (
        <p className="border-b border-rule px-4 py-3 text-[12.5px] leading-snug text-muted">
          ArgoCD offers no actions for a {node.kind}. Most kinds have none — this is the ordinary
          case, not a failure to load.
        </p>
      ) : pending ? (
        /* THE CONFIRMATION, in place of the list, exactly where the thumb
           already is. The Synchronize sheet is long on purpose and that
           length is its confirmation; an action has no length at all, so on
           an instance that matters it borrows the same two hairline buttons
           and one sentence of prose. Full ink rather than a colour: in this
           design the exception is heavier, never brighter. */
        <div className="border-b border-rule px-4 py-3.5">
          <p className="text-[13px] leading-[1.35] text-text">
            Run <b className="t-mono font-normal">{pending}</b> on {node.kind} {node.name}?{' '}
            {reason === 'production'
              ? `${instance} is marked production.`
              : `MazeCD cannot tell yet whether ${instance} is production, so it is asking.`}{' '}
            It runs immediately and there is no undo.
          </p>
          <div className="mt-3 flex gap-2.5">
            <Button tone="faint" className="flex-1" onClick={() => setPending('')}>
              Cancel
            </Button>
            <Button className="flex-[1.5]" onClick={() => void run(pending)} disabled={!online}>
              Run {pending}
            </Button>
          </div>
        </div>
      ) : (
        actions.map((a) => (
          <button
            key={a.name}
            type="button"
            disabled={a.disabled || !online || busy !== ''}
            onClick={() => (reason ? setPending(a.name) : void run(a.name))}
            className="flex min-h-[54px] w-full items-center gap-3 border-b border-rule px-4 text-left disabled:opacity-40"
          >
            {/* The glyph sits in the column the sync sheet's checkbox holds,
                so a row that acts and a row that chooses read as the same
                grammar. */}
            <Play size={13} strokeWidth={1.4} className="flex-none text-mark" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="t-mono block truncate text-[13px] leading-[1.25]">{a.name}</span>
              {NOTES[a.name] && (
                <span className="mt-[3px] block truncate text-[11px] leading-[1.2] text-dim">
                  {NOTES[a.name]}
                </span>
              )}
            </span>
            <span className="t-mono flex-none text-[11px] text-dim">
              {busy === a.name ? 'running…' : a.disabled ? 'not available' : ''}
            </span>
          </button>
        ))
      )}
    </div>
  )
}

function Logs({ instance, app, node }: { instance: string; app: string; node: ResourceNode }) {
  const [lines, setLines] = useState<string[]>([])
  const [error, setError] = useState('')
  const [container, setContainer] = useState('')
  const [filter, setFilter] = useState('')
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    setLines([])
    setError('')
    streamLogs({
      instance,
      app,
      node,
      container: container || undefined,
      // Keep memory bounded: a chatty pod can emit thousands of lines a minute.
      onLine: (l) => setLines((cur) => (cur.length > 2000 ? [...cur.slice(-1500), l] : [...cur, l])),
      signal: ctrl.signal,
    }).catch((e) => {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e))
    })
    return () => ctrl.abort()
  }, [instance, app, node, container])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [lines])

  const shown = filter ? lines.filter((l) => l.toLowerCase().includes(filter.toLowerCase())) : lines

  return (
    <div>
      <div className="flex gap-2">
        <input
          value={container}
          onChange={(e) => setContainer(e.target.value)}
          placeholder="Container"
          aria-label="Container"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="t-mono h-11 min-w-0 flex-1 rounded-control bg-inset px-3 text-[13px] outline-none placeholder:font-sans placeholder:text-muted focus:bg-raised"
        />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter lines"
          aria-label="Filter lines"
          className="h-11 min-w-0 flex-1 rounded-control bg-inset px-3 text-[13px] outline-none placeholder:text-muted focus:bg-raised"
        />
      </div>
      {error && (
        <p className="mt-2 text-[14px] leading-snug text-degraded">Log stream stopped: {error}</p>
      )}
      <pre className="t-mono mt-2 max-h-[50dvh] overflow-auto rounded-control bg-ink p-3 text-[11px] leading-relaxed">
        {shown.join('\n') || (error ? '' : filter ? 'No line matches that filter.' : 'Waiting for output…')}
        <div ref={bottom} />
      </pre>
    </div>
  )
}

function Manifest({ instance, app, node }: { instance: string; app: string; node: ResourceNode }) {
  const q = useQuery({
    queryKey: ['resource', instance, app, node.kind, node.namespace, node.name],
    queryFn: () =>
      api.get<{ manifest?: string }>(
        argoPath(instance, `applications/${app}/resource?${resourceParams(node)}`),
      ),
    refetchInterval: false,
  })
  if (q.isLoading)
    return (
      <div className="flex flex-col gap-1.5 rounded-control bg-ink p-3" aria-hidden="true">
        {['72%', '54%', '88%', '40%', '66%', '78%', '48%'].map((w, i) => (
          <span key={i} className="skel h-2.5" style={{ width: w }} />
        ))}
      </div>
    )
  if (q.isError)
    return (
      <p className="text-[14px] leading-snug text-degraded">
        Could not read the manifest: {String(q.error)}
      </p>
    )
  return (
    <pre className="t-mono max-h-[50dvh] overflow-auto rounded-control bg-ink p-3 text-[11px] leading-relaxed text-muted">
      {q.data?.manifest ?? ''}
    </pre>
  )
}
