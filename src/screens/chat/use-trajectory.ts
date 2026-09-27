import React from 'react'
import type { ChannelUi } from '../../adapter/channel/ui-policy.js'
import type { RawTrajEvent as SessionEvent } from '../../adapter/ports/channel-view.js'

const NO_EVENTS: readonly SessionEvent[] = []
import { readTrajectorySeen, writeTrajectorySeen } from '../../trajectoryPrefs.js'
import { extendTrajectory, projectWave, type TrajBuild } from '../../dsh-adapter/trajectory/index.js'
import { miniWakeWidth } from '../../components/trajectory/MiniWake.js'
import { useAnimationFrame, useTerminalSize } from '../../ui.js'
import { usePageInset } from '../../components/PageMargin.js'

/**
 * The session's trajectory projection, folded here rather than inside the
 * scene. Two things fall out of owning it at this level: the status-line
 * chip can show live counters without a second fold, and opening the scene
 * is instant because the build is already warm. The fold is incremental —
 * it consumes only events appended since the last render — so an idle
 * conversation pays nothing for it. Extracted verbatim from Chat.
 */
export function useTrajectory(channel: ChannelUi, trajectorySeenProp: boolean | undefined) {
  const trajectoryRef = React.useRef<TrajBuild | null>(null)
  trajectoryRef.current = extendTrajectory(
    trajectoryRef.current,
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- runtime guard: headless hosts render Chat with a partial channel
    channel.traceEvents?.() ?? NO_EVENTS,
  )
  const trajectory = trajectoryRef.current

  /**
   * The status-line wake. Projected onto a dozen-odd columns and memoized
   * against the ledger's row count, so it recomputes when the session
   * actually grows rather than on every animation tick. The tick only
   * re-colours the cells it already has.
   */
  const { columns: terminalColumns } = useTerminalSize()
  const pageInsetX = usePageInset().x
  const wakeWidth = miniWakeWidth(terminalColumns)
  const wakeBand = React.useMemo(
    () =>
      wakeWidth === 0
        ? undefined
        // `sequence`, not the scene's `compressed`: at sixteen columns an idle
        // gap cannot express how long it was, so it only reads as a broken
        // strip. Equal-width columns give a continuous silhouette, which is
        // the only thing this size can actually say.
        // Width is also clamped to the row count: with fewer rows than
        // columns the strip would be mostly gaps, which reads as broken
        // rather than as short. It simply grows as the session does.
        : projectWave(trajectory.nodes, Math.min(wakeWidth, trajectory.nodes.length), 'sequence'),
    // The node array is mutated in place by the incremental fold, so its
    // length is the honest dependency; its identity never changes.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [trajectory.nodes, trajectory.counts.rows, wakeWidth],
  )
  const [wakeTickRef, wakeTime] = useAnimationFrame(channel.working ? 120 : null)
  /**
   * The key hint beside the strip retires itself once the trajectory has been
   * opened — teaching belongs in the first minute, not on every frame forever.
   */
  const [trajectorySeen, setTrajectorySeen] = React.useState(() => trajectorySeenProp ?? readTrajectorySeen())

  /**
   * The one failure worth pointing at. Only the LATEST failed tool row
   * carries the footnote, and only while its failures are unseen. Repeating
   * it under every historical failure would be exactly the clutter the
   * whole entry design is trying to avoid — one pointer, at the newest
   * problem, is enough to find the rest.
   */
  const seenFailuresRef = React.useRef(0)
  const unreadFailures = Math.max(0, trajectory.counts.errors - seenFailuresRef.current)
  const failureHintRowId = React.useMemo(() => {
    if (unreadFailures === 0) return null
    for (let index = channel.rows.length - 1; index >= 0; index--) {
      const row = channel.rows[index]
      if (row?.kind === 'tool' && row.tool?.status === 'error') return row.id
    }
    return null
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.rows, channel.version, unreadFailures])

  const markFailuresSeen = () => {
    seenFailuresRef.current = trajectoryRef.current?.counts.errors ?? 0
    setTrajectorySeen(previous => {
      if (!previous) writeTrajectorySeen()
      return true
    })
  }
  return {
    trajectory,
    terminalColumns,
    markFailuresSeen,
    pageInsetX,
    wakeBand,
    wakeTickRef,
    wakeTime,
    trajectorySeen,
    setTrajectorySeen,
    unreadFailures,
    failureHintRowId,
  }
}
