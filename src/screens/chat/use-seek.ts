import React from 'react'
import type { ScrollBoxHandle } from '../../ui.js'
import type { DOMElement } from '../../ink/dom.js'

/**
 * Row seeking under layout virtualization: a mounted row seeks directly; an
 * unmounted one is force-mounted first, then sought by the completion
 * effect once its ref lands. The seek mode travels with the deferred seek
 * so the completion effect replays the same alignment. Extracted verbatim
 * from Chat (the useScrollConductor shape from the refactor plan, scoped
 * to seek semantics).
 */
export function useSeek(handle: ScrollBoxHandle | null, rowRefsRef: React.RefObject<Map<number, DOMElement>>, showAllMessages: boolean, setShowAllMessages: (value: boolean) => void) {
  const [forceMountRowId, setForceMountRowId] = React.useState<number | null>(null)
  const forceMountSeekModeRef = React.useRef<'top' | 'nearest'>('top')
  const seekRowAligned = (rowId: number, mode: 'top' | 'nearest'): void => {
    const el = rowRefsRef.current.get(rowId)
    if (el) {
      handle?.scrollToElement(el, 0, mode)
      return
    }
    forceMountSeekModeRef.current = mode
    setForceMountRowId(rowId)
  }
  /** Top-align seek: the row's head becomes the viewport's top line. */
  const seekRow = (rowId: number): void => seekRowAligned(rowId, 'top')
  /**
   * Minimal seek (grok-style cursor navigation): a row already on screen
   * leaves the page in place — the cursor moves, the viewport doesn't;
   * only an off-screen row scrolls, by the shortest distance that
   * reveals it at the near edge.
   */
  const seekRowIntoView = (rowId: number): void => seekRowAligned(rowId, 'nearest')
  /**
   * Reveal-and-seek for a row folded behind the recent-rows window (the
   * rail's tick for an old turn, the doc's revealAndSeekRow, selection
   * mode's g): expand the fold first, then the ordinary seek takes over —
   * the completion effect below force-mounts the row and scrollToElement
   * lands it once its ref (and Yoga top) exist. The fold toggle is
   * idempotent, so calling this for an already-revealed row is harmless.
   * Without the reveal, forceMount only widens within MessageList's
   * visibleRows — a row sliced off by RENDERED_ROW_CAP never mounts and
   * the seek silently no-ops (long-session g-to-top bug).
   */
  const revealAndSeekRow = (rowId: number, mode: 'top' | 'nearest' = 'top'): void => {
    if (!showAllMessages) setShowAllMessages(true)
    seekRowAligned(rowId, mode)
  }
  React.useLayoutEffect(() => {
    if (forceMountRowId === null) return
    const el = rowRefsRef.current.get(forceMountRowId)
    if (el) {
      handle?.scrollToElement(el, 0, forceMountSeekModeRef.current)
      // Clear deferred to a macrotask: clearing here would let React's
      // synchronous re-render narrow the virtualization window and unmount
      // the row BEFORE the renderer's deferred pass reads its Yoga top
      // (scrollAnchor processing runs in a microtask) — the seek would
      // silently no-op (detached anchor element).
      setTimeout(() => setForceMountRowId(null), 0)
    }
  })
  return { forceMountRowId, seekRow, seekRowIntoView, revealAndSeekRow }
}
