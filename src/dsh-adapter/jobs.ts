import type { BackgroundJobStatus, BackgroundJobState } from '../adapter/ports/channel-view.js'
import { formatDuration } from '../terminal-utils/format.js'
export type { BackgroundJobStatus, BackgroundJobState } from '../adapter/ports/channel-view.js'


/**
 * Structural mirror of the registry's `JobSnapshot` — only the fields the
 * UI reads. Declared locally so no `@deepseek-ai/dsh-jobs` dependency (peer
 * range churn) is introduced; the harness service satisfies this shape.
 */
export interface BackgroundJobSnapshot {
  /** Registry-issued id (`<kind>-N`, e.g. `pwsh-3`). */
  id: string
  /** Producer kind (`bash`, `pwsh`, `subagent`, `pty-send`, …). */
  kind: string
  /** One-line label — the command or delegation description. */
  label: string
  status: BackgroundJobStatus
  /** Kind-specific status detail, usually terminal ('exit code: 0'). */
  detail?: string
  /** Epoch ms when the job was registered. */
  startedAt: number
  /** Epoch ms when the job settled; absent while running/stopping. */
  finishedAt?: number
}

/**
 * Duck-typed registry surface the channel consumes. `caller` is an opaque
 * token — the owning live agent (`Agent` in the harness) or the session id
 * under the registry service shape — typed unknown because the UI only
 * forwards the instance it already holds and never inspects it.
 */
export interface JobsRuntime {
  /** Caller-owned + unowned job snapshots in registration order. */
  list(caller?: unknown): BackgroundJobSnapshot[]
  /** Request cancellation by id; resolves to 'requested'/'already-finished'. */
  kill(id: string, caller?: unknown, reason?: string): unknown
  /** Fires after every commit changing one owner's visible set; re-read. */
  onJobsChanged?(listener: (owner: unknown) => void): () => void
  /** Fires on every settlement with the terminal snapshot + owner. */
  onJobDone?(listener: (snapshot: BackgroundJobSnapshot, owner: unknown) => void): () => void
}

/** Store event hooks the channel injects (toast on settle, emit on change). */
export interface BackgroundJobEvents {
  /** A job the store knew live just settled (or vanished mid-flight). */
  onSettled?(job: BackgroundJobState): void
  /** The visible set changed; the channel syncs rows and emits. */
  onChanged?(): void
  /** Ids that fell past the tracked bound (oldest terminal first). Their
   *  transcript cards stay — durable history — but the channel's
   *  row-index entries for the ids can go, keeping the index bounded by
   *  the live window instead of the session's job count. */
  onEvicted?(ids: readonly string[]): void
}

/** Total tracked jobs kept (running plus most recent terminal ones). */
export const JOBS_MAX_TRACKED = 40
/** Output tail lines retained per job (the card waterfall shows the last 3;
 *  the /jobs panel detail shows the whole retained tail). */
