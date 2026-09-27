import { constants as fsConstants } from 'node:fs'
import { open, unlink } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { t } from '../../i18n.js'
import type { InputEvent, Key } from '../../ink/events/input-event.js'
import type { ScrollBoxHandle } from '../../ui.js'
import { formatClipboardInsert, readClipboard } from '../../utils/clipboard.js'
import { imagePathMediaType, parsePastedImagePath, stageClipboardFilePaths } from '../../utils/pastedImagePath.js'
import { editInExternalEditor } from '../../utils/externalEditor.js'
import { isMod } from '../../utils/modifiers.js'
import { isHiddenCommandName, parseCommandName } from '../../commands.js'
import { actionMatches } from '../../utils/keymap.js'
import type { FileCandidate } from '../../utils/fileSuggestions.js'
import type { CommandCompletion } from '../../commands.js'
import type { ChannelUi as Channel } from '../../adapter/channel/ui-policy.js'
import type { ComposerImageRef, ComposerSubmission, StagedImageHandle } from '../../dsh-adapter/channel.js'
import type { DraftImageLease, PromptHistoryEntry, VimUndoEntry } from '../PromptInput.js'
import {
  expandImageTokenRange,
  graphemeBoundaries,
  nextGraphemeBoundary,
  previousGraphemeBoundary,
  sanitizeEditableText,
  vimLineEnd,
  vimLineFirstNonBlank,
  vimLineStart,
  vimWordBackward,
  vimWordEnd,
  vimWordForward,
  wordBoundaryLeft,
  wordBoundaryRight,
} from './text-motion.js'
import type { ImageTokenSpan } from './text-motion.js'

/**
 * Prompt keyboard dispatch, extracted verbatim from PromptInput's useInput
 * callback (pi-2 phase 2). The returned handler closes over `deps`, which
 * the component rebuilds every render — the same closure-freshness the old
 * inline body had. Helpers used only by the callback moved with it; the two
 * module-level file utilities below moved unchanged.
 */


/** Format label for one image media type, matching the image preview card's
 *  title (`JPEG`, `PNG`, `WEBP`, `GIF`). */
