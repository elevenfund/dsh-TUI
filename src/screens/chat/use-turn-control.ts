import React from 'react'
import { t } from '../../i18n.js'
import type { ChannelUi } from '../../adapter/channel/ui-policy.js'
import type { ScrollBoxHandle } from '../../ui.js'

/**
 * Turn-control trio: the double-Ctrl+C exit funnel, the global
 * turn-interrupt (upgradeable to exit while a cancel is still pending),
 * the transcript page step, and the spinner timing refs fed from channel
 * state each render. Extracted verbatim from Chat.
 */
export function useTurnControl(channel: ChannelUi, onExit: () => void, handle: ScrollBoxHandle | null) {
  const exitPendingRef = React.useRef(false)
  const exitTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestExit = () => {
    if (exitPendingRef.current) {
      onExit()
    } else {
      exitPendingRef.current = true
      channel.notify(t('exit-press-again'))
      exitTimerRef.current = setTimeout(() => {
        exitPendingRef.current = false
      }, 3000)
    }
  }
  /**
   * Ctrl+C on a running turn, shared by every focus state (composer,
   * selection mode, overlay cards) so the interrupt is reachable from
   * anywhere — grok keeps this key global the same way. A still-
   * converging cancel (cancelPending) upgrades the next press to the exit
   * funnel: a stuck turn must not swallow every Ctrl+C forever.
   */
  const interruptRunningTurn = () => {
    if (channel.cancelPending) {
      onExit()
    } else {
      channel.cancel()
      // Interrupt replaces any previously armed exit: the next press must
      // re-confirm instead of exiting out from under the turn.
      exitPendingRef.current = false
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
    }
  }
  /**
   * Page size for transcript paging (PgUp/PgDn, Ctrl+F/Ctrl+B in selection
   * mode): one less than the viewport keeps a row of context so a page
   * never reads as a blank jump; a not-yet-measured handle falls back to a
   * fixed page rather than paging by 0 (a dead key).
   */
  const transcriptPageStep = () => {
    const viewport = handle?.getViewportHeight() ?? 0
    return viewport > 1 ? viewport - 1 : 12
  }
  React.useEffect(() => {
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
    }
  }, [])

  // Spinner timing refs, fed from channel state each render (the spinner
  // only mounts while working, so values are stable for the mount).
  const responseLengthRef = React.useRef(0)
  const uploadTokensRef = React.useRef(0)
  const loadingStartTimeRef = React.useRef(0)
  const totalPausedMsRef = React.useRef(0)
  const pauseStartTimeRef = React.useRef<number | null>(null)
  responseLengthRef.current = channel.responseChars
  // Most recent request's real upload (input + cache read/write occupy the
  // wire exactly like the context window); 0 until the first usage event.
  const lastUploadTokens = channel.lastUsage === undefined
    ? 0
    : channel.lastUsage.input + channel.lastUsage.cacheRead + channel.lastUsage.cacheWrite
  uploadTokensRef.current = lastUploadTokens
  loadingStartTimeRef.current = channel.turnStart
  return {
    exitPendingRef,
    exitTimerRef,
    requestExit,
    interruptRunningTurn,
    transcriptPageStep,
    responseLengthRef,
    uploadTokensRef,
    loadingStartTimeRef,
    totalPausedMsRef,
    pauseStartTimeRef,
  }
}
