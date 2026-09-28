import type { Agent } from '@deepseek-ai/dsh-agent'
import { markChannelReadDirty } from '../../adapter/channel/read-view.js'
import { t } from '../../i18n.js'
import { BackgroundJobStore, formatJobDuration, type JobsRuntime } from '../jobs.js'
import type { ChannelOwner } from './owner.js'
import type { ChannelState, ChatRow, JobControl } from './types.js'

/**
 * Current-binding background-job projection. The registry can publish every
 * owner's changes, so callbacks must prove their attachment and Channel owner
 * are still current before they read a service or mutate projected rows.
 */
export function createJobProjection(
  getState: () => Pick<ChannelState, 'backgroundJobs' | 'rows' | 'emit'>,
  deps: {
    owner: Pick<ChannelOwner, 'current' | 'own'>
    notify(text: string, options?: { color?: 'success' | 'error' | 'warning'; timeoutMs?: number }): unknown
    rowIds: { value: number }
    agent(): Agent
    steer(text: string): void
  },
) {
  const jobRowsByJobId = new Map<string, ChatRow>()
  let jobsRuntime: JobsRuntime | undefined
  let detachActive: (() => void) | undefined
  let attachmentToken: symbol | undefined
  let attachmentCurrent = (): boolean => false
  // Identity of the registry the store was last fed by. A jobs-service
  // reload restarts its id counter from `<kind>-1`; without a generation
  // cut the old cycle's acked ids would instantly promote the new cycle's
  // foreground waits into visible job cards (and kill()/output would hit
  // the wrong, reused ids).
  let attachedRegistry: unknown

  const syncRows = (): void => {
    if (!attachmentCurrent()) return
    const state = getState()
    state.backgroundJobs = store.snapshot()
    for (const job of state.backgroundJobs) {
      let row = jobRowsByJobId.get(job.id)
      if (!row) {
        row = { id: deps.rowIds.value++, kind: 'job', text: job.label, job: undefined }
        jobRowsByJobId.set(job.id, row)
        state.rows.push(row)
      }
      row.job = {
        id: job.id,
        kind: job.kind,
        label: job.label,
        status: job.status,
        ...(job.detail === undefined ? {} : { detail: job.detail }),
        startedAt: job.startedAt,
        ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
        outputLines: job.outputLines,
      }
      row.text = job.label
      markChannelReadDirty(row)
      markChannelReadDirty(state.rows)
    }
  }

  const store = new BackgroundJobStore({
    onSettled(job) {
      deps.notify(
        t(job.status === 'completed' ? 'jobs-toast-completed' : job.status === 'failed' ? 'jobs-toast-failed' : 'jobs-toast-killed', {
          id: job.id,
          label: job.label,
          duration: formatJobDuration(job),
          detail: job.detail ?? '',
        }),
        { color: job.status === 'completed' ? 'success' : job.status === 'failed' ? 'error' : 'warning', timeoutMs: 6000 },
      )
    },
    onChanged() {
      if (!attachmentCurrent()) return
      syncRows()
      if (attachmentCurrent()) getState().emit()
    },
  })

  const control: JobControl = {
    kill(id) {
      const jobs = jobsRuntime
      if (!jobs?.kill) return false
      const job = store.get(id)
      try {
        bridgeOf(jobs).kill(id, 'dsh-tui /jobs panel')
      } catch {
        return false
      }
      if (job !== undefined && (job.status === 'running' || job.status === 'stopping')) {
        deps.steer(t('jobs-steer-killed', { id, label: job.label }))
      }
      return true
    },
  }

  /**
   * The host exposes the registry service shape (@deepseek-ai/dsh-jobs):
   * `list/kill(caller?: SessionId)` keyed by session id, plus
   * `events.subscribe(filter, listener)` for change delivery. The legacy
   * duck-typed shape (Agent-instance caller + onJobsChanged/onJobDone) is
   * still served — the bridge picks per call so a mixed embedder works.
   * Passing the Agent instance where the registry expects a SessionId
   * filtered every owned job out of `list()` (empty Task Center panel).
   */
  function bridgeOf(jobs: JobsRuntime): {
    list(): unknown[]
    kill(id: string, reason?: string): unknown
    subscribe(onChange: () => void): (() => void) | undefined
  } {
    const registry = jobs as unknown as {
      list?(caller?: string): unknown[]
      kill?(id: string, caller?: string, reason?: string): unknown
      events?: { subscribe?(filter: { owners: 'all' }, listener: () => void): () => void }
    }
    const sessionId = (): string | undefined => {
      const id = (deps.agent() as { id?: unknown } | undefined)?.id
      return typeof id === 'string' ? id : undefined
    }
    return {
      list() {
        if (typeof registry.list === 'function') return registry.list(sessionId()) ?? []
        return (jobs.list(deps.agent()) ?? []) as unknown[]
      },
      kill(id, reason) {
        if (typeof registry.kill === 'function') return registry.kill(id, sessionId(), reason)
        return jobs.kill?.(id, deps.agent(), reason)
      },
      subscribe(onChange) {
        const subscribe = registry.events?.subscribe
        if (typeof subscribe === 'function') return subscribe.call(registry.events, { owners: 'all' }, onChange)
        // Legacy duck-type serves two mouths — onJobsChanged for mutations,
        // onJobDone for settlements — and embedders may provide either or
        // both, so register each optional mouth and combine their disposers.
        // A single exclusive branch here would silently drop the other
        // mouth's deliveries (and the settlement toast with it). The pair is
        // transactional: a throwing second registration unwinds the first.
        const disposers: Array<(() => void) | undefined> = []
        try {
          if (typeof jobs.onJobsChanged === 'function') disposers.push(jobs.onJobsChanged(onChange))
          if (typeof jobs.onJobDone === 'function') disposers.push(jobs.onJobDone(onChange))
        } catch (error) {
          for (const dispose of disposers.splice(0)) dispose?.()
          throw error
        }
        if (disposers.length === 0) return undefined
        return () => { for (const dispose of disposers.splice(0)) dispose?.() }
      },
    }
  }

  /**
   * Each service attachment has one idempotent disposer, dual-owned by the
   * Channel and (when injected) the service context. Reattachment revokes the
   * prior token before the replacement may synchronously publish.
   */
  const attach = (jobs: JobsRuntime | undefined, ownService?: (dispose: () => void) => void): void => {
    if (jobs === undefined) return
    detachActive?.()
    // Reattaching the SAME registry (service-context remount) keeps the
    // tracked history; a different registry instance is a new generation —
    // drop the old cycle entirely so reused ids cannot alias old state.
    // reset() itself stays delivery-silent here (the attachment token is
    // still unpublished), so the ghost rows are dropped by hand.
    // Reattaching the SAME registry (service-context remount) keeps the
    // tracked history. A different registry instance is a new generation —
    // drop the old cycle entirely so reused ids cannot alias old state.
    // The genesis attach (undefined -> registry) is NOT a generation cut:
    // the service injection can resolve after the first tool-result acks
    // already parked in the store, and those must survive.
    // reset() itself stays delivery-silent here (the attachment token is
    // still unpublished), so the ghost rows are dropped by hand.
    if (attachedRegistry !== undefined && attachedRegistry !== jobs) {
      store.reset()
      jobRowsByJobId.clear()
      const state = getState()
      for (let index = state.rows.length - 1; index >= 0; index -= 1) {
        if (state.rows[index]?.kind === 'job') state.rows.splice(index, 1)
      }
      state.backgroundJobs = []
    }
    attachedRegistry = jobs
    jobsRuntime = jobs
    const token = Symbol('jobs-attachment')
    let detached = false
    let detach: () => void
    const current = (): boolean => !detached && attachmentToken === token && detachActive === detach && jobsRuntime === jobs && deps.owner.current()
    const refresh = (): void => {
      // Check before list(): retained callbacks must not touch a revoked or
      // replaced service, nor invoke any store/row work after owner disposal.
      if (!current()) return
      try {
        const snapshot = bridgeOf(jobs).list() as ReturnType<BackgroundJobStore['snapshot']>
        if (!current()) return
        store.replace(snapshot)
      } catch { /* optional service is disposing */ }
    }
    // Publish the attachment identity before subscription: registries are
    // allowed to synchronously deliver their current snapshot from on*().
    // Every registration below is transactional because a second on*() can
    // throw after the first one successfully subscribed.
    const disposers: Array<(() => void) | undefined> = []
    let releaseOwner: (() => void) | undefined
    detach = (): void => {
      if (detached) return
      detached = true
      if (detachActive === detach) {
        detachActive = undefined
        attachmentToken = undefined
        attachmentCurrent = () => false
      }
      if (jobsRuntime === jobs) jobsRuntime = undefined
      for (const dispose of disposers.splice(0)) dispose?.()
      // A service-context detach happens before channel teardown on remount;
      // release its Channel owner entry now rather than retaining one cleanup
      // per remount until the entire channel exits.
      const release = releaseOwner
      releaseOwner = undefined
      release?.()
    }
    detachActive = detach
    attachmentToken = token
    attachmentCurrent = current
    try {
      const subscription = bridgeOf(jobs).subscribe(refresh)
      if (subscription !== undefined) disposers.push(subscription)
      releaseOwner = deps.owner.own(detach)
      ownService?.(detach)
      refresh()
    } catch (error) {
      detach()
      throw error
    }
  }

  const dropRows = (): void => { jobRowsByJobId.clear() }
  const reset = (): void => { dropRows(); store.reset() }

  return { store, control, attach, dropRows, reset }
}