const mediaTypeLabel = (mediaType: string): string =>
  mediaType.replace(/^image\//u, '').replace(/\+xml$/u, '').toUpperCase()

/** Read one regular file through one descriptor, bounded to `maxBytes + 1`.
 * The extra byte detects a file that grows after fstat; a short read detects
 * shrinkage. This avoids stat(path) → readFile(path)'s path-swap TOCTOU and
 * never allocates from an untrusted size before the profile limit is checked. */
async function readBoundedRegularFile(path: string, maxBytes: number): Promise<Uint8Array> {
  // O_NONBLOCK keeps a pasted FIFO/device path from parking the UI before
  // fstat can reject it; regular-file reads are unchanged.
  const file = await open(path, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK)
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new Error(`${basename(path)} is not a regular file`)
    if (info.size > maxBytes) throw new Error(`image exceeds this profile's per-image size limit`)
    const data = Buffer.allocUnsafe(info.size + 1)
    let offset = 0
    while (offset < data.byteLength) {
      const { bytesRead } = await file.read(data, offset, data.byteLength - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset !== info.size) throw new Error(`${basename(path)} changed while it was being read`)
    return data.subarray(0, offset)
  } finally {
    await file.close()
  }
}

/** Everything the keyboard dispatch closes over, passed fresh each render. */
export type PromptKeyDeps = {
  // text & caret state
  value: string
  valueRef: RefObject<string>
  cursorRef: RefObject<number>
  setInput: (next: string, cursorOffset?: number) => void
  head: string
  tail: string
  updateFoldBlock: (block: { start: number; end: number } | null) => void
  // selection
  selectionRef: RefObject<{ start: number; end: number } | null>
  clearSelection: () => void
  // vim mode
  vimEnabledRef: RefObject<boolean>
  vimInsertRef: RefObject<boolean>
  vimPendingRef: RefObject<'' | 'd'>
  vimUndoRef: RefObject<VimUndoEntry[]>
  setVimInsert: (value: SetStateAction<boolean>) => void
  clearVimUndo: () => void
  // completion & overlays
  suggestions: readonly CommandCompletion[]
  selectedCommand: number
  setSelectedCommand: Dispatch<SetStateAction<number>>
  fileMatches: readonly FileCandidate[]
  fileSelected: number
  setFileSelected: Dispatch<SetStateAction<number>>
  overlayOpen: boolean
  fileOverlayOpen: boolean
  mention: { start: number; end: number; query: string; pathEnd?: number } | undefined
  helpScrollRef: RefObject<ScrollBoxHandle | null>
  helpViewportHeight: number
  expandEnabled: boolean
  toggleExpand: () => void
  collapseEditor: () => void
  handleEnter: () => void
  // refs (esc / clipboard / editor / history / image staging)
  clipboardBusyRef: RefObject<boolean>
  editorBusyRef: RefObject<boolean>
  escPendingRef: RefObject<boolean>
  escTimerRef: RefObject<NodeJS.Timeout | null>
  expandedRef: RefObject<boolean>
  fileEscRef: RefObject<number>
  foldBlockRef: RefObject<{ start: number; end: number } | null>
  history: RefObject<PromptHistoryEntry[]>
  historyDraft: RefObject<PromptHistoryEntry>
  historyIndex: RefObject<number>
  imageStageChainRef: RefObject<Promise<void>>
  nextImageNumberRef: RefObject<number>
  // draft image pipeline
  draftImagesRef: RefObject<Map<string, string>>
  acceptFile: (candidate: FileCandidate) => void
  advanceDraftRevision: () => void
  boundImageSpans: (text: string) => ImageTokenSpan[]
  captureDraftImageLease: () => DraftImageLease
  discardDraftImages: () => void
  discardUnretainedImages: (stageIds: Iterable<string>) => void
  draftImageLeaseIsCurrent: (lease: DraftImageLease) => boolean
  imageRefsFor: (text: string) => ComposerImageRef[]
  replaceDraftImages: (images: readonly ComposerImageRef[]) => void
  syncImageGeneration: () => number
  shellImagesUnsupported: (text: string, images: readonly ComposerImageRef[]) => boolean
  // history & submit
  seedHistory: () => void
  rememberHistory: (text: string, images: readonly ComposerImageRef[]) => void
  submitText: (text: string, notice?: string) => void
  submitFromEditor: () => void
  tryRunCommand: (text: string) => boolean
  clearDeliveredDraft: () => void
  // caret helpers
  cursorColumn: (text: string, cursorOffset: number) => number
  cursorLine: (text: string, cursorOffset: number) => number
  isBigInput: (text: string) => boolean
  // props & external handlers
  channel: Channel
  selectionActive: boolean
  caretPreviewOpen?: boolean
  helpOpen: boolean
  onToggleHelp: () => void
  onBackgroundRequest?: () => void
  onDismissCaretPreview?: () => void
  onEnterSelection?: () => void
  onRewindRequest?: () => void
  onSubmitted?: () => void
}

export function createPromptKeyHandler(deps: PromptKeyDeps): (input: string, key: Key, event: InputEvent) => void {
  const {
    // text & caret state
    value,
    valueRef,
    cursorRef,
    setInput,
    head,
    tail,
    updateFoldBlock,
    // selection
    selectionRef,
    clearSelection,
    // vim mode
    vimEnabledRef,
    vimInsertRef,
    vimPendingRef,
    vimUndoRef,
    setVimInsert,
    clearVimUndo,
    // completion & overlays
    suggestions,
    selectedCommand,
    setSelectedCommand,
    fileMatches,
    fileSelected,
    setFileSelected,
    overlayOpen,
    fileOverlayOpen,
    mention,
    helpScrollRef,
    helpViewportHeight,
    expandEnabled,
    toggleExpand,
    collapseEditor,
    handleEnter,
    // refs (esc / clipboard / editor / history / image staging)
    clipboardBusyRef,
    editorBusyRef,
    escPendingRef,
    escTimerRef,
    expandedRef,
    fileEscRef,
    foldBlockRef,
    history,
    historyDraft,
    historyIndex,
    imageStageChainRef,
    nextImageNumberRef,
    // draft image pipeline
    draftImagesRef,
    acceptFile,
    advanceDraftRevision,
    boundImageSpans,
    captureDraftImageLease,
    discardDraftImages,
    discardUnretainedImages,
    draftImageLeaseIsCurrent,
    imageRefsFor,
    replaceDraftImages,
    syncImageGeneration,
    shellImagesUnsupported,
    // history & submit
    seedHistory,
    rememberHistory,
    submitText,
    submitFromEditor,
    tryRunCommand,
    clearDeliveredDraft,
    // caret helpers
    cursorColumn,
    cursorLine,
    isBigInput,
    // props & external handlers
    channel,
    selectionActive,
    caretPreviewOpen,
    helpOpen,
    onToggleHelp,
    onBackgroundRequest,
    onDismissCaretPreview,
    onEnterSelection,
    onRewindRequest,
    onSubmitted,
  } = deps
  const deleteInputRange = (start: number, end: number): void => {
    if (start >= end) return
    const text = valueRef.current
    const range = expandImageTokenRange(boundImageSpans(text), start, end)
    setInput(text.slice(0, range.start) + text.slice(range.end), range.start)
  }
  const restoreDraftImages = (entry: PromptHistoryEntry): void => {
    syncImageGeneration()
    advanceDraftRevision()
    replaceDraftImages(entry.images)
    clearVimUndo()
  }
  /**
   * Tab while the model is working = plain queue (followup): the message
   * waits for the running turn to end, then is processed in order.
   */
  const queueSend = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const images = imageRefsFor(trimmed)
    if (shellImagesUnsupported(trimmed, images)) return
    rememberHistory(trimmed, images)
    clearDeliveredDraft()
    channel.submit(trimmed, images)
    onSubmitted?.()
    channel.notify(t('input-queued-after-turn'), { timeoutMs: 2500 })
  }
  /**
   * Alt+Up: pull the last pending message back into the input for editing
   * (never interrupts the running turn). Refused when the running dsh-agent
   * cannot withdraw inbox messages (released package without the inbox API).
   */
  const pullBackLast = () => {
    const item = channel.pending[channel.pending.length - 1]
    if (!item) return
    if (!channel.removePending(item.id)) {
      channel.notify(t('input-cannot-retract'), { color: 'warning', timeoutMs: 2500 })
      return
    }
    restoreDraftImages({
      text: item.text,
      images: item.images ?? [],
    })
    setInput(item.text)
    updateFoldBlock(null)
    setSelectedCommand(0)
    setFileSelected(0)
    channel.notify(t('input-retracted'), { timeoutMs: 2000 })
  }
  /**
   * Withdraw the queued copy of the text `↑` just recalled (issue #986): the
   * message is still parked in the inbox, so editing it and sending again
   * would run the same text twice. Alt+Up withdraws explicitly; walking the
   * history to the same text has to land in the same place. The newest match
   * wins — `↑` walks newest-first and the queue is FIFO. A message the
   * running turn already claimed cannot be withdrawn, and saying so beats
   * pretending it was.
   */
  const retractRecalledCopy = (text: string): void => {
    let target: (typeof channel.pending)[number] | undefined
    for (const item of channel.pending) {
      if (item.text === text) target = item
    }
    if (target === undefined) return
    if (channel.removePending(target.id)) {
      channel.notify(t('input-retracted'), { timeoutMs: 2000 })
    } else {
      channel.notify(t('input-cannot-retract'), { color: 'warning', timeoutMs: 2500 })
    }
  }
  /**
   * Ctrl+Enter: abort the running turn and send the input immediately — the
   * model stops what it is doing and starts on this message right away.
   */
  const interruptSend = () => {
    const trimmed = value.trim()
    if (!trimmed) {
      channel.notify(t('input-empty'), { color: 'warning' })
      return
    }
    // Abort the running turn and deliver: previously queued pending
    // messages first (FIFO), then the current input — all processed
    // immediately once the abort settles.
    const images = imageRefsFor(trimmed)
    const queued: ComposerSubmission[] = [
      ...channel.pending.map(item => ({ text: item.text, images: item.images ?? [] })),
      { text: value, images },
    ]
    const count = channel.interruptAndDeliver(queued)
    if (count === 0) return
    rememberHistory(trimmed, images)
    clearDeliveredDraft()
    channel.notify(t('input-interrupt-immediate'), { timeoutMs: 2500 })
  }
  /** Clipboard reads are asynchronous; insert against the latest render so
   * typing while PowerShell owns the clipboard never gets overwritten.
   * An active selection is replaced by the insert. Returns the resulting
   * value and the insertion offset so callers can apply the paste fold. */
  const insertClipboardAtCaret = (text: string): { next: string; at: number } => {
    text = sanitizeEditableText(text)
    const current = valueRef.current
    const sel = selectionRef.current
    const position = sel ? sel.start : cursorRef.current
    const next = sel
      ? current.slice(0, sel.start) + text + current.slice(sel.end)
      : current.slice(0, position) + text + current.slice(position)
    setInput(next, position + text.length)
    setSelectedCommand(0)
    setFileSelected(0)
    return { next, at: position }
  }
  /** Read one local image file and stage it through the channel, returning
   *  an opaque capability. Shared by every image paste path:
   *  clipboard bitmap export, Finder-copied files, and pasted drop paths.
   *  A Finder/drop path is untrusted input: one bounded descriptor read
   *  applies the profile limit before bytes enter the composer. */
  const stageImagePath = async (path: string, lease: DraftImageLease): Promise<StagedImageHandle> => {
    if (!draftImageLeaseIsCurrent(lease)) {
      throw new Error('the draft changed while the image was being staged')
    }
    const limits = channel.stagedImageLimits?.()
    if (limits === undefined) throw new Error('image attachments are unavailable in this profile')
    // One-image paste operations are serialized, so this is the cumulative
    // draft count (not merely the current Finder batch). Refuse before the
    // descriptor read/save and never let the channel's 128-capability cache
    // become an accidental per-command batch size.
    if (draftImagesRef.current.size >= limits.maxImagesPerMessage) {
      throw new Error('image count exceeds this profile\'s per-message limit')
    }
    const data = await readBoundedRegularFile(path, limits.maxImageBytes)
    if (!draftImageLeaseIsCurrent(lease)) {
      throw new Error('the draft changed while the image was being staged')
    }
    return channel.stageComposerImage({
      data,
      // Callers gate on imagePathMediaType; the assertion is unreachable.
      mediaType: imagePathMediaType(path) ?? 'image/png',
      name: basename(path),
      // The preview card's path row: the file that was read, as an
      // absolute path (a clipboard bitmap shows its temp export).
      path: resolve(path),
    }, lease.generation)
  }
  /** Queue one complete image operation (save plus synchronous bind/insert).
   * Keeping the visible mutation inside the chain makes terminal drop order
   * independent of attachment-store latency. Rejections settle the chain so
   * one bad file cannot wedge later drops. */
  const enqueueImageWork = <T,>(work: () => Promise<T>): Promise<T> => {
    const queued = imageStageChainRef.current.then(work, work)
    imageStageChainRef.current = queued.then(() => undefined, () => undefined)
    return queued
  }
  /** Success notice for one staged image. An adapted paste says what the user
   *  actually got (stored dimensions, stored format, filled alpha) — naming it
   *  is the difference between a reported adaptation and a silently rewritten
   *  image. */
  const stagedImageNotice = (token: string, handle: StagedImageHandle): string => {
    const adjustment = handle.adjustment
    if (adjustment === undefined) return t('input-image-pasted', { token })
    const details: string[] = []
    if (adjustment.resized) {
      details.push(t('input-image-detail-resized', {
        width: adjustment.width,
        height: adjustment.height,
      }))
    }
    if (adjustment.mediaType !== adjustment.sourceMediaType) {
      const from = mediaTypeLabel(adjustment.sourceMediaType)
      const to = mediaTypeLabel(adjustment.mediaType)
      details.push(adjustment.flattened
        ? t('input-image-detail-converted-flattened', { from, to })
        : t('input-image-detail-converted', { from, to }))
    }
    // An adjustment always describes a resize or a conversion; anything else
    // keeps the plain notice rather than an empty parenthetical. ' · ' joins
    // the clauses in both shipped languages.
    if (details.length === 0) return t('input-image-pasted', { token })
    return t('input-image-pasted-adjusted', { token, detail: details.join(' · ') })
  }
  const discardStagedHandles = (handles: readonly StagedImageHandle[]): void => {
    for (const stageId of new Set(handles.map(handle => handle.stageId))) {
      channel.discardStagedImage(stageId)
    }
  }
  /** Assign presentation numbering only after staging succeeds. Existing raw
   * tokens (including stale history) reserve their number, so a fresh image
   * can never visually alias one. The counter never goes backwards within
   * one session generation, which also keeps delete/undo safe. */
  const bindStagedImage = (handle: StagedImageHandle, lease: DraftImageLease): string => {
    if (!draftImageLeaseIsCurrent(lease)) {
      // The save completed, but its initiating draft was already submitted,
      // replaced, or unmounted. Reclaim this otherwise-unreachable channel
      // capability instead of waiting for the session FIFO to evict it.
      channel.discardStagedImage(handle.stageId)
      throw new Error('the draft changed while the image was being staged')
    }
    if (channel.hasStagedImage?.(handle.stageId) !== true) {
      throw new Error('the draft changed while the image was being staged')
    }
    let token = `[Image #${nextImageNumberRef.current}]`
    while (valueRef.current.includes(token) || draftImagesRef.current.has(token)) {
      nextImageNumberRef.current += 1
      token = `[Image #${nextImageNumberRef.current}]`
    }
    nextImageNumberRef.current += 1
    draftImagesRef.current.set(token, handle.stageId)
    return token
  }
  return (input: string, key: Key, event: InputEvent) => {
    if (selectionActive) return
    // The editor round-trip ends by resuming stdin one microtask before the
    // outcome lands — drop any key squeezed into that gap so the prompt's
    // setValue can never overwrite fresh typing (and vice versa).
    if (editorBusyRef.current) return

    // Ctrl+Shift+E (remappable via /settings): toggle the fullscreen draft
    // editor. Matched before anything else so it works both while editing
    // and from an idle prompt; selectionActive has already returned above.
    // Refused while the feature is turned off in /settings.
    if (expandEnabled && actionMatches('expandEditor', input, key)) {
      event?.stopImmediatePropagation()
      toggleExpand()
      return
    }

    // App deliberately dispatches every parsed key from one stdin read in a
    // single React update. Read the synchronous mirrors so each event sees
    // the text/caret produced by the preceding event in that batch.
    const value = valueRef.current
    const cursor = cursorRef.current
    const selection = selectionRef.current

    // ── caret-driven image preview ──────────────────────────────────────
    // Esc dismisses the preview the caret opened, before any other Esc
    // meaning (help stays above it: the help menu is modal over the prompt).
    if (key.escape && caretPreviewOpen && !helpOpen) {
      event?.stopImmediatePropagation()
      onDismissCaretPreview?.()
      return
    }

    // ── mouse selection (drag / Shift+click / double-click) ─────────────
    // Layered ahead of the fold-block rules: with an active selection, Esc
    // ONLY drops the highlight (text untouched), and Backspace/Delete
    // delete the selected span. Arrows/typing handle the selection at their
    // own arms below.
    if (key.escape && selection && !helpOpen && !overlayOpen && !fileOverlayOpen) {
      event.stopImmediatePropagation()
      clearSelection()
      return
    }
    if ((key.backspace || key.delete) && selection) {
      deleteInputRange(selection.start, selection.end)
      setSelectedCommand(0)
      setFileSelected(0)
      return
    }

    // ── 全屏草稿编辑（expandEditor，默认 Ctrl+Shift+E / 输入行 ✎）─────
    // 展开态拥有屏幕；Esc 收起（有选区时上面的 selection 分支已先行只清
    // 选区）。滚轮不经此——编辑区的 onWheel 位置路由直接驱动滚动窗口。
    if (key.escape && expandedRef.current) {
      // Collapse runs AHEAD of the fold-block/vim Esc meanings: the
      // fullscreen cover is the outermost modal layer.
      event?.stopImmediatePropagation()
      collapseEditor()
      return
    }

    // Fold block: Esc expands it — it must NEVER clear text
    // that LOOKS like one line; Backspace at the block's tail / Delete at
    // its head deletes the WHOLE block in one key; ←/→ jump over the
    // atomic block. Typing NEVER expands it — the caret lives outside the
    // block and edits land in the visible text around it.
    const block = foldBlockRef.current
    // Line-level moves/edits (↑/↓/Home/End/Ctrl+A/E/U/K/W) treat the
    // block as an atomic row: boundaries that would land inside it are
    // clamped to its edges.
    const clampRowStart = (pos: number) =>
      block && cursor >= block.end ? Math.max(pos, block.end) : pos
    const clampRowEnd = (pos: number) =>
      block && cursor <= block.start ? Math.min(pos, block.start) : pos
    if (block) {
      if (key.escape) {
        updateFoldBlock(null)
        return
      }
      if ((key.backspace && cursor === block.end) || (key.delete && cursor === block.start)) {
        const next = value.slice(0, block.start) + value.slice(block.end)
        updateFoldBlock(null)
        setInput(next, block.start)
        setSelectedCommand(0)
        setFileSelected(0)
        return
      }
      if (key.leftArrow && cursor === block.end) {
        setInput(value, block.start)
        return
      }
      if (key.rightArrow && cursor === block.start) {
        setInput(value, block.end)
        return
      }
    }

    // Grapheme boundaries of the current text: every caret move / delete
    // below snaps onto one of these offsets (never mid-cluster).
    const bounds = graphemeBoundaries(value)

    /** Insert text at the caret (typing, paste) and dismiss overlays. An
     *  active selection is REPLACED by the insert (standard editor
     *  semantics). Returns the insertion offset so callers can derive the
     *  inserted span (paste fold). */
    const insertAtCaret = (text: string): number => {
      if (helpOpen) onToggleHelp()
      const sel = selectionRef.current
      const at = sel ? sel.start : cursor
      const next = sel
        ? value.slice(0, sel.start) + text + value.slice(sel.end)
        : value.slice(0, cursor) + text + value.slice(cursor)
      setInput(next, at + text.length)
      setSelectedCommand(0)
      setFileSelected(0)
      return at
    }

    // Bracketed paste (terminal paste — Ctrl+Shift+V / right-click): insert
    // at the caret after removing terminal controls and expanding tabs.
    // Newlines remain data — they are NOT Enter — so this branch runs before
    // the whole-line submit rule.
    if (event?.isPasted && input.length > 0) {
      const text = sanitizeEditableText(input.replace(/\r\n/g, '\n').replace(/\r/g, '\n'))
      // Desktop drops reach the TUI as pasted text (Ghostty forwards
      // Shell.escape(path) through the PTY with no drop boundary). Only a
      // paste that IS one unambiguous existing local image path stages as
      // an image; any parse/stat/staging failure inserts the text verbatim.
      const droppedPath = parsePastedImagePath(text)
      if (droppedPath !== null) {
        const lease = captureDraftImageLease()
        if (helpOpen) onToggleHelp()
        setSelectedCommand(0)
        setFileSelected(0)
        void enqueueImageWork(async () => {
          const handle = await stageImagePath(droppedPath, lease)
          const token = bindStagedImage(handle, lease)
          // Bind and insert share this synchronous continuation: setInput's
          // sidecar pruning can never observe a bound-but-not-visible token.
          insertClipboardAtCaret(`${token} `)
          channel.notify(stagedImageNotice(token, handle), { timeoutMs: 2500 })
        })
          .catch(() => {
            if (!draftImageLeaseIsCurrent(lease)) return
            // A real path/read/stage failure keeps the terminal paste as text.
            // A revoked lease is handled above and must not edit a newer draft.
            insertClipboardAtCaret(text)
          })
        return
      }
      const at = insertAtCaret(text)
      // A big paste becomes a fold block right away (hover peeks
      // at it); an existing block is replaced by the new paste's span.
      // The EXPANDED editor never folds — pasting there is plain text
      // (fold semantics would clamp the caret out of the pasted span).
      if (!expandedRef.current && isBigInput(text)) updateFoldBlock({ start: at, end: at + text.length })
      return
    }

    // Clipboard paste (default Ctrl+V / Cmd+V, plus the Alt+V alias for
    // terminals that intercept Ctrl+V — combos are user-remappable via
    // /settings): raw mode hands the key to the app, so the clipboard is
    // read here — text, file paths when the file manager copied files, or
    // an exported temp-file path when the clipboard holds a raw image.
    if (actionMatches('paste', input, key)) {
      if (clipboardBusyRef.current) return
      const lease = captureDraftImageLease()
      // Match insertAtCaret's overlay/selection dismissal up front: the
      // async continuation below only sets value/cursor, so a paste landing
      // while the help overlay is open would otherwise insert behind it.
      if (helpOpen) onToggleHelp()
      setSelectedCommand(0)
      setFileSelected(0)
      clipboardBusyRef.current = true
      void readClipboard()
        .then(async content => {
          // Every `kind: image` path is a private temp export owned by this
          // paste, including TIFF/BMP/SVG formats the attachment profile
          // cannot stage. Ownership must not depend on format support.
          const temporaryImagePath = content?.kind === 'image' ? content.path : undefined
          try {
            if (!draftImageLeaseIsCurrent(lease)) return
            if (content === null) {
              channel.notify(t('input-clipboard-empty'), { color: 'warning' })
              return
            }
            if (content.kind === 'unavailable') {
              channel.notify(t('input-clipboard-unavailable'), { color: 'warning' })
              return
            }
            if (content.kind === 'image') {
              if (imagePathMediaType(content.path) === undefined) {
                channel.notify(t('input-image-format-unsupported'), { color: 'warning', timeoutMs: 5000 })
                return
              }
              try {
                await enqueueImageWork(async () => {
                  const handle = await stageImagePath(content.path, lease)
                  const token = bindStagedImage(handle, lease)
                  insertClipboardAtCaret(`${token} `)
                  channel.notify(stagedImageNotice(token, handle), { timeoutMs: 2500 })
                })
              } catch (error: unknown) {
                if (!draftImageLeaseIsCurrent(lease)) return
                const message = error instanceof Error ? error.message : String(error)
                channel.notify(t('input-image-paste-failed', { err: message }), { color: 'warning', timeoutMs: 5000 })
              }
              return
            }
            if (content.kind === 'files') {
              // Finder/Explorer-copied image FILES stage like clipboard
              // bitmaps (macOS furl offers exactly one). Other files keep the
              // quoted/@ path insert, and an image that fails to stage falls
              // back to its `@` reference — the mention pipeline still
              // attaches it at submit.
              let insertedStaged = false
              try {
                insertedStaged = await enqueueImageWork(async () => {
                  const maxImages = channel.stagedImageLimits?.()?.maxImagesPerMessage ?? 0
                  const { parts, staged, failure, failureCode } = await stageClipboardFilePaths(
                    content.paths,
                    path => stageImagePath(path, lease),
                    filePath => formatClipboardInsert({ kind: 'files', paths: [filePath] }),
                    Math.max(0, maxImages - draftImagesRef.current.size),
                  )
                  if (!draftImageLeaseIsCurrent(lease)) {
                    discardStagedHandles(staged)
                    return true
                  }
                  const boundTokens: string[] = []
                  try {
                    const rendered = parts.map(part => {
                      if (part.kind === 'text') return part.value
                      const token = bindStagedImage(part.value, lease)
                      boundTokens.push(token)
                      return token
                    })
                    if (failure !== '') {
                      const message = failureCode === 'image-limit' ? t('input-image-paste-limit') : failure
                      channel.notify(t('input-image-paste-failed', { err: message }), { color: 'warning', timeoutMs: 5000 })
                    }
                    if (boundTokens.length === 0) return false
                    // All bindings and their visible labels enter together;
                    // typing while an earlier file saves cannot prune one.
                    insertClipboardAtCaret(`${rendered.join(' ')} `)
                    // A batch cannot itemise every image in one line, but it must
                    // still say that some of them were not stored as pasted.
                    const adapted = staged.filter(handle => handle.adjustment !== undefined).length
                    channel.notify(
                      boundTokens.length === 1
                        ? stagedImageNotice(boundTokens[0]!, staged[0]!)
                        : adapted > 0
                          ? t('input-images-staged-adapted', { count: boundTokens.length, adapted })
                          : t('input-images-staged', { count: boundTokens.length }),
                      { timeoutMs: 2500 },
                    )
                    return true
                  } catch (error) {
                    for (const token of boundTokens) draftImagesRef.current.delete(token)
                    discardStagedHandles(staged)
                    throw error
                  }
                })
              } catch (error: unknown) {
                if (!draftImageLeaseIsCurrent(lease)) return
                const message = error instanceof Error ? error.message : String(error)
                channel.notify(t('input-image-paste-failed', { err: message }), { color: 'warning', timeoutMs: 5000 })
              }
              if (insertedStaged) return
              // Nothing staged: fall through to the verbatim files insert.
            }
            if (!draftImageLeaseIsCurrent(lease)) return
            // Insert against the LIVE input state: the read above resolved
            // asynchronously and the user may have typed while waiting.
            const text = sanitizeEditableText(formatClipboardInsert(content))
            const { at } = insertClipboardAtCaret(text)
            // Same fold as bracketed paste — but never inside the expanded
            // editor (plain text there, see the isPasted branch).
            if (!expandedRef.current && isBigInput(text)) updateFoldBlock({ start: at, end: at + text.length })
          } finally {
            // Clipboard bitmaps are private temp exports owned by this paste,
            // never durable attachment storage. Clean them on success,
            // rejection, draft invalidation, and session replacement alike.
            if (temporaryImagePath !== undefined) {
              await unlink(temporaryImagePath).catch(() => undefined)
            }
          }
        })
        .catch(() => {
          if (!draftImageLeaseIsCurrent(lease)) return
          channel.notify(t('input-clipboard-read-failed'), { color: 'warning' })
        })
        .finally(() => {
          // A rejected read must never wedge Ctrl+V for the rest of the
          // session.
          clipboardBusyRef.current = false
        })
      return
    }

    // Help is modal for modified keys and every Enter variant. The paste
    // branch above is the intentional exception: paste closes Help and
    // inserts visibly.
    // Swallow here before editor/submit/interrupt branches can mutate hidden
    // composer or working-turn state; plain typing still dismisses Help below.
    if (helpOpen && !key.escape && (key.ctrl || key.meta || key.super || key.return || input.includes('\n') || input.includes('\r'))) {
      event.stopImmediatePropagation()
      return
    }

    // Ctrl+G (remappable via /settings): edit the current draft in
    // $VISUAL/$EDITOR (issue #123, readline's edit-and-execute-command). The
    // draft is written to a temp file, the terminal is handed to the editor
    // (Ink's alt-screen handoff), and the saved text replaces the input when
    // it differs. The util maps every failure to an outcome, but the
    // catch/finally here is the hard guarantee: a rejected promise must
    // never kill the process, and the busy flag must always clear or the
    // editor key stays locked forever.
    if (actionMatches('editor', input, key)) {
      // Opening the editor starts a new async draft lifecycle immediately:
      // fence an older paste before the terminal handoff, but retain already
      // bound image capabilities. setInput below prunes only tokens the user
      // actually removed in the editor.
      syncImageGeneration()
      advanceDraftRevision()
      const editorLease = captureDraftImageLease()
      editorBusyRef.current = true
      void (async () => {
        try {
          const outcome = await editInExternalEditor(value)
          // Session switches, clears, history restores, and unmount all
          // revoke this editor round-trip. Never write its old draft into a
          // newer composer after the terminal handoff returns.
          if (!draftImageLeaseIsCurrent(editorLease)) return
          if (outcome.kind === 'edited') {
            updateFoldBlock(null)
            setInput(outcome.text)
            setSelectedCommand(0)
            setFileSelected(0)
          } else if (outcome.kind === 'unavailable') {
            channel.notify(t('input-editor-unavailable'), { color: 'warning' })
          } else if (outcome.kind === 'failed') {
            channel.notify(t('input-editor-failed', { name: outcome.message }), {
              color: 'warning',
            })
          }
        } catch {
          if (!draftImageLeaseIsCurrent(editorLease)) return
          channel.notify(t('input-editor-failed', { name: 'unknown' }), {
            color: 'warning',
          })
        } finally {
          editorBusyRef.current = false
        }
      })()
      return
    }

    // Ctrl+J is the portable multiline fallback when a terminal cannot
    // report modifiers on Enter. Legacy terminals deliver bare LF (`enter`),
    // while kitty/modifyOtherKeys encode it as an exact Ctrl+J key.
    const isCtrlJ = input === 'j' && key.ctrl && !key.shift && !key.meta && !key.super
    if ((input === '\n' && event?.keypress.name === 'enter') || isCtrlJ) {
      insertAtCaret('\n')
      return
    }

    // Whole-line input from Windows ConPTY pipelines (cmd batch -> node):
    // the trailing CR/LF marks a complete line to submit. A bare CR/CRLF is
    // Enter, while real multi-char piped lines keep the legacy direct-submit
    // path. The expanded editor treats piped lines as DATA — CR/LF
    // normalizes to '\n' and inserts (sending needs Ctrl+Enter there), so a
    // fast batch never dumps raw '\r' into the draft.
    if (input.includes('\n') || input.includes('\r')) {
      if (expandedRef.current) {
        insertAtCaret(
          sanitizeEditableText(input.replace(/\r\n/g, '\n').replace(/\r/g, '\n')),
        )
        return
      }
      if (/^[\r\n]+$/.test(input)) {
        handleEnter()
        return
      }
      const line = (value + input).trim()
      if (line.startsWith('/')) {
        const matches = channel.commandCompletions(line)
        if (matches.length === 1) {
          tryRunCommand(matches[0]!.commandLine)
          return
        }
      }
      if (!tryRunCommand(line)) submitText(line)
      return
    }
    if (key.return && isMod(key)) {
      // Ctrl+Enter / Cmd+Enter: in the EXPANDED editor this is the explicit
      // send (Enter inserts newlines there, so sending needs its own key);
      // inline it interrupts the running turn and processes this message
      // immediately (Windows Terminal sends CSI 13;5u / 13;1;5u).
      if (expandedRef.current) {
        submitFromEditor()
      } else {
        interruptSend()
      }
      return
    }
    if (key.return && (key.shift || key.meta)) {
      // Shift+Enter / Option+Enter: insert a newline at the caret
      // (multi-line input). Shift+Enter only arrives when the terminal
      // supports extended key reporting (kitty/modifyOtherKeys allowlist in
      // ink/terminal.ts); Option+Enter (ESC CR) is the fallback on terminals
      // that can't report shift — e.g. macOS Terminal.app (issue #110).
      insertAtCaret('\n')
      return
    }
    if (key.return && expandedRef.current) {
      // Expanded editor: plain Enter inserts a newline (text-editor
      // semantics — long-draft editing must never misfire a send). The
      // shift/meta variants above already newline; Ctrl+Enter sends.
      insertAtCaret('\n')
      return
    }
    if (key.return) {
      handleEnter()
      return
    }
    // Help is modal over the composer. Backtab must not cycle the session
    // mode invisibly behind it, and plain Tab has no Help action.
    if (helpOpen && key.tab) {
      event.stopImmediatePropagation()
      return
    }
    // Completion menus own Backtab just like plain Tab; do not mutate the
    // background session mode while the user is choosing a candidate.
    if (key.tab && key.shift && (fileOverlayOpen || overlayOpen)) {
      event.stopImmediatePropagation()
      return
    }
    // Shift+Tab cycles the configured session modes (default: 默认 →
    // 计划模式 → 完全访问; each mode bundles plan/sandbox/approval atoms —
    // see the `modes` config). Must precede the fullscreen editor's Tab
    // indentation arm so the expanded editor participates in the cycle too —
    // the parser reports backtab as key.tab + key.shift.
    if (key.tab && key.shift) {
      void channel.cycleMode()
      return
    }
    // Expanded editor: plain Tab inserts indentation; Shift+Tab was handled
    // above and therefore never disappears behind the fullscreen cover.
    if (expandedRef.current && key.tab) {
      if (!key.shift) insertAtCaret('    ')
      return
    }
    if (key.tab && fileOverlayOpen) {
      const file = fileMatches[fileSelected]
      if (file) acceptFile(file)
      return
    }
    if (key.tab && overlayOpen) {
      const command = suggestions[selectedCommand]
      if (command) {
        updateFoldBlock(null)
        setInput(command.replacement)
      }
      return
    }
    // Tab while the model is working = queue for AFTER the turn (followup),
    // distinct from Enter's steer (Codex's "tab to queue message").
    if (key.tab && channel.working && value.trim() !== '') {
      queueSend(value)
      return
    }
    // Idle plain Tab enters the transcript selection mode (grok-style focus
    // rotation). Every earlier Tab owner has returned by here: completion
    // overlays, the expanded editor's indentation, and the working-queue
    // followup above. Backtab (Shift+Tab, session cycling) never reaches
    // this branch.
    if (key.tab && !key.shift) {
      event?.stopImmediatePropagation()
      onEnterSelection?.()
      return
    }
    // Help is a viewport, not prompt history. It deliberately owns every
    // vertical navigation event while visible; otherwise Up/Down silently
    // walk the input history and the clipped command rows remain unreachable.
    if (helpOpen) {
      const page = Math.max(1, helpViewportHeight - 2)
      if (key.upArrow || key.wheelUp) {
        helpScrollRef.current?.scrollBy(key.wheelUp ? -3 : -1)
        event.stopImmediatePropagation()
        return
      }
      if (key.downArrow || key.wheelDown) {
        helpScrollRef.current?.scrollBy(key.wheelDown ? 3 : 1)
        event.stopImmediatePropagation()
        return
      }
      if (key.pageUp || key.pageDown) {
        helpScrollRef.current?.scrollBy(key.pageUp ? -page : page)
        event.stopImmediatePropagation()
        return
      }
      if (key.home) {
        helpScrollRef.current?.scrollTo(0)
        event.stopImmediatePropagation()
        return
      }
      if (key.end) {
        // Use a deliberately oversized absolute target rather than the
        // sticky-bottom path: compact Help may still be measuring nested
        // sections in this commit, while ScrollBox's render clamp resolves
        // the target to the exact current maximum without a follow-up frame.
        helpScrollRef.current?.scrollTo(Number.MAX_SAFE_INTEGER)
        event.stopImmediatePropagation()
        return
      }
    }
    if (key.meta && key.upArrow) {
      // Alt+Up: pull the last pending message back for editing (pi/Codex).
      pullBackLast()
      return
    }
    if (key.upArrow) {
      // A history walk owns the arrows until it returns to the draft: a
      // recalled entry can itself open the @ menu or the slash menu (e.g.
      // `/model`), and letting the overlay navigate here strands the stashed
      // draft — Down would cycle menu rows instead of walking back.
      if (fileOverlayOpen && historyIndex.current < 0) {
        setFileSelected(index =>
          index <= 0 ? fileMatches.length - 1 : index - 1,
        )
        return
      }
      // With a fold block the caret in the tail walks the TAIL's lines
      // (the block is one atomic row); the first tail line steps over the
      // block to its head.
      if (block && cursor >= block.end) {
        const tailCursor = cursor - block.end
        const line = cursorLine(tail, tailCursor)
        if (line > 0) {
          const upToLineStart = tail.lastIndexOf('\n', tailCursor - 1)
          const prevLineStart =
            upToLineStart === -1 ? 0 : tail.lastIndexOf('\n', upToLineStart - 1) + 1
          const prevLine = tail.slice(prevLineStart, upToLineStart)
          setInput(
            value,
            block.end + prevLineStart + Math.min(cursorColumn(tail, tailCursor), prevLine.length),
          )
          return
        }
        setInput(value, block.start)
        return
      }
      const line = cursorLine(value, cursor)
      if (line > 0) {
        // Move to the previous line, clamping to its length.
        const upToLineStart = value.lastIndexOf('\n', cursor - 1)
        const prevLineStart =
          upToLineStart === -1 ? 0 : value.lastIndexOf('\n', upToLineStart - 1) + 1
        const prevLine = value.slice(prevLineStart, upToLineStart)
        setInput(value, prevLineStart + Math.min(cursorColumn(value, cursor), prevLine.length))
        return
      }
      if (overlayOpen && historyIndex.current < 0) {
        setSelectedCommand(index =>
          index <= 0 ? suggestions.length - 1 : index - 1,
        )
        return
      }
      seedHistory()
      if (history.current.length === 0) return
      if (historyIndex.current < 0) {
        historyDraft.current = {
          text: value,
          images: imageRefsFor(value),
        }
        historyIndex.current = history.current.length - 1
      } else {
        historyIndex.current = Math.max(0, historyIndex.current - 1)
      }
      const entry = history.current[historyIndex.current]
      if (entry === undefined) return
      retractRecalledCopy(entry.text)
      updateFoldBlock(null)
      restoreDraftImages(entry)
      setInput(entry.text)
      return
    }
    if (key.downArrow) {
      // Same history-walk ownership as ↑ above.
      if (fileOverlayOpen && historyIndex.current < 0) {
        setFileSelected(index =>
          index >= fileMatches.length - 1 ? 0 : index + 1,
        )
        return
      }
      // Mirror of the tail-side ↑ walk: with a fold block the caret walks
      // the TAIL's lines; past its last line it falls through to the
      // overlay/history handling below.
      if (block && cursor >= block.end) {
        const tailCursor = cursor - block.end
        const line = cursorLine(tail, tailCursor)
        const lines = tail.split('\n')
        if (line < lines.length - 1) {
          const nextLineStart = tail.indexOf('\n', tailCursor) + 1
          const nextLineEnd = tail.indexOf('\n', nextLineStart)
          const nextLine = tail.slice(
            nextLineStart,
            nextLineEnd === -1 ? tail.length : nextLineEnd,
          )
          setInput(
            value,
            block.end + nextLineStart + Math.min(cursorColumn(tail, tailCursor), nextLine.length),
          )
          return
        }
      } else if (block && cursor <= block.start) {
        // Head side: walk the HEAD's lines; its last line steps over the
        // block to the tail (never into history for a multi-row input).
        const line = cursorLine(head, cursor)
        const lines = head.split('\n')
        if (line < lines.length - 1) {
          const nextLineStart = head.indexOf('\n', cursor) + 1
          const nextLineEnd = head.indexOf('\n', nextLineStart)
          const nextLine = head.slice(
            nextLineStart,
            nextLineEnd === -1 ? head.length : nextLineEnd,
          )
          setInput(
            value,
            nextLineStart + Math.min(cursorColumn(head, cursor), nextLine.length),
          )
          return
        }
        setInput(value, block.end)
        return
      }
      const line = cursorLine(value, cursor)
      const lines = value.split('\n')
      if (line < lines.length - 1) {
        const nextLineStart = value.indexOf('\n', cursor) + 1
        const nextLineEnd = value.indexOf('\n', nextLineStart)
        const nextLine = value.slice(
          nextLineStart,
          nextLineEnd === -1 ? value.length : nextLineEnd,
        )
        setInput(value, nextLineStart + Math.min(cursorColumn(value, cursor), nextLine.length))
        return
      }
      if (overlayOpen && historyIndex.current < 0) {
        setSelectedCommand(index =>
          index >= suggestions.length - 1 ? 0 : index + 1,
        )
        return
      }
      if (historyIndex.current < 0) return
      if (historyIndex.current >= history.current.length - 1) {
        historyIndex.current = -1
        updateFoldBlock(null)
        restoreDraftImages(historyDraft.current)
        setInput(historyDraft.current.text)
      } else {
        historyIndex.current += 1
        const entry = history.current[historyIndex.current]
        if (entry !== undefined) {
          restoreDraftImages(entry)
          setInput(entry.text)
        }
      }
      return
    }
    if (isMod(key) && key.leftArrow) {
      // Jump to the previous word boundary (readline alt+b). Must precede the
      // bare-arrow arms: Ctrl+Left arrives as leftArrow + ctrl. An active
      // selection collapses to its START edge first (editor semantics).
      const sel = selectionRef.current
      setInput(value, sel ? sel.start : wordBoundaryLeft(value, cursor))
      return
    }
    if (isMod(key) && key.rightArrow) {
      // Jump to the next word boundary (readline alt+f).
      const sel = selectionRef.current
      setInput(value, sel ? sel.end : wordBoundaryRight(value, cursor))
      return
    }
    if (key.leftArrow) {
      // ← on an EMPTY prompt backgrounds this session
      // and opens the agent view; with text it moves the caret as usual.
      // (The command/file overlays both imply non-empty text, so no extra
      // gate beyond the help menu is needed.)
      if (value.length === 0 && !helpOpen) {
        onBackgroundRequest?.()
        return
      }
      // Grapheme-step: skip the whole cluster (surrogate pair, ZWJ emoji,
      // combining mark) so the caret never sits inside one. With a
      // selection, collapse to its start edge instead.
      const sel = selectionRef.current
      setInput(value, sel ? sel.start : previousGraphemeBoundary(bounds, cursor))
      return
    }
    if (key.rightArrow) {
      const sel = selectionRef.current
      setInput(value, sel ? sel.end : nextGraphemeBoundary(bounds, cursor))
      return
    }
    if (key.backspace) {
      if (cursor === 0) return
      const start = previousGraphemeBoundary(bounds, cursor)
      deleteInputRange(start, cursor)
      return
    }
    if (key.delete) {
      const end = nextGraphemeBoundary(bounds, cursor)
      if (end === cursor) return
      deleteInputRange(cursor, end)
      return
    }
    if (key.home) {
      // Start of the current line (the block is one atomic row).
      const lineStart = clampRowStart(value.lastIndexOf('\n', cursor - 1) + 1)
      setInput(value, lineStart)
      return
    }
    if (key.end) {
      // End of the current line.
      const nextLine = value.indexOf('\n', cursor)
      setInput(value, nextLine === -1 ? value.length : clampRowEnd(nextLine))
      return
    }
    if (isMod(key) && input === 'a') {
      const lineStart = clampRowStart(value.lastIndexOf('\n', cursor - 1) + 1)
      setInput(value, lineStart)
      return
    }
    if (isMod(key) && input === 'e') {
      const nextLine = value.indexOf('\n', cursor)
      setInput(value, nextLine === -1 ? value.length : clampRowEnd(nextLine))
      return
    }
    if (isMod(key) && input === 'u') {
      // Delete to start of line (never into the block).
      const lineStart = clampRowStart(value.lastIndexOf('\n', cursor - 1) + 1)
      deleteInputRange(lineStart, cursor)
      return
    }
    if (isMod(key) && input === 'k') {
      // Delete to end of line (never into the block).
      const nextLine = value.indexOf('\n', cursor)
      const end = nextLine === -1 ? value.length : clampRowEnd(nextLine)
      deleteInputRange(cursor, end)
      return
    }
    if (isMod(key) && input === 'w') {
      // Delete the word before the cursor: skip
      // trailing whitespace, then the whitespace-delimited word. The
      // deletion start never crosses into the block.
      const before = value.slice(0, cursor)
      let end = before.length
      while (end > 0 && /\s/.test(before[end - 1]!)) end--
      let start = end
      while (start > 0 && !/\s/.test(before[start - 1]!)) start--
      deleteInputRange(clampRowStart(start), cursor)
      return
    }
    // ── vim mode (`/vim`) ──────────────────────────────────────────────
    // INSERT submode: only Esc is intercepted (back to NORMAL — the usual
    // clear/rewind Esc semantics stay disabled while vim is on).
    // NORMAL submode: bare characters and Esc are vim keys; help/command/
    // file overlays, modified combos, Tab, Enter, arrows and other
    // structured keys keep their existing handlers.
    const vimNormalEdit = (next: string, cursorOffset: number) => {
      updateFoldBlock(null)
      setInput(next, cursorOffset)
      setSelectedCommand(0)
      setFileSelected(0)
    }
    const vimPushUndo = () => {
      const images = imageRefsFor(valueRef.current)
      const evicted = vimUndoRef.current.length >= 100 ? vimUndoRef.current.shift() : undefined
      vimUndoRef.current.push({ text: valueRef.current, cursor: cursorRef.current, images })
      if (evicted !== undefined) discardUnretainedImages(evicted.images.map(image => image.stageId))
    }
    const vimDeleteRange = (start: number, end: number): void => {
      if (start >= end) return
      vimPushUndo()
      updateFoldBlock(null)
      deleteInputRange(start, end)
      setSelectedCommand(0)
      setFileSelected(0)
    }
    const handleVimNormal = (input: string) => {
      // One stdin batch can merge several bare keys into a single event
      // (fast typing), so re-read the synchronous mirrors and recompute
      // the grapheme boundaries: every key in the batch operates on the
      // text/caret its predecessor produced (the outer `value`/`cursor`/
      // `bounds` reflect only the batch's first key).
      const value = valueRef.current
      const cursor = cursorRef.current
      const bounds = graphemeBoundaries(value)
      const pending = vimPendingRef.current
      vimPendingRef.current = ''
      // Operator pending (`d`): the second key picks the target.
      if (pending === 'd') {
        switch (input) {
          case 'd': { // delete the whole line, newline included (vim `dd`);
            // the last line has no newline — its content is cleared
            const lineStart = vimLineStart(value, cursor)
            const lineEnd = vimLineEnd(value, cursor)
            const end = lineEnd < value.length ? lineEnd + 1 : lineEnd
            vimDeleteRange(lineStart, end)
            return
          }
          case '$': { // delete to end of line
            const end = vimLineEnd(value, cursor)
            vimDeleteRange(cursor, end)
            return
          }
          case '0':
          case '^': { // delete to start of line
            const start =
              input === '^' ? vimLineFirstNonBlank(value, cursor) : vimLineStart(value, cursor)
            vimDeleteRange(start, cursor)
            return
          }
          case 'w': { // delete to end of word
            const end = vimWordEnd(value, cursor)
            vimDeleteRange(cursor, end)
            return
          }
          default:
            return // unrecognized second key: cancel the operator, drop it
        }
      }
      switch (input) {
        case 'h':
          setInput(value, previousGraphemeBoundary(bounds, cursor))
          return
        case 'l':
          setInput(value, nextGraphemeBoundary(bounds, cursor))
          return
        case 'j': { // down one line (single-line input: no-op)
          const line = cursorLine(value, cursor)
          const lines = value.split('\n')
          if (line >= lines.length - 1) return
          const col = Math.min(cursorColumn(value, cursor), (lines[line + 1] ?? '').length)
          setInput(value, vimLineEnd(value, cursor) + 1 + col)
          return
        }
        case 'k': { // up one line
          const line = cursorLine(value, cursor)
          if (line <= 0) return
          const lines = value.split('\n')
          const col = Math.min(cursorColumn(value, cursor), (lines[line - 1] ?? '').length)
          const prevStart = vimLineStart(value, vimLineStart(value, cursor) - 1)
          setInput(value, prevStart + col)
          return
        }
        case '0': {
          setInput(value, vimLineStart(value, cursor))
          return
        }
        case '^': {
          setInput(value, vimLineFirstNonBlank(value, cursor))
          return
        }
        case '$': {
          setInput(value, vimLineEnd(value, cursor))
          return
        }
        case 'w':
          setInput(value, vimWordForward(value, cursor))
          return
        case 'b':
          setInput(value, vimWordBackward(value, cursor))
          return
        case 'x': { // delete the character at the caret; at the very end of
          // the text delete the last character (vim: the caret sits ON the
          // last char after `$`, so `x` must still delete it). Same rule
          // when the caret sits right before a '\n' mid-draft — after `$`
          // the caret is on the line's last char, `x` must delete THAT
          // char, not the newline (which would join the lines).
          if (cursor > 0 && (cursor === value.length || value[cursor] === '\n')) {
            const start = previousGraphemeBoundary(bounds, cursor)
            vimDeleteRange(start, cursor)
            return
          }
          const end = nextGraphemeBoundary(bounds, cursor)
          if (end === cursor) return
          vimDeleteRange(cursor, end)
          return
        }
        case 'X': { // delete the character before the caret
          if (cursor === 0) return
          const start = previousGraphemeBoundary(bounds, cursor)
          vimDeleteRange(start, cursor)
          return
        }
        case 'd':
          vimPendingRef.current = 'd'
          return
        case 'u': { // undo the last vim edit
          syncImageGeneration()
          const prev = vimUndoRef.current.pop()
          if (prev === undefined) return
          advanceDraftRevision()
          replaceDraftImages(prev.images)
          updateFoldBlock(null)
          setInput(prev.text, prev.cursor)
          setSelectedCommand(0)
          setFileSelected(0)
          return
        }
        case 'i': // insert at the caret
          vimInsertRef.current = true
          setVimInsert(true)
          return
        case 'I': { // insert at the line's first non-blank (vim `I`)
          setInput(value, vimLineFirstNonBlank(value, cursor))
          vimInsertRef.current = true
          setVimInsert(true)
          return
        }
        case 'a': { // insert after the caret
          setInput(value, nextGraphemeBoundary(bounds, cursor))
          vimInsertRef.current = true
          setVimInsert(true)
          return
        }
        case 'A': { // insert at the line end
          setInput(value, vimLineEnd(value, cursor))
          vimInsertRef.current = true
          setVimInsert(true)
          return
        }
        case 'o': { // new line below, then insert
          vimPushUndo()
          const end = vimLineEnd(value, cursor)
          vimNormalEdit(value.slice(0, end) + '\n' + value.slice(end), end + 1)
          vimInsertRef.current = true
          setVimInsert(true)
          return
        }
        case 'O': { // new line above, then insert
          vimPushUndo()
          const start = vimLineStart(value, cursor)
          vimNormalEdit(value.slice(0, start) + '\n' + value.slice(start), start)
          vimInsertRef.current = true
          setVimInsert(true)
          return
        }
        default:
          return // unrecognized key: ignored (never inserts in NORMAL)
      }
    }
    if (vimEnabledRef.current) {
      if (vimInsertRef.current) {
        // INSERT: Esc returns to NORMAL instead of the clear/rewind path.
        if (key.escape && !helpOpen && !overlayOpen && !fileOverlayOpen) {
          event.stopImmediatePropagation()
          vimInsertRef.current = false
          setVimInsert(false)
          return
        }
      } else if (!helpOpen && !overlayOpen && !fileOverlayOpen) {
        if (key.escape) {
          // NORMAL: Esc cancels a pending operator and otherwise no-ops
          // (the clear/rewind double-Esc semantics belong to non-vim mode).
          vimPendingRef.current = ''
          event.stopImmediatePropagation()
          return
        }
        const plainChar =
          input.length > 0 &&
          !key.ctrl && !key.meta && !key.super && !key.tab && !key.return
        if (plainChar) {
          // `?` on an empty input falls through to the help shortcut below.
          if (input === '?' && value.length === 0) return
          // `/` opens the slash-command menu even in NORMAL: insert it and
          // switch to INSERT so the rest of the command types normally
          // (the menu then owns the keys while it is open).
          if (input === '/') {
            const text = valueRef.current
            const pos = cursorRef.current
            const next = text.slice(0, pos) + '/' + text.slice(pos)
            setInput(next, pos + 1)
            setSelectedCommand(0)
            setFileSelected(0)
            vimInsertRef.current = true
            setVimInsert(true)
            return
          }
          event.stopImmediatePropagation()
          // A merged multi-char event (fast typing) is one vim key per
          // character — handleVimNormal re-reads the refs each call, so a
          // batch like `dd` works exactly like two separate keypresses.
          // Once a key switches back to INSERT (i/a/o/…), the remaining
          // characters of the batch are ordinary typing and insert as text.
          for (let i = 0; i < input.length; i++) {
            if (vimInsertRef.current) {
              const rest = input.slice(i)
              const text = valueRef.current
              const pos = cursorRef.current
              const next = text.slice(0, pos) + rest + text.slice(pos)
              setInput(next, pos + rest.length)
              setSelectedCommand(0)
              setFileSelected(0)
              break
            }
            handleVimNormal(input[i]!)
          }
          return
        }
      }
    }

    if (key.escape) {
      if (helpOpen) {
        onToggleHelp()
        return
      }
      // A single Esc closes the open command menu first;
      // the double-tap-clear semantics only apply to ordinary input.
      if (overlayOpen) {
        syncImageGeneration()
        discardDraftImages()
        setInput('', 0)
        setSelectedCommand(0)
        setFileSelected(0)
        return
      }
      // File overlay: Esc dismisses the menu for THIS token only — clearing
      // the input would nuke a mid-message `@` mention's surrounding text.
      if (fileOverlayOpen) {
        fileEscRef.current = mention?.start ?? -1
        return
      }
      // With pending messages while working, Esc = interrupt and deliver
      // them right away (Codex's "interrupt and send immediately"): the
      // turn is aborted and each message is re-queued once it settles.
      if (channel.working && channel.pending.length > 0) {
        const count = channel.interruptAndDeliver(channel.pending.map(item => ({
          text: item.text,
          images: item.images ?? [],
        })))
        channel.notify(t('interrupt-delivered', { n: count }), {
          timeoutMs: 2500,
        })
        return
      }
      // A single Esc clears the current input (if any); the double-tap
      // path below handles rewind/clear on an already-empty input. A BIG
      // input folds into a block instead (Esc = the fold toggle; the
      // expand → fold → expand cycle is lossless, and clearing a big draft
      // stays reachable via the block-delete Backspace or Ctrl+C).
      if (value.length > 0) {
        if (isBigInput(value)) {
          updateFoldBlock({ start: 0, end: value.length })
          setSelectedCommand(0)
          setFileSelected(0)
          return
        }
        syncImageGeneration()
        discardDraftImages()
        setInput('', 0)
        setSelectedCommand(0)
        setFileSelected(0)
        return
      }
      // Double-tap Esc: clear the input when it has content; when empty,
      // open the rewind picker (double-tap Esc rewinds the selected message
      // and/or conversation to a previous point in time).
      if (escPendingRef.current) {
        escPendingRef.current = false
        if (escTimerRef.current) clearTimeout(escTimerRef.current)
        if (value.length === 0) {
          onRewindRequest?.()
        } else {
          syncImageGeneration()
          discardDraftImages()
          setInput('', 0)
        }
        return
      }
      escPendingRef.current = true
      channel.notify(
        value.length === 0 ? t('esc-again-rewind') : t('esc-again-clear'),
      )
      escTimerRef.current = setTimeout(() => {
        escPendingRef.current = false
      }, 3000)
      return
    }
    if (input === '?' && value.length === 0 && !expandedRef.current) {
      onToggleHelp()
      return
    }
    if (input && !key.ctrl && !key.meta && !key.super && !key.tab && !key.escape) {
      // Typing anything else dismisses the help menu.
      if (helpOpen) onToggleHelp()
      // An active selection is REPLACED by the typed text, caret after it.
      const sel = selectionRef.current
      const at = sel ? sel.start : cursor
      const next = sel
        ? value.slice(0, sel.start) + input + value.slice(sel.end)
        : value.slice(0, cursor) + input + value.slice(cursor)
      setInput(next, at + input.length)
      setSelectedCommand(0)
      setFileSelected(0)
    }
  }
}

