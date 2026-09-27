import type { Dispatch, RefObject, SetStateAction } from 'react'
import { t } from '../../i18n.js'
import type { ClickEvent } from '../../ink/events/click-event.js'
import type { DragEvent } from '../../ink/events/drag-event.js'
import type { ChannelUi as Channel } from '../../adapter/channel/ui-policy.js'
import { COMPOSER_IMAGE_TOKEN, expandImageTokenRange, normalizeCursorOffset, snapOffImageToken } from './text-motion.js'
import type { ImageTokenSpan } from './text-motion.js'
import { clickToCursorOffset, wordSelectionAt } from './wrap-geometry.js'

/**
 * Pointer interactions for the prompt value box (click-to-caret, double-click
 * word selection, shift+click range extension, drag selection), extracted
 * verbatim from PromptInput.tsx. The factory runs every render and closes
 * over `deps` exactly as the inline handlers did; geometry fields are the
 * render-derived wrap values of that same render.
 */

/**
 * Double-click self-detection window: two clicks within this many ms and
 * one cell (in either axis) of each other count as a double-click and
 * select the word under the pointer. The drag protocol resets the ink
 * multi-click chain on every press inside a drag target (the value box
 * carries onDragStart), so the prompt detects the double-click itself.
 */
const DOUBLE_CLICK_MS = 500

/** Everything the pointer handlers close over, passed fresh each render. */
export type PromptInteractionDeps = {
  // layout & wrap geometry (render-derived)
  value: string
  head: string
  tail: string
  block: { start: number; end: number } | null
  inputWidth: number
  chipRow: number
  prefixCols: number
  windowStart: number
  visibleCount: number
  visualLines: readonly string[]
  // refs
  valueRef: RefObject<string>
  cursorRef: RefObject<number>
  selectionRef: RefObject<{ start: number; end: number } | null>
  dragAnchorRef: RefObject<number | null>
  lastClickAtRef: RefObject<number>
  lastClickColRef: RefObject<number>
  lastClickRowRef: RefObject<number>
  foldBlockRef: RefObject<{ start: number; end: number } | null>
  draftImagesRef: RefObject<Map<string, string>>
  // state setters & component helpers
  setCursor: Dispatch<SetStateAction<number>>
  setSelection: Dispatch<SetStateAction<{ start: number; end: number } | null>>
  clearSelection: () => void
  updateFoldBlock: (block: { start: number; end: number } | null) => void
  syncImageGeneration: () => number
  reportCaretImage: (reason: 'caret' | 'click') => void
  boundImageSpans: (text: string) => ImageTokenSpan[]
  // props
  channel: Channel
}