export const JOBS_MAX_OUTPUT_LINES = 30
/** A `job_output` result's trailing status suffix — never a waterfall line. */
const STATUS_SUFFIX_PATTERN = /^\s*\[status:\s/

function isTerminal(status: BackgroundJobStatus): boolean {
  return status === 'completed' || status === 'killed' || status === 'failed'
}

/**
 * Ordered store of the current conversation's background jobs. Fed by
 * {@link BackgroundJobStore.replace} with a fresh `list()` after every
 * `onJobsChanged` commit, and by {@link BackgroundJobStore.onOutputSeen}
 * with the tail of every `job_output` tool result. Emits no React state of
 * its own — the channel wires the events into its version bump, exactly
 * like the subagent projection.
 */
export class BackgroundJobStore {
  private readonly jobs = new Map<string, BackgroundJobState>()
  /**
   * Job ids the MODEL has seen: a `started background job <id>` ack or a
   * promoted `[... moved to background job <id>]` result. The registry
   * registers EVERY foreground wait too, so without this gate each quick
   * foreground command (git status, ls) would grow a job card — grok
   * semantics show background-task UI only once the call actually moved
   * to the background.
   */
  private readonly acked = new Set<string>()
  /** Un-acked registry rows, kept so a late ack can still promote them. */
  private readonly shadow = new Map<string, BackgroundJobSnapshot>()
  /** Ids a shadow trim rejected — they stay un-tracked even once acked
   *  (the eviction contract), until the bound recycles the oldest mark. */
  private readonly shadowDenied = new Set<string>()
  /** Commands captured from start acks that arrived before the registry
   *  registered the job (the tool/result stream and the registry commit can
   *  race); consumed on registration. */
  private readonly pendingCommands = new Map<string, string>()

  constructor(private readonly events: BackgroundJobEvents = {}) {}

  /**
   * Diff a fresh `list()` against the tracked set: register new jobs, fold
   * status/detail transitions, and fire `onSettled` for live→terminal moves.
   * Jobs that vanish while live were teardown-cancelled (session swap /
   * owner disposal) and are frozen as `killed` and KEPT as recent history —
   * their transcript rows freeze at a sensible terminal state instead of
   * ticking on, and the panel keeps them alongside other finished work
   * (the tracked bound below trims the oldest terminals).
   */
  replace(snapshots: readonly BackgroundJobSnapshot[]): void {
    const seen = new Set<string>()
    let changed = false
    for (const snap of snapshots) {
      seen.add(snap.id)
      const prev = this.jobs.get(snap.id)
      if (prev === undefined) {
        // Un-acked rows stay shadowed (no ChatRow, no panel entry, no
        // history): a foreground wait the model never saw as a job.
        // Capacity-denied ids stay un-tracked even once acked — the trim
        // decided this row's history ends here, so a parked early ack must
        // not build it back from a later snapshot.
        if (this.shadowDenied.has(snap.id)) continue
        if (!this.acked.has(snap.id)) {
          this.shadow.set(snap.id, snap)
          continue
        }
        const command = this.pendingCommands.get(snap.id)
        if (command !== undefined) this.pendingCommands.delete(snap.id)
        this.jobs.set(snap.id, {
          id: snap.id,
          kind: snap.kind,
          label: snap.label,
          ...(command === undefined ? {} : { command }),
          status: snap.status,
          ...(snap.detail === undefined ? {} : { detail: snap.detail }),
          startedAt: snap.startedAt,
          ...(snap.finishedAt === undefined ? {} : { finishedAt: snap.finishedAt }),
          outputLines: [],
        })
        changed = true
        continue
      }
      if (
        prev.status === snap.status &&
        prev.detail === snap.detail &&
        prev.label === snap.label &&
        prev.finishedAt === snap.finishedAt
      ) continue
      const wasLive = !isTerminal(prev.status)
      prev.status = snap.status
      prev.label = snap.label
      if (snap.detail === undefined) delete prev.detail
      else prev.detail = snap.detail
      if (snap.finishedAt === undefined) delete prev.finishedAt
      else prev.finishedAt = snap.finishedAt
      changed = true
      if (wasLive && isTerminal(snap.status)) this.events.onSettled?.(prev)
    }
    for (const job of this.jobs.values()) {
      if (seen.has(job.id) || isTerminal(job.status)) continue
      job.status = 'killed'
      job.finishedAt = Date.now()
      this.events.onSettled?.(job)
      changed = true
    }
    // Shadowed foreground waits that vanished were settled-and-removed by
    // the tool layer before any ack: leave without a trace. The parked
    // command goes with it — the entry would otherwise wait forever for an
    // ack that can no longer arrive.
    if (this.shadow.size > 0) {
      for (const id of this.shadow.keys()) {
        if (!seen.has(id)) {
          this.shadow.delete(id)
          this.pendingCommands.delete(id)
        }
      }
    }
    // Shadow capacity mirrors the tracked bound, with the same preference:
    // terminal entries trim first and live ones always survive. Replay can
    // park one terminal entry per historical id the live registry will
    // never register again; un-acked waits must not accumulate without
    // limit. The denied mark keeps the eviction contract: an ack parked
    // before the trim must not build the dropped row back later, and the
    // mark set itself stays bounded (insertion order recycles the oldest).
    if (this.shadow.size > JOBS_MAX_TRACKED) {
      for (const [id, snap] of this.shadow) {
        if (this.shadow.size <= JOBS_MAX_TRACKED) break
        if (isTerminal(snap.status)) {
          this.shadow.delete(id)
          this.pendingCommands.delete(id)
          this.shadowDenied.add(id)
        }
      }
      if (this.shadowDenied.size > JOBS_MAX_TRACKED) {
        for (const id of this.shadowDenied) {
          if (this.shadowDenied.size <= JOBS_MAX_TRACKED) break
          this.shadowDenied.delete(id)
        }
      }
    }
    if (this.jobs.size > JOBS_MAX_TRACKED) {
      // Drop the oldest terminal jobs first; live jobs always survive.
      // The ack gate must go with the row: jobs-local never removes settled
      // jobs, so a retained ack would re-register the evicted id from the
      // next `list()` snapshot (at the Map tail — the newest-last order
      // invariant breaks and the revived row lost its outputLines).
      const evicted: string[] = []
      for (const [id, job] of this.jobs) {
        if (this.jobs.size <= JOBS_MAX_TRACKED) break
        if (isTerminal(job.status)) {
          this.jobs.delete(id)
          this.acked.delete(id)
          evicted.push(id)
          changed = true
        }
      }
      if (evicted.length > 0) this.events.onEvicted?.(evicted)
    }
    if (changed) this.events.onChanged?.()
  }

  /**
   * Record the full command that started a job, captured from its tool
   * call's args via the `started background job <id>` ack. May arrive
   * before the registry registers the job — the command is parked and
   * consumed by the next replace().
   */
  onStarted(id: string, command: string): void {
    // Capacity-denied: no row exists and none may be built — parking the
    // command would wait forever for a promotion that can no longer happen.
    if (this.shadowDenied.has(id)) return
    this.acked.add(id)
    const job = this.jobs.get(id)
    if (job !== undefined) {
      if (job.command !== command) {
        job.command = command
        this.events.onChanged?.()
      }
      return
    }
    // The ack promotes a shadowed foreground wait into a visible job
    // (promoted-to-background or explicit run_in_background).
    const shadowed = this.shadow.get(id)
    if (shadowed !== undefined) {
      this.shadow.delete(id)
      this.jobs.set(id, {
        id: shadowed.id,
        kind: shadowed.kind,
        label: shadowed.label,
        command,
        status: shadowed.status,
        ...(shadowed.detail === undefined ? {} : { detail: shadowed.detail }),
        startedAt: shadowed.startedAt,
        ...(shadowed.finishedAt === undefined ? {} : { finishedAt: shadowed.finishedAt }),
        outputLines: [],
      })
      // A late-ack batch can promote past the tracked bound; apply the same
      // oldest-terminal-first trim replace() uses (live jobs always
      // survive). The ack gate goes with the row or the evicted id would
      // re-register from the next `list()` snapshot (revival loop).
      if (this.jobs.size > JOBS_MAX_TRACKED) {
        const evicted: string[] = []
        for (const [trimId, trimJob] of this.jobs) {
          if (this.jobs.size <= JOBS_MAX_TRACKED) break
          if (isTerminal(trimJob.status)) {
            this.jobs.delete(trimId)
            this.acked.delete(trimId)
            evicted.push(trimId)
          }
        }
        if (evicted.length > 0) this.events.onEvicted?.(evicted)
      }
      this.events.onChanged?.()
      return
    }
    this.pendingCommands.set(id, command)
  }

  /**
   * Mirror the tail of a `job_output` tool result for one job. Appends
   * non-empty lines (excluding the tool's `[status: …]` suffix) and keeps
   * the bounded tail. This is the ONLY output feed — the registry's read is
   * consuming and reserved for the owning agent.
   * @param at - wall-clock receipt time of the read (defaults to now).
   */
  onOutputSeen(id: string, text: string, at = Date.now()): void {
    const job = this.jobs.get(id)
    if (job === undefined || text === '') return
    const lines = text
      .split(/\r?\n/)
      .map(line => line.replace(/\s+$/, ''))
      .filter(line => line !== '' && !STATUS_SUFFIX_PATTERN.test(line))
    if (lines.length === 0) return
    job.outputLines = [...job.outputLines, ...lines].slice(-JOBS_MAX_OUTPUT_LINES)
    job.lastOutputAt = at
    this.events.onChanged?.()
  }

  /** A fresh snapshot in registration order (newest tracked job last). */
  snapshot(): readonly BackgroundJobState[] {
    return [...this.jobs.values()]
  }

  get(id: string): BackgroundJobState | undefined {
    return this.jobs.get(id)
  }

  /** Jobs still alive (running or being stopped). */
  runningCount(): number {
    let count = 0
    for (const job of this.jobs.values()) {
      if (!isTerminal(job.status)) count += 1
    }
    return count
  }

  /** Drop everything (session swap / transcript wipe / registry reload). */
  reset(): void {
    if (this.jobs.size === 0 && this.shadow.size === 0 && this.acked.size === 0 && this.pendingCommands.size === 0 && this.shadowDenied.size === 0) return
    this.jobs.clear()
    this.shadow.clear()
    this.acked.clear()
    this.pendingCommands.clear()
    this.shadowDenied.clear()
    this.events.onChanged?.()
  }
}

/** Transcript-card compact duration for one job (single source: formatDuration). */
export function formatJobDuration(job: Pick<BackgroundJobState, 'startedAt' | 'finishedAt'>, now = Date.now()): string {
  return formatDuration((job.finishedAt ?? now) - job.startedAt)
}
