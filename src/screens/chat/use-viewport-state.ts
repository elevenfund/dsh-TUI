import React from 'react'
import type { ScrollBoxHandle } from '../../ui.js'
import type { ChatRow } from '../../dsh-adapter/channel.js'

/**
 * Transcript viewport state: sticky-bottom subscription, the whale-art
 * visibility probe, the tooltip invalidation subscription, and the "N new
 * messages" pill bookkeeping. Extracted verbatim from Chat.
 */
export function useViewportState(
  handle: ScrollBoxHandle | null,
  rows: readonly ChatRow[],
) {
  // Sticky (pinned-to-bottom) scroll state, subscribed imperatively so
  // wheel events don't re-render React — only the header/pill flip.
  // Deliberately KEPT on useSyncExternalStore despite the SyncLane wakeup
  // cost: the renderer's at-bottom re-pin flips sticky WITHOUT firing the
  // scroll subscribers (see ScrollBox's subscribe doc), so only uSES's
  // every-render getSnapshot check picks that flip up — a pure
  // notification-driven subscription misses it and the new-message pill
  // stops reflecting reality (repro-pill). Wheel cadence is an
  // interaction-rate source (not streaming-rate), the streaming-side
  // #185 sources are all Default-lane now, and the overflow guard
  // backstops the residue.
  const isSticky = React.useSyncExternalStore(
    cb => (handle ? handle.subscribe(cb) : () => {}),
    () => (handle ? handle.isSticky() : true),
  )
  // The whale header keeps its frame budget across sticky pins: the store
  // snapshot is re-read every render because the renderer's sticky re-pin
  // doesn't fire scroll subscribers — only the per-render check picks it
  // up when the user scrolls back to the top.
  const WHALE_ART_CUTOFF_ROWS = 16 // marginTop + the 13-row whale art
  const whaleArtVisible = React.useSyncExternalStore(
    cb => (handle ? handle.subscribe(cb) : () => {}),
    () => {
      if (!handle) return true
      // A transcript that fits the viewport always shows the header.
      if (handle.getScrollHeight() <= handle.getViewportHeight()) return true
      // Visible while the art block intersects the viewport. A sticky bottom
      // pin with an overflow smaller than the art's height still leaves the
      // art on screen — visibility, not pin state, decides whether the idle
      // planner earns its keep.
      return handle.getScrollTop() < WHALE_ART_CUTOFF_ROWS
    },
  )
  const subscribeTooltipInvalidation = React.useCallback(
    (listener: () => void) => (handle ? handle.subscribe(listener) : () => {}),
    [handle],
  )

  // "N new messages" pill: new rows whose top edge is still BELOW the
  // viewport bottom. The count decrements as the user scrolls down through
  // them and hits 0 (pill hides) once every new row has been on screen —
  // no need to wait for the exact-bottom sticky restore. Chat anchors the
  // "seen up to" point by ROW ID (stable across loadOlder prepends, unlike
  // a rows.length index); MessageList owns the row offsets, so it computes
  // how many rows past that anchor lie below the viewport and reports it.
  const lastSeenRowIdRef = React.useRef<number | null>(null)
  const [unseenCount, setUnseenCount] = React.useState(0)
  React.useEffect(() => {
    if (isSticky) {
      lastSeenRowIdRef.current = null
      setUnseenCount(0)
    } else if (lastSeenRowIdRef.current === null) {
      lastSeenRowIdRef.current = rows.length
        ? rows[rows.length - 1]!.id
        : -1
    }
  }, [isSticky, rows])
  // The pill shows whenever the view is off the bottom (one-click return
  // home): with unseen rows it counts them, otherwise it is the plain
  // "return to bottom" affordance (Enter/End/click all land it).
  const showPill = !isSticky
  return { isSticky, whaleArtVisible, subscribeTooltipInvalidation, unseenCount, setUnseenCount, lastSeenRowIdRef, showPill }
}