export function createPromptInteractions(deps: PromptInteractionDeps): {
  handleValueClick: (e: ClickEvent, colOffset?: number) => void
  handleDragStart: (e: DragEvent, colOffset?: number) => void
  handleDragMove: (e: DragEvent, colOffset?: number) => void
  handleDragEnd: () => void
} {
  const {
    // layout & wrap geometry (render-derived)
    value,
    head,
    tail,
    block,
    inputWidth,
    chipRow,
    prefixCols,
    windowStart,
    visibleCount,
    visualLines,
    // refs
    valueRef,
    cursorRef,
    selectionRef,
    dragAnchorRef,
    lastClickAtRef,
    lastClickColRef,
    lastClickRowRef,
    foldBlockRef,
    draftImagesRef,
    // state setters & component helpers
    setCursor,
    setSelection,
    clearSelection,
    updateFoldBlock,
    syncImageGeneration,
    reportCaretImage,
    boundImageSpans,
    // props
    channel,
  } = deps

  /** Move the caret to `offset`, snapped off any token interior. */
  const placeCaret = (offset: number, prefer: 'start' | 'end' | 'nearest'): void => {
    const snapped = snapOffImageToken(boundImageSpans(valueRef.current), offset, prefer)
    cursorRef.current = snapped
    setCursor(snapped)
  }

  /**
   * Write the selection [start, end) (snapped to grapheme boundaries,
   * start ≤ end); a degenerate range clears it. With a fold block the
   * range is clamped into the side that holds `start` — the block is
   * atomic and a selection may never cross the chip row.
   */
  const updateSelection = (start: number, end: number) => {
    const text = valueRef.current
    const anchor = normalizeCursorOffset(text, start)
    let lo = normalizeCursorOffset(text, Math.min(start, end))
    let hi = normalizeCursorOffset(text, Math.max(start, end))
    const block = foldBlockRef.current
    if (block) {
      // Clamp by the ORIGINAL anchor side, not sorted `lo`: for a reverse
      // tail→head drag, `lo` is in the head even though the gesture belongs
      // to the tail. Both selection and caret must stay on the anchor side.
      if (anchor <= block.start) {
        hi = Math.min(hi, block.start)
      } else {
        lo = Math.max(lo, block.end)
        hi = Math.max(hi, block.end)
      }
    }
    // A selection never cuts a staged token: an edge inside one grows
    // outward to cover the whole token.
    const range = expandImageTokenRange(boundImageSpans(text), lo, hi)
    lo = range.start
    hi = range.end
    if (lo >= hi) {
      selectionRef.current = null
      setSelection(null)
    } else {
      selectionRef.current = { start: lo, end: hi }
      setSelection({ start: lo, end: hi })
    }
  }
  /**
   * Map a pointer position relative to the value box to a UTF-16 offset
   * via the same grapheme walk the renderer wraps with — exact under CJK
   * widths, wrapped rows and multi-codepoint clusters. Rows are clamped to
   * the VISIBLE window (drag moves never auto-scroll past it in v1); the
   * fold chip row maps to null (its cells belong to the expand affordance,
   * not to text).
   */
  const localToOffset = (localCol: number, localRow: number): number | null => {
    const lastVisible = Math.min(visualLines.length - 1, windowStart + visibleCount - 1)
    const clamped = Math.max(windowStart, Math.min(windowStart + localRow, lastVisible))
    // Fold prefix (▾) row: the rendered first row is truncated by prefixCols,
    // so both the column and the wrap budget shift — without the correction
    // a drag starting on the first row lands prefixCols to the right of the
    // pointer (consistent with handleValueClick's click mapping). Presses ON the
    // prefix cells clamp to the row start (drag-from-0, like selecting the
    // whole first row backwards).
    const isPrefixRow = !block && clamped === 0 && prefixCols > 0
    const col = isPrefixRow ? Math.max(0, localCol - prefixCols) : localCol
    const width = isPrefixRow ? inputWidth - prefixCols : inputWidth
    if (block) {
      if (clamped === chipRow) return null
      return clamped < chipRow
        ? clickToCursorOffset(head, width, clamped, col)
        : block.end + clickToCursorOffset(tail, width, clamped - chipRow - 1, col)
    }
    return clickToCursorOffset(value, width, clamped, col)
  }

  /**
   * Click-to-position the caret: map a click inside the value box (local
   * row/column relative to the box) to a UTF-16 cursor offset via the same
   * grapheme walk the renderer wraps with — exact under CJK widths, wrapped
   * rows and multi-codepoint clusters. Clicks land on the boundary nearest
   * the clicked cell (mid-grapheme snaps to its start). With a fold block,
   * clicks map into the head/tail text (the chip row has its own expand
   * onClick); without one, the fold prefix's cells fold the whole input.
   *
   * The drag protocol resets ink's multi-click chain on every press inside
   * the value box (it carries onDragStart), so double-click word selection
   * is self-detected here: two clicks within DOUBLE_CLICK_MS and one cell.
   * Shift+click extends the selection from its start edge (or the caret)
   * to the clicked offset; a plain click clears the selection and moves
   * the caret.
   *
   * `colOffset` shifts the local column origin: the expanded editor's
   * value box starts at the line-number gutter, so its callers subtract
   * the gutter width (0 for the inline prompt).
   */
  /** A plain click on a `[Image #N]` token: a staged one is reported as the
   *  caret image (the caret was just placed at its start, so the caller
   *  shows the preview even if it was dismissed); a stale one warns.
   *  Offsets come from the input's own click-to-cursor mapping, never from
   *  screen coordinates. */
  const openStagedImageAt = (offset: number): void => {
    syncImageGeneration()
    for (const match of valueRef.current.matchAll(COMPOSER_IMAGE_TOKEN)) {
      const start = match.index ?? 0
      if (start > offset) break
      if (offset < start + match[0].length) {
        const stageId = draftImagesRef.current.get(match[0])
        const image = stageId === undefined ? undefined : channel.stagedImage(stageId)
        if (image === undefined) {
          // Evicted by the FIFO cap or cleared by a session switch: the
          // placeholder text will NOT attach an image on submit. A raw
          // token (never staged) is plain text and gets no notice.
          if (stageId !== undefined) {
            channel.notify(t('input-image-token-stale', { token: match[0] }), { color: 'warning', timeoutMs: 5000 })
          }
        } else {
          reportCaretImage('click')
        }
        return
      }
    }
  }

  const handleValueClick = (e: ClickEvent, colOffset = 0) => {
    const now = Date.now()
    const modified = e.shift || e.alt || e.ctrl
    const isDouble =
      !modified &&
      now - lastClickAtRef.current < DOUBLE_CLICK_MS &&
      Math.abs(e.col - lastClickColRef.current) <= 1 &&
      Math.abs(e.row - lastClickRowRef.current) <= 1
    if (modified) {
      // Shift+click is range extension, never a word-select click. It also
      // breaks the local chain so a following plain click cannot complete a
      // double-click that started under a modifier.
      lastClickAtRef.current = 0
      lastClickColRef.current = -1
      lastClickRowRef.current = -1
    } else {
      lastClickAtRef.current = now
      lastClickColRef.current = e.col
      lastClickRowRef.current = e.row
    }
    const localCol = e.localCol - colOffset
    const clickedVisual = windowStart + e.localRow
    const clamped = Math.max(0, Math.min(clickedVisual, visualLines.length - 1))
    if (block) {
      if (clamped === chipRow) return
      const offset =
        clamped < chipRow
          ? clickToCursorOffset(head, inputWidth, clamped, localCol, isDouble ? 'grapheme-start' : 'nearest')
          : block.end + clickToCursorOffset(tail, inputWidth, clamped - chipRow - 1, localCol, isDouble ? 'grapheme-start' : 'nearest')
      if (isDouble) {
        // Word select stays inside the clicked side: the block is atomic.
        const side = offset <= block.start
        const w = wordSelectionAt(value, offset, side ? 0 : block.end, side ? block.start : value.length)
        if (w) {
          updateSelection(w.start, w.end)
          placeCaret(selectionRef.current?.end ?? w.end, 'end')
        }
        return
      }
      if (e.shift) {
        const base = selectionRef.current ? selectionRef.current.start : cursorRef.current
        updateSelection(base, offset)
        placeCaret(offset, 'nearest')
        return
      }
      clearSelection()
      // A click on a staged token puts the caret at its start: the token is
      // the caret cluster, so it highlights whole.
      placeCaret(offset, 'start')
      openStagedImageAt(offset)
      return
    }
    if (clamped === 0 && prefixCols > 0 && localCol < prefixCols) {
      // Folding hides the entire editable projection, so no selection may
      // survive invisibly inside the chip and keep owning Ctrl+C/Delete.
      clearSelection()
      dragAnchorRef.current = null
      setCursor(value.length)
      updateFoldBlock({ start: 0, end: value.length })
      return
    }
    const col =
      clamped === 0 && prefixCols > 0 ? Math.max(0, localCol - prefixCols) : localCol
    const offset = clickToCursorOffset(
      value,
      clamped === 0 && prefixCols > 0 ? inputWidth - prefixCols : inputWidth,
      clamped,
      col,
      isDouble ? 'grapheme-start' : 'nearest',
    )
    if (isDouble) {
      const w = wordSelectionAt(value, offset, 0, value.length)
      if (w) {
        updateSelection(w.start, w.end)
        placeCaret(selectionRef.current?.end ?? w.end, 'end')
      }
      return
    }
    if (e.shift) {
      const base = selectionRef.current ? selectionRef.current.start : cursorRef.current
      updateSelection(base, offset)
      placeCaret(offset, 'nearest')
      return
    }
    clearSelection()
    placeCaret(offset, 'start')
    openStagedImageAt(offset)
  }

  /**
   * Drag selection (component-level drag protocol): the press origin is
   * derived from the event's start/current delta (dragstart fires on the
   * FIRST motion), the focus follows every dragmove. The caret rides the
   * focus edge; updateSelection clamps both ends into one fold side, so a
   * drag can never cross the chip row. `colOffset` as in handleValueClick.
   */
  const handleDragStart = (e: DragEvent, colOffset = 0) => {
    const anchorLocalCol = e.localCol - (e.col - e.startCol) - colOffset
    const anchorLocalRow = e.localRow - (e.row - e.startRow)
    const anchor = localToOffset(anchorLocalCol, anchorLocalRow)
    if (anchor === null) {
      dragAnchorRef.current = null
      return
    }
    dragAnchorRef.current = anchor
    placeCaret(anchor, 'nearest')
  }
  const handleDragMove = (e: DragEvent, colOffset = 0) => {
    const anchor = dragAnchorRef.current
    if (anchor === null) return
    const focus = localToOffset(e.localCol - colOffset, e.localRow)
    if (focus === null) return
    // The caret rides the focus edge, clamped into the anchor's fold side
    // exactly like updateSelection clamps the range — the caret must never
    // jump across the chip row while the selection stays behind.
    let caret = focus
    const block = foldBlockRef.current
    if (block) {
      caret = anchor <= block.start ? Math.min(focus, block.start) : Math.max(focus, block.end)
    }
    updateSelection(anchor, focus)
    placeCaret(normalizeCursorOffset(valueRef.current, caret), 'nearest')
  }
  const handleDragEnd = () => {
    dragAnchorRef.current = null
  }
  return { handleValueClick, handleDragStart, handleDragMove, handleDragEnd }
}