/** Deps for {@link createHandleEnter}: the Enter main path shared by the
 *  keyboard factory and the fullscreen editor's explicit send. */
export type HandleEnterDeps = {
  lastEnterAtRef: RefObject<number>
  valueRef: RefObject<string>
  overlayOpen: boolean
  suggestions: readonly CommandCompletion[]
  selectedCommand: number
  tryRunCommand: (text: string) => boolean
  fileOverlayOpen: boolean
  fileMatches: readonly FileCandidate[]
  fileSelected: number
  acceptFile: (candidate: FileCandidate) => void
  channel: Channel
  steerSend: (text: string) => void
  submitText: (text: string, notice?: string) => void
}

/** Enter 的主路径（cmd 管道双事件去抖、overlay 归属、运行中 steer 豁免、
 *  命令/文本提交）。独立导出：PromptInput 的 submitFromEditor 与键盘
 *  工厂（经 deps.handleEnter）共用同一条语义。 */
export function createHandleEnter(deps: HandleEnterDeps): () => void {
  const {
    lastEnterAtRef, valueRef, overlayOpen, suggestions, selectedCommand,
    tryRunCommand, fileOverlayOpen, fileMatches, fileSelected, acceptFile,
    channel, steerSend, submitText,
  } = deps
  return () => {
    // A single Enter can arrive as two events in cmd pipelines (`\r`
    // parsed as return + a raw `\n` line): collapse them so one keypress
    // never sends the message twice.
    const now = Date.now()
    if (now - lastEnterAtRef.current < 80) return
    lastEnterAtRef.current = now
    const value = valueRef.current
    if (overlayOpen) {
      const command = suggestions[selectedCommand]
      if (command) {
        tryRunCommand(command.commandLine)
        return
      }
    }
    // File-completion overlay open → Enter accepts the selection (same
    // contract as the command menu: the overlay owns Enter while open).
    if (fileOverlayOpen) {
      const file = fileMatches[fileSelected]
      if (file) {
        acceptFile(file)
        return
      }
    }
    if (channel.working && value.trim() !== '') {
      // Immediate-command semantics: /btw and /skills are exempt from
      // steering — neither command interrupts the running turn. Hidden
      // UI-only easter eggs (e.g. /deepseek) are also safe to run while
      // streaming. Every other input keeps the steer behavior so /new
      // /model etc. stay idle-only.
      const parsed = value.startsWith('/') ? parseCommandName(value) : undefined
      if (parsed !== undefined && (
        ((parsed.name === 'btw' || parsed.name === 'skills')
          && channel.commandList.some(c => c.name === parsed.name))
        || isHiddenCommandName(parsed.name)
      )) {
        if (tryRunCommand(value)) return
      }
      steerSend(value)
      return
    }
    if (!tryRunCommand(value)) submitText(value)
  }
}
