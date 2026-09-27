import React from 'react'
import type { ChannelUi } from '../../adapter/channel/ui-policy.js'
import type { BalanceResult } from '../../deepseekBalance.js'

export type BtwState = { question: string; answer: string; error?: string; done: boolean }
export type RecapState = {
  raw: string
  summary: string
  title?: string
  error?: string
  done: boolean
  titleApplied: boolean
  auto?: boolean
  expanded?: boolean
  rowsAtTrigger?: number
}

/**
 * /btw side question, /recap (plus the recapOnOpen auto run), and /balance —
 * pure UI state that never enters the transcript or the session log.
 * Extracted verbatim from Chat; every effect keeps its original semantics
 * (session-switch retirement, auto-recap triggers, recap bow-out on a newer
 * user row).
 */
export function useSidePanels(channel: ChannelUi) {
  /** /btw side-question overlay: pure UI state — the answer never
   *  enters the transcript or the session log. */
  const [btw, setBtw] = React.useState<{ question: string; answer: string; error?: string; done: boolean } | null>(null)
  const btwAbortRef = React.useRef<AbortController | null>(null)
  const closeBtw = () => {
    btwAbortRef.current?.abort()
    btwAbortRef.current = null
    setBtw(null)
  }
  /** /recap overlay (pi-recap semantics): pure UI state like /btw — the
   *  summary never enters the transcript or session log; applying the
   *  proposed title goes through the normal /rename path. `auto` marks the
   *  recapOnOpen-triggered run (rendered as the dim AutoRecapRow until
   *  expanded); `expanded` lifts an auto recap into the full RecapPanel;
   *  `rowsAtTrigger` is the last user-row id when the auto run started —
   *  a newer user row (the user starts a new message) retires the recap. */
  const [recap, setRecap] = React.useState<{
    raw: string
    summary: string
    title?: string
    error?: string
    done: boolean
    titleApplied: boolean
    auto?: boolean
    expanded?: boolean
    rowsAtTrigger?: number
  } | null>(null)
  const recapAbortRef = React.useRef<AbortController | null>(null)
  const closeRecap = () => {
    recapAbortRef.current?.abort()
    recapAbortRef.current = null
    setRecap(null)
  }
  /** /balance report (`BalanceReportRow`): pure UI state like /recap — the
   *  result never enters the transcript or the session log. Clicking the row
   *  re-queries (refreshing keeps the stale summary visible); a session
   *  switch retires the report. */
  const [balance, setBalance] = React.useState<{
    result: BalanceResult | null
    refreshing: boolean
  } | null>(null)
  const balanceSeqRef = React.useRef(0)
  const runBalance = React.useCallback(() => {
    const seq = ++balanceSeqRef.current
    setBalance(prev => ({ result: prev?.result ?? null, refreshing: true }))
    void channel.balanceInfo().then(result => {
      if (balanceSeqRef.current !== seq) return
      setBalance({ result, refreshing: false })
    })
  }, [channel])
  const balanceSessionId = channel.agentId
  React.useEffect(() => {
    // Retire every in-flight /balance completion from the previous binding;
    // the balance seam has no UI session id in its readonly DTO.
    balanceSeqRef.current += 1
    setBalance(null)
  }, [balanceSessionId])
  // A side question belongs to its captured session just like a recap. Chat
  // remains mounted across /resume, so explicitly retire its request/UI when
  // the binding changes instead of allowing a former conversation to finish.
  React.useEffect(() => {
    btwAbortRef.current?.abort()
    btwAbortRef.current = null
    setBtw(null)
  }, [channel.agentId])
  // Auto-recap (`dsh-tui.recapOnOpen`): every time the session switches
  // (mount = open/resume, rewind/fork included), summarize its tail into
  // the dim AutoRecapRow. Failures stay silent in auto mode — `/recap`
  // surfaces them; the summary never enters the transcript or session log.
  const autoRecapSessionId = channel.agentId
  React.useEffect(() => {
    // A session switch retires the previous recap outright — an old
    // session's 回顾 has no place above a new conversation.
    setRecap(null)
    if (!channel.autoRecapOnOpen) return
    // No conversation yet (/new): nothing to recap, don't even fire.
    if (!channel.rows.some(row => row.kind === 'user' || row.kind === 'assistant')) return
    recapAbortRef.current?.abort()
    const controller = new AbortController()
    recapAbortRef.current = controller
    const lastUserId = channel.rows.filter(row => row.kind === 'user').at(-1)?.id ?? -1
    setRecap({ raw: '', summary: '', error: undefined, done: false, titleApplied: false, auto: true, expanded: false, rowsAtTrigger: lastUserId })
    void channel.recapRecent({
      signal: controller.signal,
      onText: delta => setRecap(prev => (prev ? { ...prev, raw: prev.raw + delta } : prev)),
    }).then(result => {
      if (controller.signal.aborted) return
      setRecap(prev => {
        if (prev === null || !prev.auto) return prev
        // Auto mode stays quiet on failure (no activity / llm missing / error).
        if (result.summary === null) return null
        return { ...prev, summary: result.summary, title: result.title, error: result.error, done: true }
      })
    }).catch(() => {
      if (!controller.signal.aborted) setRecap(null)
    })
    return () => controller.abort()
  }, [autoRecapSessionId])
  // The user starts a new message → the auto recap has served its purpose
  // (catching them up) and bows out. A newer user row is the signal; the
  // assistant's own streamed rows don't count.
  const lastUserRowId = channel.rows.filter(row => row.kind === 'user').at(-1)?.id ?? -1
  React.useEffect(() => {
    if (
      recap !== null &&
      recap.auto &&
      recap.rowsAtTrigger !== undefined &&
      lastUserRowId > recap.rowsAtTrigger
    ) {
      closeRecap()
    }
  }, [lastUserRowId, recap])
  return {
    btw,
    setBtw,
    btwAbortRef,
    closeBtw,
    recap,
    setRecap,
    recapAbortRef,
    closeRecap,
    balance,
    setBalance,
    runBalance,
  }
}
