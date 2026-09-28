import React from 'react'
import { open } from 'node:fs/promises'
import { resolve } from 'node:path'
import { t } from '../i18n.js'
import { Box, Text, useInput, useTerminalSize, useTheme, type ScrollBoxHandle } from '../ui.js'
import { EffortChargeGlyph } from './EffortChargeGlyph.js'
import { EffortInputBorder, type InputBorderLabel } from './EffortInputBorder.js'
import { EffortTierBadge } from './EffortTierBadge.js'
import { isLightThemeActive } from '../theme.js'
import { sessionColorHex } from '../terminal-utils/sessionColors.js'
import { useDeclaredCursor } from '../ink/hooks/use-declared-cursor.js'
import type { ClickEvent } from '../ink/events/click-event.js'
import type { DragEvent } from '../ink/events/drag-event.js'
import { TerminalWriteContext } from '../ink/useTerminalNotification.js'
import { setClipboard } from '../ink/termio/osc.js'
import { noteAuxNumber } from '../ink/geometry-trace.js'
import instances from '../ink/instances.js'
import { stringWidth } from '../ink/stringWidth.js'
import { truncateToWidth } from '../ink/truncateToWidth.js'
import { setPromptEditorNode, EditorButton } from './PromptEditor.js'
import type { ChannelUi as Channel } from '../adapter/channel/ui-policy.js'
import type { ComposerImageRef } from '../dsh-adapter/channel.js'
import type { TranscriptImage } from '../dsh-adapter/transcript-images.js'
import { isHiddenCommandName, parseCommandName } from '../commands.js'
import { appendHistory, HISTORY_LIMIT, loadHistoryOldestFirst } from '../history.js'
import { mentionAtCaret } from '../utils/mentions.js'
import type { FileCandidate } from '../utils/fileSuggestions.js'
import { CommandSuggestions } from './CommandSuggestions.js'
import { FileSuggestions } from './FileSuggestions.js'
import { HelpMenu } from './HelpMenu.js'
import { OverlayAbove } from './OverlayAbove.js'
import { SuggestionCard, cardContentWidth } from './SuggestionCard.js'
import {
  filterLiveImageBindings,
  isUsableDraftSnapshot,
  resolveBindingGeneration,
  type PromptDraftCache,
  type PromptDraftImage,
} from './promptDraftCache.js'
import {
  COMPOSER_IMAGE_TOKEN,
  composerImageRefsForText,
  expandImageTokenRange,
  graphemeBoundaries,
  imageTokenSpans,
  nextGraphemeBoundary,
  normalizeCursorOffset,
  sanitizeEditableText,
  snapOffImageToken,
  type ImageTokenSpan,
} from './prompt-input/text-motion.js'
import {
  caretInText,
  clickToCursorOffset,
  visualLineRanges,
  wordSelectionAt,
  wrapToWidth,
} from './prompt-input/wrap-geometry.js'
import { createHandleEnter, createPromptKeyHandler } from './prompt-input/prompt-keys.js'
import { createPromptInteractions } from './prompt-input/prompt-interactions.js'
import { useFileCompletion } from './prompt-input/use-file-completion.js'
import { ExpandedEditor } from './prompt-input/expanded-editor.js'

/**
 * Visible text of the session-entry control at the head of the input row:
 * U+2338 APL FUNCTIONAL SYMBOL QUAD COLON plus a separator space.
 *
 * The glyph is chosen for ONE property above all others: the layout model and
 * the terminal cell table must agree on how many columns it occupies. `\u2338`
 * is a plain single-cell symbol with no emoji presentation, so
 * `stringWidth` and the terminal both say 1 + 1 = 2 and
 * {@link HOME_BUTTON_COLS} can be derived rather than guessed.
 *
 * The emoji house (`U+1F3E0`) was tried and rejected on this exact ground: it
 * costs the terminal ONE cell while `stringWidth` charges the row TWO, and
 * appending VARIATION SELECTOR-15 (text presentation) does not change either
 * number. That standing one-column disagreement put every caret-relative
 * column in the composer off by one, so no offset compensation made it work.
 */
const HOME_BUTTON_TEXT = '⌸ '

const HOME_BUTTON_COLS = stringWidth(HOME_BUTTON_TEXT)

export interface PromptHistoryEntry {
  readonly text: string
  readonly images: readonly ComposerImageRef[]
}

export interface VimUndoEntry extends PromptHistoryEntry {
  readonly cursor: number
}

export interface DraftImageLease {
  readonly generation: number
  readonly revision: number
}

/**
 * Paste fold with a visible preview and no black box:
 * a paste that leaves the input this big folds into a one-line chip
 * showing the line/char count PLUS the first line of content. Hover peeks
 * at the full text (window pinned to the head); clicking the chip — or
 * the `▾` prefix on the first row while expanded — toggles the fold; Esc
 * or any editing key unfolds first. Enter still submits the FULL text:
 * folding never drops data.
 */
const FOLD_MIN_LINES = 6
const FOLD_MIN_CHARS = 600
const isBigInput = (text: string): boolean =>
  text.split('\n').length >= FOLD_MIN_LINES || text.length >= FOLD_MIN_CHARS

/**
 * The empty input deliberately shows NO placeholder text: terminal emulators
 * paint the IME preedit (pinyin) at the physical cursor, which the app parks
 * on the caret's cell, and the app receives no input events while a
 * composition is active (Windows Terminal suppresses key events during TSF
 * composition) — so it can never hide a placeholder in time. Keeping the row
 * blank while empty is what guarantees the preedit has nothing to overlay.
 */

/** Max input rows before the visible viewport starts scrolling; the box keeps
 *  a stable height. */
const MAX_VISIBLE_LINES = 5

/**
 * Fixed chrome rows around the expanded editor's text area: round border
 * (top+bottom), the title row, the status row, and the button row. The
 * editor viewport gets `terminalRows - this` rows.
 */
const EDITOR_CHROME_ROWS = 5

/**
 * Imperative handle for the Chat-level Ctrl+C rule: Chat's useInput listener
 * runs BEFORE this component's (EventEmitter registration order), so Chat
 * asks the prompt whether it holds text (→ clear it) or not (→ arm the
 * double-press exit). Populated every render; null while unmounted.
 */
export interface PromptController {
  hasText(): boolean
  /** The draft text, for a caller that must not lose it (see {@link PromptDraftCache}). */
  text(): string
  /** Current capability-backed draft images in token order, without reads. */
  previewImages?(): readonly { image: TranscriptImage; title: string }[]
  clear(): void
  /**
   * Append `text` at the end of the input (external injection channel; see
   * dsh-adapter/inject-channel.ts). Unlike `fillText`, which replaces the
   * whole value, this accumulates — matching OpenCode's `tui.prompt.append`
   * so repeated editor sends build one prompt. Returns the resulting value.
   */
  append(text: string): string
  /**
   * Copy the active mouse selection to the system clipboard (OSC 52 + the
   * native fallback) and KEEP the selection for further editing. Returns
   * true when a selection existed and consumed the key; Chat's Ctrl+C
   * branch calls this first, before its clear/exit semantics.
   */
  consumeSelectionCopy(): boolean
  /** Toggle vim editing mode (`/vim`); returns the new state (true = on). */
  toggleVim(): boolean
  /** True while vim mode is on (either submode). Esc belongs to vim then —
   *  Chat's working-turn Esc interrupt must yield in BOTH submodes. */
  vimActive(): boolean}

/**
 * Owner-held slot for the composer draft, so a screen that unmounts the
 * prompt (every early return in Chat) does not discard what the user typed.
 *
 * The composer writes ONE complete snapshot as it unmounts and consumes it on
 * the way back; the shape and the reasoning live in `promptDraftCache.ts`.
 */
export interface PromptInputProps {
  channel: Channel
  /** Keep the draft mounted while another prompt-slot panel owns the UI. */
  suspended?: boolean
  /**
   * Owner-held slot for the unsent draft.
   *
   * The prompt owns its text in local state, and several screens REPLACE the
   * conversation (the session screen, the session tree, settings, the jobs and
   * subagent panels, the trajectory scene) — early returns that unmount this
   * component and would take a half-written prompt down with it. Chat owns the
   * slot, so the text, its caret AND its image bindings survive that unmount
   * and come back when the composer does. The owner also drops it on a session
   * change, so a draft can never leak into a different conversation.
   *
   * Nothing is written from render: a commit-time assignment would run before
   * the restore effect has read the slot and overwrite the draft with the
   * empty first value.
   */
  draftCache?: PromptDraftCache
  /** Whether the `?` help menu is open (state lives in the Chat screen). */
  helpOpen: boolean
  onToggleHelp(): void
  /**
   * Execute a slash command (built-in or plugin-registered) with its raw
   * argument text; returns false when the input should be sent to the model.
   */
  onRunCommand(
    name: string,
    rawInput: string,
    images: readonly ComposerImageRef[],
  ): boolean | Promise<boolean>
  /** Message-selection mode (Shift+↑ or Tab): the input ignores keys while active. */
  selectionActive: boolean
  /** Idle plain Tab hands the keyboard to the transcript selection mode. */
  onEnterSelection?(): void
  /** Mouse counterpart of Tab-back: clicking anywhere on the input cluster
   *  while selection mode holds returns the keyboard to the composer. */
  onExitSelection?(): void
  /**
   * External fill from the ctrl+r history dialog: when this prop changes to
   * a non-null string, the input replaces its value and moves the caret to
   * the end. The caller clears it via onFillConsumed once consumed.
   */
  fillText?: string | null
  onFillConsumed?(): void
  /** Double-tap Esc with an empty input: open the rewind picker. */
  onRewindRequest?(): void
  /**
   * ← on an EMPTY prompt backgrounds this session and
   * opens the agent view (with text, ← moves the caret as usual).
   */
  onBackgroundRequest?(): void
  /**
   * Open the session screen (the one `/resume`, `/agentview` and `/home`
   * share) from the `⌂` entry at the head of the input row.
   *
   * Optional on purpose: the entry is rendered ONLY when this is provided, so
   * hosts that mount the prompt without a session screen — and the layout
   * regressions that pin this row's column budget — keep exactly the row they
   * had before.
   */
  onOpenSessions?(): void
  /**
   * Background sessions waiting on the user (agent view "needs input" rows
   * excluding this session); the prompt footer shows the
   * "← N agents" hint when provided (hidden when undefined).
   */
  backgroundAgentsNeedingInput?: number
  /** Filled with the live controller each render (see PromptController). */
  controllerRef?: React.RefObject<PromptController | null>
  /**
   * The staged image the caret is on — at a token's start, where the whole
   * token inverts — or undefined once it leaves; reported whenever that changes (`'caret'`),
   * and again on every click on a token (`'click'`, even when unchanged) so
   * the caller can re-show a preview the user dismissed. `title` is the
   * token without brackets (`Image #2`). Reported as undefined while the
   * prompt is suspended and on unmount.
   */
  onCaretImage?(image: TranscriptImage | undefined, title: string | undefined, reason: 'caret' | 'click'): void
  /**
   * True while the caller shows the caret-driven preview. Esc then goes to
   * `onDismissCaretPreview` ahead of every other Esc meaning (the ladder's
   * "close the image preview" rung): this input's listener runs before
   * Chat's, and the prompt is NOT inert under a caret preview.
   */
  caretPreviewOpen?: boolean
  onDismissCaretPreview?(): void
  /**
   * A message left the composer (submit / steer / queue). Submitting is a
   * focus move to the conversation tail — the reply lands at the bottom —
   * so the caller scrolls the transcript home and re-pins sticky follow
   * (grok semantics: a new prompt follows the answer, even when the user
   * had scrolled away to browse history).
   */
  onSubmitted?(): void
}

/**
 * dsh-TUI prompt input: rounded border box (top+bottom borders
 * only), `❯ ` prompt char (dimmed while a turn is working), the text with a
 * block cursor at the cursor position, and above it the slash-command /
 * file-completion suggestion card (SuggestionCard: rounded panel with the
 * selected row behind a `❯` pointer in the theme's `suggestion` color).
 *
 * Empty input: a solid block caret on a blank cell and nothing else — no
 * placeholder text, so the terminal-painted IME preedit (pinyin) at the
 * parked cursor can never be overlaid on anything.
 *
 * Multi-line: Shift+Enter inserts a newline; ↑/↓ move between lines while
 * the input spans multiple lines (history/command selection otherwise); the
 * visible window scrolls to keep the caret row on screen past
 * MAX_VISIBLE_LINES. Enter submits, backspace/delete edit, ←/→ move the
 * cursor, Tab completes the selected command, Ctrl+Shift+E opens the draft
 * in the external editor ($VISUAL/$EDITOR), Escape clears (or closes the help
 * menu), `?` toggles the help menu. Windows ConPTY pipelines deliver
 * whole lines with the Enter key lost: a trailing CR/LF in the input marks
 * a complete line to submit.
 *
 * Enter submits immediately even while the model is streaming — as a STEER
 * (Codex/pi semantics): the message is injected at the next step boundary
 * of the running turn and the agent continues without aborting; Tab instead
 * queues the message for after the turn (followup). Both appear in a
 * pending preview above the input until delivered. Alt+Up pulls the last
 * pending message back for editing; Esc (with pending messages while
 * working) interrupts the turn and delivers them right away; Ctrl+Enter
 * aborts the turn and sends the current input immediately.
 */
export function PromptInput({
  channel,
  suspended = false,
  draftCache,
  helpOpen,
  onToggleHelp,
  onRunCommand,
  selectionActive,
  onEnterSelection,
  onExitSelection,
  fillText,
  onFillConsumed,
  onRewindRequest,
  onBackgroundRequest,
  onOpenSessions,
  backgroundAgentsNeedingInput,
  controllerRef,
  onCaretImage,
  caretPreviewOpen = false,
  onDismissCaretPreview,
  onSubmitted,
}: PromptInputProps) {
  const [themeName] = useTheme()
  // Raw stdout writer for OSC 52 clipboard writes (selection copy) — must
  // bypass the frame pipeline; null outside a mounted Ink App.
  const writeRaw = React.useContext(TerminalWriteContext)
  // The composer owns its text in local state, so it starts EMPTY and adopts
  // whatever draft the owner stored in a MOUNT-TIME effect below. Reading the
  // store in this initializer instead looks equivalent and is not: a non-empty
  // first frame leaves `repro-resume-position` red — resuming a session parks
  // the transcript mid-history instead of pinning it to the newest message.
  // Adopting after mount keeps the first frame identical to a fresh composer
  // while still handing the draft back.
  const [value, setValue] = React.useState('')
  const [cursor, setCursor] = React.useState(0)
  /**
   * Adopt the owner's draft ONCE, after mount.
   *
   * This is where a screen swap gives the draft back: the slot outlives this
   * component, so a remount picks up what the user had written — text, caret,
   * the image bindings behind the visible `[Image #N]` tokens, and the edit
   * state around them (fold chip, fullscreen editor, vim mode).
   *
   * It runs as an effect rather than as the `useState` initial value on
   * purpose. A composer whose FIRST frame is already non-empty moves the
   * transcript's restored scroll position (`repro-resume-position`); adopting
   * after the first commit keeps that frame identical to a fresh composer. The
   * slot is consumed here, and the composer never writes to it while mounted,
   * so the empty first value cannot overwrite the draft before this reads it.
   */
  const adoptDraft = React.useRef(true)
  React.useEffect(() => {
    if (draftCache === undefined || !adoptDraft.current) return
    adoptDraft.current = false
    const snapshot = draftCache.current
    draftCache.current = null
    if (!isUsableDraftSnapshot(snapshot, String(channel.agentId), resolveBindingGeneration(channel))) return
    const text = snapshot.value
    // Carried edit state, restored ahead of the text: the chip, the
    // fullscreen editor and the vim mode/submode come back with the draft —
    // and they come back even with NO text, because they are modes rather
    // than content. Fold ranges are safe by the CAPTURE invariant, not by
    // restore order: a snapshot's block, when set, always sits inside the
    // snapshot's own text (setInput keeps or drops it atomically), and at
    // mount the caret is 0 so updateFoldBlock's caret-drag clamp cannot fire
    // here. The transient state around them — editor scroll, vim undo stack,
    // selection — does not come back.
    updateFoldBlock(snapshot.foldBlock)
    expandedRef.current = snapshot.expanded
    setExpanded(snapshot.expanded)
    vimEnabledRef.current = snapshot.vimEnabled
    setVimEnabled(snapshot.vimEnabled)
    vimInsertRef.current = snapshot.vimInsert
    setVimInsert(snapshot.vimInsert)
    if (text === '') return
    const restoredCursor = normalizeCursorOffset(text, snapshot.cursor)
    replaceDraftImages(filterLiveImageBindings(
      snapshot.images,
      stageId => channel.hasStagedImage?.(stageId) === true,
    ).map(([token, stageId]) => ({ token, stageId })))
    valueRef.current = text
    cursorRef.current = restoredCursor
    setValue(text)
    setCursor(restoredCursor)
  }, [draftCache])
  /**
   * Mouse text selection: UTF-16 offsets [start, end) in `value`, snapped
   * to grapheme boundaries, start ≤ end. Null = no selection. Created by
   * drag, Shift+click extension and double-click word select; consumed by
   * Backspace/Delete/typing; Esc clears it without touching the text.
   * With a fold block the range always stays inside the head or the tail
   * (it never crosses the chip row — clamped on every write).
   */
  const [selection, setSelection] = React.useState<{ start: number; end: number } | null>(null)
  const selectionRef = React.useRef<{ start: number; end: number } | null>(null)
  /** Anchor offset of the in-flight drag gesture (set by dragstart). */
  const dragAnchorRef = React.useRef<number | null>(null)
  /** Double-click self-detection: last click's timestamp/screen cell. */
  const lastClickAtRef = React.useRef(0)
  const lastClickColRef = React.useRef(-1)
  const lastClickRowRef = React.useRef(-1)
  /**
   * vim editing mode (`/vim` toggle): when on, Esc switches the prompt to
   * its NORMAL submode where bare keys are vim keys instead of text, and
   * i/a/o (…) return to INSERT. Enabled in insert mode so the transition
   * is seamless; the mode is session-scoped (not persisted).
   */
  const [vimEnabled, setVimEnabled] = React.useState(false)
  /** Insert submode (false = vim NORMAL). */
  const [vimInsert, setVimInsert] = React.useState(true)
  const vimEnabledRef = React.useRef(false)
  const vimInsertRef = React.useRef(true)
  vimEnabledRef.current = vimEnabled
  vimInsertRef.current = vimInsert
  /** Undo owns the draft's image bindings as well as its text and caret. */
  const vimUndoRef = React.useRef<VimUndoEntry[]>([])
  /** Pending vim operator: `d` pressed, awaiting its second key. */
  const vimPendingRef = React.useRef<'' | 'd'>('')
  /**
   * Fold block: the [start, end) span of `value` that renders as
   * a one-line chip while the text around it stays fully editable. Created
   * by a big paste; only an EXPLICIT expand (chip/card click, Esc) or
   * delete removes it — typing NEVER unfolds the block.
   */
  const [foldBlock, setFoldBlock] = React.useState<{ start: number; end: number } | null>(null)
  /** Synchronous mirror used by batched keys, controller clear, and mouse drag. */
  const foldBlockRef = React.useRef<{ start: number; end: number } | null>(null)
  /**
   * Fullscreen draft editor (`expandEditor`, default Ctrl+Shift+E, or the
   * ✎ affordance at the end of the input row). While expanded the SAME
   * editing state renders into the PromptEditorLayer cover (published via
   * setPromptEditorNode each render): Enter inserts a newline, Ctrl+Enter
   * submits, Esc collapses. The fold chip is bypassed (full text shown).
   */
  const [expanded, setExpanded] = React.useState(false)
  const expandedRef = React.useRef(false)
  /** First visible row of the expanded viewport (merged with caret-follow
   *  during render; wheel events advance it and tick a re-render). */
  const expandedScrollRef = React.useRef(0)
  /**
   * Free-scroll latch: wheel browsing parks the viewport anywhere; the
   * caret-follow merge skips while it is set, and the next real caret move
   * (typing, arrows, click) re-engages following (GUI-editor semantics).
   */
  const editorFreeScrollRef = React.useRef(false)
  const prevCaretLineRef = React.useRef(-1)
  const [, setExpandedTick] = React.useState(0)
  const prevExpandedRef = React.useRef(false)
  /**
   * Feature gate (settings `dsh-tui.expandEditor`, on by default; a mock
   * channel without the field also reads as on). Off hides the ✎
   * affordance and refuses the shortcut — the editor cannot open.
   */
  const expandEnabled = channel.expandEditor !== false
  /** Latest expanded viewport metrics for the useInput wheel branch. */
  const editorViewportRef = React.useRef<{ maxRows: number; total: number } | null>(null)
  /** Hover state of the ⤢/✎ expand affordance in the input row. */
  const [expandHovered, setExpandHovered] = React.useState(false)
  /** Hover state of the ⌂ session-list affordance at the head of the row. */
  const [homeHovered, setHomeHovered] = React.useState(false)
  /** Pointer over the input box (drives the hover peek card). */
  const [hovered, setHovered] = React.useState(false)
  /** 120ms grace so the pointer crossing the input border row from the
   *  chip up onto the peek card never flickers the card. */
  const hoverLeaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverEnter = React.useCallback(() => {
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current)
      hoverLeaveTimerRef.current = null
    }
    setHovered(true)
  }, [])
  const hoverLeave = React.useCallback(() => {
    if (hoverLeaveTimerRef.current) clearTimeout(hoverLeaveTimerRef.current)
    hoverLeaveTimerRef.current = setTimeout(() => setHovered(false), 120)
  }, [])
  const valueRef = React.useRef(value)
  const cursorRef = React.useRef(cursor)
  const history = React.useRef<PromptHistoryEntry[]>([])
  const historyIndex = React.useRef(-1)
  const historyDraft = React.useRef<PromptHistoryEntry>({ text: '', images: [] })
  /** The persisted history is read lazily, once per mount (see seedHistory). */
  const historySeeded = React.useRef(false)
  /** Visible `[Image #N]` labels are presentation only; this sidecar carries
   * the non-reusable capability for the current draft. History/rewind text
   * restored without this map can never bind to a later image by accident. */
  const draftImagesRef = React.useRef(new Map<string, string>())
  const draftImagesGenerationRef = React.useRef(channel.stagedImageGeneration?.() ?? 0)
  /** Session generation fences one agent transcript; revision fences one
   * logical composer draft inside that session. Ordinary typing deliberately
   * keeps the revision so an async paste lands at the live caret, while any
   * whole-draft replacement revokes the old continuation. */
  const draftRevisionRef = React.useRef(0)
  /** Unlike draftRevision (whole-draft replacement only), this advances on
   * every text mutation so an async command can never clear a draft that was
   * edited away and later changed back to the same bytes. */
  const inputEditSequenceRef = React.useRef(0)
  /** One registry command may own a draft at a time. Keeping the draft
   * visible during admission must not make a second Enter dispatch it twice. */
  const pendingCommandRef = React.useRef<{
    readonly token: symbol
    readonly generation: number
    readonly revision: number
    readonly editSequence: number
  } | null>(null)
  const nextImageNumberRef = React.useRef(1)
  /** Serialize image staging started in one draft so consecutive terminal
   * drops keep input order even when storage settles out of order. A new
   * logical draft receives a fresh chain and never waits on old-session I/O. */
  const imageStageChainRef = React.useRef<Promise<void>>(Promise.resolve())
  const advanceDraftRevision = (): void => {
    draftRevisionRef.current += 1
    imageStageChainRef.current = Promise.resolve()
  }
  const detachDraftImages = (): void => {
    advanceDraftRevision()
    draftImagesRef.current.clear()
    clearVimUndo()
  }
  const stageIdIsRetained = (stageId: string): boolean => {
    for (const current of draftImagesRef.current.values()) {
      if (current === stageId) return true
    }
    return vimUndoRef.current.some(entry => entry.images.some(image => image.stageId === stageId))
      || history.current.some(entry => entry.images.some(image => image.stageId === stageId))
      || historyDraft.current.images.some(image => image.stageId === stageId)
      || channel.pending.some(item => item.images?.some(image => image.stageId === stageId) === true)
  }
  const discardUnretainedImages = (stageIds: Iterable<string>): void => {
    for (const stageId of new Set(stageIds)) {
      if (!stageIdIsRetained(stageId)) channel.discardStagedImage(stageId)
    }
  }
  const clearVimUndo = (): void => {
    const previous = vimUndoRef.current
    vimUndoRef.current = []
    discardUnretainedImages(previous.flatMap(entry => entry.images.map(image => image.stageId)))
  }
  const discardDraftImages = (): void => {
    advanceDraftRevision()
    const stageIds = [...draftImagesRef.current.values()]
    clearVimUndo()
    draftImagesRef.current.clear()
    discardUnretainedImages(stageIds)
  }
  const replaceDraftImages = (images: readonly ComposerImageRef[]): void => {
    const previous = [...draftImagesRef.current.values()]
    draftImagesRef.current.clear()
    for (const ref of images) {
      if (channel.hasStagedImage?.(ref.stageId) === true) {
        draftImagesRef.current.set(ref.token, ref.stageId)
      }
    }
    discardUnretainedImages(previous)
  }
  const syncImageGeneration = (): number => {
    const generation = channel.stagedImageGeneration?.() ?? 0
    if (draftImagesGenerationRef.current !== generation) {
      // The channel has already cleared every old-generation capability.
      // Only detach the UI sidecar; calling discard would be redundant.
      vimUndoRef.current = []
      detachDraftImages()
      draftImagesGenerationRef.current = generation
      // Presentation numbering is session-local like the old channel-owned
      // sequence. Any stale token still visible in the retained draft is
      // skipped by bindStagedImage, so resetting cannot recreate an alias.
      nextImageNumberRef.current = 1
    }
    return generation
  }
  const captureDraftImageLease = (): DraftImageLease => ({
    generation: syncImageGeneration(),
    revision: draftRevisionRef.current,
  })
  const draftImageLeaseIsCurrent = (lease: DraftImageLease): boolean =>
    syncImageGeneration() === lease.generation
    && draftRevisionRef.current === lease.revision
  // Channel emits on every session replacement. Clear the sidecar during
  // that render while leaving the user's visible draft untouched; any raw
  // tokens become explicit stale placeholders instead of aliases.
  syncImageGeneration()
  valueRef.current = value
  cursorRef.current = cursor
  // Nothing is written to the owner's draft slot here — see the unmount
  // hand-off below. A commit-time write would run BEFORE the restore effect
  // has consumed the slot, so the composer's own first (empty) value would
  // erase the draft it just came back for.
  // Publish the live controller (fresh closure over `value` every render).
  // A prompt-slot panel withdraws the handle in the same commit: external
  // injection must not append/submit a hidden command draft while it waits
  // for a decision. clear() mirrors the double-tap-Esc clear.
  React.useLayoutEffect(() => {
    if (!controllerRef) return
    if (suspended) {
      controllerRef.current = null
      return
    }
    controllerRef.current = {
      hasText: () => value.length > 0,
      text: () => valueRef.current,
      previewImages: () => composerImageRefsForText(valueRef.current, draftImagesRef.current).flatMap(ref => {
        const image = channel.stagedImage(ref.stageId)
        return image === undefined ? [] : [{ image, title: ref.token.slice(1, -1) }]
      }),
      clear: () => {
        if (valueRef.current !== '') inputEditSequenceRef.current += 1
        valueRef.current = ''
        cursorRef.current = 0
        selectionRef.current = null
        discardDraftImages()
        foldBlockRef.current = null
        dragAnchorRef.current = null
        lastClickAtRef.current = 0
        lastClickColRef.current = -1
        lastClickRowRef.current = -1
        // Chat's idle Ctrl+C clear also withdraws the fullscreen editor —
        // the draft it was editing is gone, the cover must not linger.
        expandedRef.current = false
        setSelection(null)
        setFoldBlock(null)
        setExpanded(false)
        setValue('')
        setCursor(0)
      },
      append: (text: string) => {
        const previous = valueRef.current
        const next = sanitizeEditableText(previous + text)
        if (next !== previous) inputEditSequenceRef.current += 1
        valueRef.current = next
        cursorRef.current = next.length
        setValue(next)
        setCursor(next.length)
        return next
      },
      consumeSelectionCopy: () => {
        const sel = selectionRef.current
        if (!sel) return false
        const text = valueRef.current.slice(sel.start, sel.end)
        void setClipboard(text).then(raw => {
          if (raw) writeRaw?.(raw)
        })
        // The selection stays: copy never clears it (Esc/typing/delete do).
        return true
      },
      toggleVim: () => {
        const next = !vimEnabledRef.current
        vimEnabledRef.current = next
        setVimEnabled(next)
        // Every toggle lands in INSERT: a fresh vim user keeps typing
        // normally until they press Esc for the first time. Turning the
        // mode off also clears the undo stack — a later re-enable must
        // never `u` its way back past edits made while vim was off.
        vimInsertRef.current = true
        setVimInsert(true)
        vimPendingRef.current = ''
        clearVimUndo()
        return next
      },
      vimActive: () => vimEnabledRef.current,    }
    return () => {
      controllerRef.current = null
    }
  })
  const [selectedCommand, setSelectedCommand] = React.useState(0)
  // ctrl+r history fill: replace the input when a new fill arrives, then
  // tell the caller to clear it.
  const lastFill = React.useRef<string | null>(null)
  React.useLayoutEffect(() => {
    if (fillText && fillText !== lastFill.current) {
      lastFill.current = fillText
      syncImageGeneration()
      discardDraftImages()
      updateFoldBlock(null)
      setInput(fillText)
      onFillConsumed?.()
    }
  }, [fillText, onFillConsumed])
  // Double-tap Esc to clear.
  const escPendingRef = React.useRef(false)
  const escTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  /** True while a clipboard paste read is in flight (ignore repeat keys). */
  const clipboardBusyRef = React.useRef(false)
  /** True while the external editor owns the terminal (editor-key round-trip). */
  const editorBusyRef = React.useRef(false)
  /** Enter dedupe window: cmd pipelines can deliver one Enter as `\r`+`\n`. */
  const lastEnterAtRef = React.useRef(0)
  React.useEffect(() => {
    return () => {
      if (escTimerRef.current) clearTimeout(escTimerRef.current)
      if (hoverLeaveTimerRef.current) clearTimeout(hoverLeaveTimerRef.current)
      /**
       * Hand the draft to the owner's slot as this component goes away.
       *
       * This is the ONLY write to that slot, and it belongs here: it happens at
       * the instant a screen replaces the composer, so it can neither race the
       * restore effect nor change the transcript's first frame.
       *
       * `advanceDraftRevision` invalidates any image read/stage still in
       * flight, so a late continuation cannot bind a capability into a composer
       * that no longer exists. `clearVimUndo` releases the capabilities that
       * only the undo stack was holding: they are not part of the draft, and
       * nothing will ever restore them once this composer is gone.
       *
       * The stageIds the DRAFT holds are deliberately NOT revoked — they are
       * part of the snapshot the slot now keeps, and the restore filters out
       * whatever the channel revoked in the meantime. Revoking them here is why
       * an image draft used to come back as inert text.
       */
      advanceDraftRevision()
      clearVimUndo()
      const images: PromptDraftImage[] = [...draftImagesRef.current.entries()]
        .map(([token, stageId]) => [token, stageId] as const)
      draftImagesRef.current.clear()
      if (draftCache === undefined) {
        discardUnretainedImages(images.map(image => image[1]))
        return
      }
      const text = valueRef.current
      // The edit state rides along even with nothing typed: vim mode and the
      // fullscreen editor are MODES the user turned on, not content, and an
      // empty composer must not drop them (`text === ''` alone used to skip
      // the snapshot entirely, losing the vim badge on a round trip with an
      // empty composer).
      const editState = foldBlockRef.current !== null || expandedRef.current
        || vimEnabledRef.current
      if (text === '' && images.length === 0 && !editState) {
        draftCache.current = null
        return
      }
      draftCache.current = {
        ownerAgentId: String(channel.agentId),
        bindingGeneration: resolveBindingGeneration(channel),
        value: text,
        cursor: cursorRef.current,
        foldBlock: foldBlockRef.current,
        expanded: expandedRef.current,
        vimEnabled: vimEnabledRef.current,
        vimInsert: vimInsertRef.current,
        images,
      }
    }
  }, [])
  const { columns, rows: terminalRows } = useTerminalSize()
  React.useEffect(() => {
    // PromptInput self-detects double-clicks because its drag target resets
    // App's global chain. Geometry changed across resize, so the same screen
    // cell no longer identifies the same grapheme.
    lastClickAtRef.current = 0
    lastClickColRef.current = -1
    lastClickRowRef.current = -1
  }, [columns, terminalRows])
  const helpScrollRef = React.useRef<ScrollBoxHandle | null>(null)
  // Help viewport budget: the overlay anchors at the composer's top edge
  // (OverlayAbove bottom:'100%') and grows UP, so its budget is the space
  // ABOVE that anchor — smallest on an empty session, where the whale
  // splash (~15 rows) sits between the screen top and the composer
  // (terminalRows minus chrome only applies once the transcript fills the
  // viewport). Take the conservative intersection: 15 rows of viewport (16
  // with the hint + margin) fits the empty-session anchor on the default
  // layout at any terminal size, and the renderer's bottom-anchored
  // clipping for absolute overlays (no negative-y clamp) then never has
  // to eat the overlay's FIRST rows — the shortcut-column headers. The
  // command registry scrolls inside the viewport, so a taller terminal
  // loses nothing functional. (PR #446; restored after the picker
  // snapshot's cherry-pick resurrected the old formula.)
  const helpViewportHeight = Math.max(3, Math.min(terminalRows - 7, 15))

  const suggestions = value.startsWith('/') ? channel.commandCompletions(value) : []
  const overlayOpen =
    suggestions.length > 0 &&
    !expanded &&
    !helpOpen &&
    !selectionActive &&
    !value.includes('\n')

  // `@` file completion (issue #15): the trigger is the mention token at the
  // CARET, so `@` works mid-message (`看看 @src/a.ts 这个`), not only when it
  // is the input's first character. The cwd listing loads when the trigger
  // appears.
  const { fileMatches, fileSelected, setFileSelected, selectedFile } = useFileCompletion(value, cursor, channel)
  const mention = mentionAtCaret(value, cursor)
  // Esc dismisses the overlay for the token being edited (it reopens once the
  // text changes); it must NOT clear a mid-message input.
  const fileEscRef = React.useRef(-1)
  React.useEffect(() => {
    fileEscRef.current = -1
  }, [value])
  const fileOverlayOpen =
    fileMatches.length > 0 &&
    !expanded &&
    !helpOpen &&
    !selectionActive &&
    fileEscRef.current !== mention?.start

  /**
   * The `[Image #N]` tokens of `text` that carry a live draft capability.
   * These are atomic: the caret never rests inside one, ←/→ step over the
   * whole token, Backspace at its end / Delete at its start remove it whole,
   * a selection never cuts it, and it renders as a chip (the whole token is
   * the caret cluster when the caret sits at its start). A raw token typed
   * or restored without a capability is ordinary text.
   */
  const boundImageSpans = (text: string): ImageTokenSpan[] =>
    imageTokenSpans(text).filter(span => draftImagesRef.current.has(span.token))

  /**
   * The staged image the caret is on: the token whose start is the caret —
   * exactly when the whole token is the caret cluster and inverts. The
   * caret sitting just after a token is not "on" it (the token is plain
   * there), so no preview. Undefined for a raw or stale token.
   */
  const caretImageAt = (
    text: string,
    offset: number,
  ): { image: TranscriptImage; title: string } | undefined => {
    const span = boundImageSpans(text).find(s => s.start === offset)
    if (span === undefined) return undefined
    const stageId = draftImagesRef.current.get(span.token)
    const image = stageId === undefined ? undefined : channel.stagedImage(stageId)
    return image === undefined ? undefined : { image, title: span.token.slice(1, -1) }
  }
  const onCaretImageRef = React.useRef(onCaretImage)
  onCaretImageRef.current = onCaretImage
  const lastCaretImageRef = React.useRef<{ image: TranscriptImage | undefined; title: string | undefined }>(
    { image: undefined, title: undefined },
  )
  /** Tell the caller which staged image the caret is on. `'caret'` reports
   *  only changes; `'click'` always reports (see onCaretImage). "Same image"
   *  is the attachment id plus the token, not facade identity: this runs
   *  after every commit and the caller stores what it reports, so an
   *  identity-only difference would re-render the caller forever (#885). */
  const reportCaretImage = (reason: 'caret' | 'click'): void => {
    const report = onCaretImageRef.current
    if (report === undefined) return
    const found = suspended ? undefined : caretImageAt(valueRef.current, cursorRef.current)
    const last = lastCaretImageRef.current
    if (reason === 'caret' && last.image?.id === found?.image.id && last.title === found?.title) return
    lastCaretImageRef.current = { image: found?.image, title: found?.title }
    report(found?.image, found?.title, reason)
  }
  // After every commit: the caret, the text and the staged map are all
  // settled by then, and a no-change report is skipped.
  React.useEffect(() => { reportCaretImage('caret') })
  React.useEffect(() => () => {
    if (lastCaretImageRef.current.image !== undefined) {
      onCaretImageRef.current?.(undefined, undefined, 'caret')
    }
  }, [])

  /** Fold-block state + a synchronous mirror (setInput reads the ref).
   *  Creating a block also drags a caret that sits inside it out to the
   *  block's end (the block is atomic; typing continues after it). */
  const updateFoldBlock = (block: { start: number; end: number } | null) => {
    foldBlockRef.current = block
    setFoldBlock(block)
    if (block) {
      const c = cursorRef.current
      if (c > block.start && c < block.end) {
        cursorRef.current = block.end
        setCursor(block.end)
      }
    }
  }

  const setInput = (next: string, cursorOffset = next.length) => {
    // Apply the same ingress normalization to fills/history/editor results as
    // to paste. Map the requested caret through the sanitized prefix so an
    // ANSI sequence removed before it cannot leave the caret past the text.
    const sanitizedCursor = sanitizeEditableText(next.slice(0, cursorOffset)).length
    next = sanitizeEditableText(next)
    cursorOffset = sanitizedCursor
    const prev = valueRef.current
    const prevCursor = cursorRef.current
    const block = foldBlockRef.current
    // Normalize onto a grapheme boundary (also clamps into range): every
    // caller passes a caret they believe is on a character edge — paste
    // merges, history fills, and IME composition can still hand back an
    // offset inside a surrogate pair or combining cluster.
    let offset = normalizeCursorOffset(next, cursorOffset)
    if (block) {
      // Fold block is atomic: the caret never lands INSIDE [start, end).
      if (offset > block.start && offset < block.end) {
        offset = offset - block.start < block.end - offset ? block.start : block.end
      }
      // Every real edit happens AT the caret, so a block that starts at or
      // after the caret shifts with the value delta; one fully past the
      // caret is untouched. Whole-value replacements (fill/history/editor)
      // clear the block explicitly at their call sites.
      const delta = next.length - prev.length
      let start = block.start
      let end = block.end
      if (prevCursor <= block.start) {
        start += delta
        end += delta
      }
      start = Math.max(0, Math.min(start, next.length))
      end = Math.max(start, Math.min(end, next.length))
      if (start >= end) updateFoldBlock(null)
      else if (start !== block.start || end !== block.end) updateFoldBlock({ start, end })
    }
    // Staged `[Image #N]` tokens are atomic: a caret that would land inside
    // one continues in its direction of travel (←/word-left/↑ → the token's
    // start, →/word-right/↓ → its end); with no travel, the nearer edge.
    offset = snapOffImageToken(
      boundImageSpans(next),
      offset,
      offset < prevCursor ? 'start' : offset > prevCursor ? 'end' : 'nearest',
    )
    // The synchronous mirrors are what batch-dispatched events (one stdin
    // read → several keys, no render in between) read on their next turn.
    if (next !== prev) inputEditSequenceRef.current += 1
    valueRef.current = next
    cursorRef.current = offset
    // Deleting a visible token revokes its capability. Re-typing the same
    // label later must stay inert; only a fresh paste may mint a new binding.
    for (const [token, stageId] of draftImagesRef.current) {
      if (next.includes(token)) continue
      draftImagesRef.current.delete(token)
      if (!stageIdIsRetained(stageId)) channel.discardStagedImage(stageId)
    }
    // Every real edit drops the selection: its offsets describe the OLD
    // text. Selection-consuming callers (delete/replace) read it first.
    selectionRef.current = null
    setSelection(null)
    setValue(next)
    setCursor(offset)
  }

  /** Drop the selection without touching text or caret. */
  const clearSelection = () => {
    selectionRef.current = null
    setSelection(null)
  }

  /**
   * Accept the selected file suggestion: replace ONLY the mention token at
   * the caret (prefix/suffix text survives), quoting whitespace paths. A
   * directory inserts `@dir/` without a trailing space so completion
   * continues into it; a file completes the token with a space. A typed
   * `#L12-14` suffix is NOT part of the replacement — completion ends at
   * `pathEnd` so the line range survives acceptance (issue #359).
   */
  const acceptFile = (candidate: FileCandidate) => {
    if (!mention) return
    const file = candidate.path
    const body = /\s/.test(file) ? `@"${file}"` : `@${file}`
    // A typed `#L12-14` suffix rides along AFTER the completed body (before
    // the trailing space) — quoting a whitespace path must not detach it.
    const suffix = mention.pathEnd === undefined ? '' : value.slice(mention.pathEnd, mention.end)
    const insert = candidate.kind === 'directory' ? `${body}${suffix}` : `${body}${suffix} `
    const next = value.slice(0, mention.start) + insert + value.slice(mention.end)
    setInput(next, mention.start + insert.length)
    setFileSelected(0)
  }

  const imageRefsFor = (text: string): ComposerImageRef[] => {
    syncImageGeneration()
    return composerImageRefsForText(text, draftImagesRef.current)
  }

  /**
   * Warn once when the text carries an `[Image #N]` placeholder that will
   * not attach an image: unbound in this draft (history, rewind, typed) or
   * bound to a staging the channel has since dropped. Channel routes
   * (submit, steer, registry commands) warn on their own; this covers the
   * lines the screen consumes locally, where the text is otherwise dropped
   * without a word.
   */
  const warnStaleImageTokens = (text: string, images: readonly ComposerImageRef[]): void => {
    const live = new Set(
      images
        .filter(image => channel.stagedImage(image.stageId) !== undefined)
        .map(image => image.token),
    )
    for (const match of text.matchAll(COMPOSER_IMAGE_TOKEN)) {
      if (live.has(match[0])) continue
      channel.notify(t('input-image-token-stale', { token: match[0] }), { color: 'warning', timeoutMs: 5000 })
      return
    }
  }

  /**
   * Seed the walk with the persisted history (issue #986). `↑`/`↓` used to
   * see only what this process submitted, so a restart lost every earlier
   * entry. Seeding before the first push keeps ONE chronological list —
   * persisted entries first, this run's submits behind them — instead of two
   * lists to merge at recall time. Restored text carries no image capability
   * (the file stores text only), which is also what keeps a recalled entry
   * from binding to a later staged image by accident.
   */
  const seedHistory = (): void => {
    if (historySeeded.current) return
    historySeeded.current = true
    history.current = loadHistoryOldestFirst().map(entry => ({ text: entry.text, images: [] }))
    historyIndex.current = -1
  }

  const rememberHistory = (text: string, images: readonly ComposerImageRef[]): void => {
    // Both entries into the walk (a submit and ↑) must see the persisted
    // prefix, so seed here rather than merging two lists later.
    seedHistory()
    history.current.push({
      text,
      images: images.map(image => ({ ...image })),
    })
    if (history.current.length > HISTORY_LIMIT) history.current.shift()
    historyIndex.current = -1
    void appendHistory(text)
  }

  const clearDeliveredDraft = (): void => {
    syncImageGeneration()
    // Delivery captured the opaque refs and history retains them; only the
    // editable-draft binding is ending here.
    detachDraftImages()
    setInput('', 0)
    setSelectedCommand(0)
    setFileSelected(0)
  }

  const sameImageRefs = (
    left: readonly ComposerImageRef[],
    right: readonly ComposerImageRef[],
  ): boolean => left.length === right.length && left.every((image, index) =>
    image.token === right[index]?.token && image.stageId === right[index]?.stageId)

  /** `!`/`!!` are host shell routes, not model messages. They have no image
   * grammar, so reject before history/clear just like a non-image command. */
  const shellImagesUnsupported = (
    text: string,
    images: readonly ComposerImageRef[],
  ): boolean => {
    if (images.length === 0 || !text.startsWith('!')) return false
    channel.notify(t('shell-images-unsupported'), { color: 'warning', timeoutMs: 4000 })
    return true
  }

  const submitText = (text: string, notice?: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const images = imageRefsFor(trimmed)
    if (shellImagesUnsupported(trimmed, images)) return
    rememberHistory(trimmed, images)
    clearDeliveredDraft()
    channel.submit(trimmed, images)
    onSubmitted?.()
    if (notice) {
      channel.notify(notice, { timeoutMs: 2500 })
    } else if (channel.working) {
      // While the model is streaming, the message joins the DSH inbox and is
      // processed after the current turn — say so, or it looks "lost".
      channel.notify(t('input-sent-after-turn'), { timeoutMs: 2500 })
    }
  }

  /**
   * Enter while the model is working = STEER (Codex/pi semantics): the
   * message is injected at the next step boundary of the RUNNING turn and
   * the agent continues without aborting — the "immediate" send.
   */
  const steerSend = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const images = imageRefsFor(trimmed)
    rememberHistory(trimmed, images)
    clearDeliveredDraft()
    channel.steer(trimmed, images)
    onSubmitted?.()
    channel.notify(t('input-interrupted-next'), { timeoutMs: 2500 })
  }

  /**
   * Execute a slash command (built-in, plugin-registered, or hidden) when
   * the input resolves to one: the name parses as the first token so
   * `/plan off` dispatches `plan` with its argument text, and the merged
   * command list (locals + registry) decides whether the line is a command
   * at all. Hidden commands are recognized even though they are intentionally
   * absent from the suggestion/help catalogs.
   */
  const tryRunCommand = (text: string): boolean => {
    if (!text.startsWith('/')) return false
    const parsed = parseCommandName(text)
    if (parsed === undefined) return false
    const command = channel.commandList.find(entry => entry.name === parsed.name)
    const known = command !== undefined || isHiddenCommandName(parsed.name)
    if (!known) return false
    const generation = syncImageGeneration()
    const revision = draftRevisionRef.current
    const editSequence = inputEditSequenceRef.current
    if (
      pendingCommandRef.current?.generation === generation
      && pendingCommandRef.current.revision === revision
      && pendingCommandRef.current.editSequence === editSequence
    ) {
      channel.notify(t('command-running'), { color: 'warning', timeoutMs: 2500 })
      return true
    }
    if (pendingCommandRef.current !== null) pendingCommandRef.current = null
    const images = imageRefsFor(text)
    // Commands are an explicit non-model route. Unless their registry
    // descriptor opted into composer images, refuse before dispatch and keep
    // the exact draft/capabilities so the user can edit or send them normally.
    // Completion-only filesystem skills still fall through to the model.
    const modelRoutedSkill = command?.skill === true && command.external !== true
    if (images.length > 0 && !modelRoutedSkill && command?.acceptsImages !== true) {
      channel.notify(t('command-images-unsupported', { name: parsed.name }), {
        color: 'warning',
        timeoutMs: 4000,
      })
      return true
    }
    const lease = captureDraftImageLease()
    const draftText = valueRef.current
    const draftImages = imageRefsFor(draftText)
    const handled = onRunCommand(parsed.name, parsed.rawInput, images)
    if (handled === true) {
      // A local command consumed the line inside the screen.
      warnStaleImageTokens(text, images)
      rememberHistory(text.trim(), images)
      clearDeliveredDraft()
    } else if (handled !== false) {
      // Registry commands settle asynchronously. Keep the exact draft and
      // capabilities in place until admission succeeds; a handler/admission
      // error deliberately leaves them editable. A late success may clear
      // only the snapshot it actually submitted, never text/images typed
      // while the command was running or a replacement session's draft.
      const attempt = { token: Symbol('command-attempt'), generation, revision, editSequence }
      pendingCommandRef.current = attempt
      void handled.then((consume) => {
        if (
          !consume
          || !draftImageLeaseIsCurrent(lease)
          || inputEditSequenceRef.current !== editSequence
        ) return
        rememberHistory(text.trim(), images)
        const currentText = valueRef.current
        const currentImages = imageRefsFor(currentText)
        if (currentText === draftText && sameImageRefs(currentImages, draftImages)) {
          clearDeliveredDraft()
        }
      }).catch((error: unknown) => {
        if (!draftImageLeaseIsCurrent(lease)) return
        channel.notify(error instanceof Error ? error.message : String(error), {
          color: 'error',
          timeoutMs: 5000,
        })
      }).finally(() => {
        if (pendingCommandRef.current?.token === attempt.token) pendingCommandRef.current = null
      })
    }
    return handled !== false
  }

  /**
   * The Enter main path, shared by the inline prompt, the expanded
   * editor's Ctrl+Enter, and its Send button:
   * - command menu open → run the SELECTED command (never send `/mo`);
   * - model working → STEER into the running turn (next step boundary,
   *   agent continues — the "immediate" send; Codex/pi semantics);
   * - otherwise → submit directly (or run a unique command).
   * Reads valueRef so a key batch (typing + Enter in one stdin read)
   * operates on the text the preceding keys produced.
   */
  // Enter 主路径抽至 prompt-keys.ts（createHandleEnter）：键盘工厂与
  // submitFromEditor 共用同一条语义。
  const handleEnter = createHandleEnter({
    lastEnterAtRef, valueRef, overlayOpen, suggestions, selectedCommand,
    tryRunCommand, fileOverlayOpen, fileMatches, fileSelected, acceptFile,
    channel, steerSend, submitText,
  })

  /** Expand/collapse the fullscreen editor (shortcut + ✎ affordance).
   *  Expanding also DROPS any fold block: the fullscreen view shows and
   *  edits the full text, and the block's atomic-clamp semantics (caret
   *  pushed to its edges, selection clamped to one side) would contradict
   *  that — the chip's own click-to-expand already means "unfold". */
  const toggleExpand = () => {
    const next = !expandedRef.current
    expandedRef.current = next
    setExpanded(next)
    if (next) {
      expandedScrollRef.current = 0
      if (foldBlockRef.current) updateFoldBlock(null)
    }
    // Geometry changed wholesale (a fullscreen cover): the double-click
    // self-detection's screen-cell memory is void, same as on resize.
    lastClickAtRef.current = 0
    lastClickColRef.current = -1
    lastClickRowRef.current = -1
  }

  /** Withdraw the fullscreen editor, keeping text/caret/selection intact. */
  const collapseEditor = () => {
    expandedRef.current = false
    setExpanded(false)
    lastClickAtRef.current = 0
    lastClickColRef.current = -1
    lastClickRowRef.current = -1
  }

  /** The editor's explicit send (Ctrl+Enter / Send button): the Enter main
   *  path, then collapse — an empty draft just collapses. */
  const submitFromEditor = () => {
    handleEnter()
    collapseEditor()
  }

  /** Line index of the cursor; -1 when the cursor is at the very end. */
  const cursorLine = (text: string, cursorOffset: number) => {
    const before = text.slice(0, cursorOffset)
    return before.split('\n').length - 1
  }
  /** Column of the cursor within its line. */
  const cursorColumn = (text: string, cursorOffset: number) => {
    const before = text.slice(0, cursorOffset)
    const line = before.split('\n').pop() ?? ''
    return line.length
  }
  // 展开态无视折叠块：全屏编辑就是为了看全文（foldBlock 状态保留，
  // 收起后折叠显示恢复）。
  const block = expanded ? null : foldBlock

  const head = block ? value.slice(0, block.start) : ''
  const tail = block ? value.slice(block.end) : ''

  // === Keyboard dispatch (prompt-input/prompt-keys.ts) =====================
  // The useInput body and its callback-only helpers moved out verbatim;
  // deps are rebuilt every render so the closure sees current state
  // exactly as the inline body did.
  const promptKeys = createPromptKeyHandler({
    // text & caret state
    value, valueRef, cursorRef, setInput, head, tail, updateFoldBlock,
    // selection
    selectionRef, clearSelection,
    // vim mode
    vimEnabledRef, vimInsertRef, vimPendingRef, vimUndoRef, setVimInsert, clearVimUndo,
    // completion & overlays
    suggestions, selectedCommand, setSelectedCommand, fileMatches, fileSelected, setFileSelected,
    overlayOpen, fileOverlayOpen, mention, helpScrollRef, helpViewportHeight,
    expandEnabled, toggleExpand, collapseEditor, handleEnter,
    // refs (esc / clipboard / editor / history / image staging)
    clipboardBusyRef, editorBusyRef, escPendingRef, escTimerRef, expandedRef, fileEscRef, foldBlockRef,
    history, historyDraft, historyIndex, imageStageChainRef, nextImageNumberRef,
    // draft image pipeline
    draftImagesRef, acceptFile, advanceDraftRevision, boundImageSpans, captureDraftImageLease,
    discardDraftImages, discardUnretainedImages, draftImageLeaseIsCurrent, imageRefsFor,
    replaceDraftImages, syncImageGeneration, shellImagesUnsupported,
    // history & submit
    seedHistory, rememberHistory, submitText, submitFromEditor, tryRunCommand, clearDeliveredDraft,
    // caret helpers
    cursorColumn, cursorLine, isBigInput,
    // props & external handlers
    channel, selectionActive, caretPreviewOpen, helpOpen, onToggleHelp, onBackgroundRequest,
    onDismissCaretPreview, onEnterSelection, onRewindRequest, onSubmitted,
  })

  useInput(promptKeys, { isActive: !suspended })

  // === Render: hard-wrap every logical line at the input width, then show
  // the window of visual lines with the caret row always visible.
  // Narrow terminals: the usable width follows the real terminal down to a
  // single column — a fixed floor of 10 would wrap far too early and park
  // the declared cursor past the value box's actual width.
  // The vim badge ('INSERT '/'NORMAL ', 7 cols) sits BEFORE the value box in
  // the same row, so the wrap budget must shrink by its width or long lines
  // would be clipped at the value box's right edge.
  const vimBadgeCols = vimEnabled ? 7 : 0
  // 行首会话入口占列：未传 onOpenSessions 时按钮整体不渲染，预算同步归还
  // （既有调用方的可用列数逐列不变）。用实测常量而不是 stringWidth：该字符
  // 是 U+1F3E0+VS15，stringWidth 按码点算 2（含 VS15 仍是 2），终端只给 1，
  // 见 HOME_BUTTON_COLS 的说明。
  const homeButtonCols = onOpenSessions === undefined ? 0 : HOME_BUTTON_COLS
  // 补全卡片边框与输入框 idle 边框同色（plan 模式下整套面板一起变 sage
  // 绿）。`/color` 会话强调色优先于主题 promptBorder（plan 模式仍整体走
  // sage 绿）。`?? ''` 防御最小 mock channel（只声明用到的字段的回归脚
  // 本）。声明在渲染派生区之前：展开编辑器的行号高亮与边框同用此色。
  const sessionAccent = sessionColorHex(channel.sessionColor ?? '')
  const promptAccent = channel.mode.plan === true ? 'planMode' : (sessionAccent ?? 'promptBorder')
  // 展开态布局参数：编辑器独占整屏 —— 行号槽（宽度随逻辑行数伸缩）+
  // 圆角边框 2 + 两侧 padding 各 1 占列，⌸ 入口 / ❯ 前缀 / vim 徽标 /
  // ⛶ 按钮全部让位；收起态额外扣掉行首 ⌸ 入口（未渲染时 0 列）与行尾
  // ⛶ 按钮的 2 列。
  const editorLogicalLines = expanded ? value.split('\n').length : 1
  const editorNoWidth = Math.max(2, String(editorLogicalLines).length)
  const editorGutterCols = editorNoWidth + 3
  const inputWidth = expanded
    ? Math.max(1, columns - 4 - editorGutterCols)
    : Math.max(1, columns - 3 - vimBadgeCols - homeButtonCols - (expandEnabled ? 2 : 0))
  // Fold-block model: the value renders as [head rows][chip row][tail rows]
  // — the block is ONE atomic visual row regardless of its text size; text
  // before/after it stays fully editable and never unfolds it.
  const foldText = block ? value.slice(block.start, block.end) : value
  const headRows = block ? wrapToWidth(head, inputWidth) : []
  const tailRows = block ? wrapToWidth(tail, inputWidth) : []
  const chipRow = block ? headRows.length : -1
  const visualLines = block
    ? [...headRows, '', ...tailRows]
    : wrapToWidth(value, inputWidth)
  // Caret geometry uses the FULL wrap (not `value.slice(0, cursor)`):
  // word-wrap carry moves already-placed clusters, so a prefix wrap would
  // disagree with the displayed rows whenever the cursor sits inside a
  // carried word.
  const caretPlaced = block
    ? cursor <= block.start
      ? caretInText(head, inputWidth, cursor)
      : caretInText(tail, inputWidth, Math.max(0, cursor - block.end))
    : caretInText(value, inputWidth, cursor)
  const caretVisualLine =
    block && cursor > block.start
      ? headRows.length + 1 + caretPlaced.line
      : caretPlaced.line
  const caretCharCol = caretPlaced.charCol
  const caretVisualCol = caretPlaced.visualCol

  // Fold stats describe the BLOCK (or the whole input when expanded and
  // the ▾ prefix offers a manual whole-input fold). The chip shows the
  // block's own line/char count + first-line preview — the preview text
  // around it is unaffected.
  const big = isBigInput(foldText)
  const stats = big
    ? t('input-fold-stats', { lines: foldText.split('\n').length, chars: foldText.length })
    : ''
  const peekOpen = block !== null && hovered && !selectionActive

  // 展开态的编辑区行高预算：圆角边框 2 + 标题行 1 + 状态行 1 + 按钮行 1。
  const editorMaxRows = Math.max(1, terminalRows - EDITOR_CHROME_ROWS)
  if (expanded && caretVisualLine !== prevCaretLineRef.current) {
    // A real caret move re-engages following after wheel browsing.
    editorFreeScrollRef.current = false
    prevCaretLineRef.current = caretVisualLine
  }
  let windowStart: number
  let visibleCount: number
  if (expanded) {
    // 滚轮推动的窗口与 caret 跟随合并：自由滚动（滚轮浏览）期间不强制
    // caret 可见；caret 移动后恢复跟随。写回 ref，滚轮分支读到的就是
    // 合并后的基线。
    let win = expandedScrollRef.current
    if (!editorFreeScrollRef.current) {
      if (caretVisualLine < win) win = caretVisualLine
      if (caretVisualLine >= win + editorMaxRows) win = caretVisualLine - editorMaxRows + 1
    }
    win = Math.max(0, Math.min(win, Math.max(0, visualLines.length - editorMaxRows)))
    expandedScrollRef.current = win
    windowStart = win
    visibleCount = editorMaxRows
  } else {
    windowStart = Math.max(
      0,
      Math.min(
        caretVisualLine - MAX_VISIBLE_LINES + 1,
        visualLines.length - MAX_VISIBLE_LINES,
      ),
    )
    visibleCount = MAX_VISIBLE_LINES
  }
  const visibleLines = visualLines.slice(
    windowStart,
    windowStart + visibleCount,
  )
  // Caret-window jump: when the caret leaves MAX_VISIBLE_LINES (typing past
  // it, arrow-key walks through a long prompt) the whole visible band is
  // replaced in place — same-height rows, completely different text. The
  // per-cell diff that repaints that band is exactly the path that goes
  // haywire when the inline viewport is even one row out of sync with the
  // terminal's scrollback ("重叠变花": old rows bleeding through the new
  // ones). Same one-shot reanchor family as the shrink/floaters/editor
  // patches above — the window jump is a viewport-level discontinuity, not
  // an ordinary content edit.
  const prevWindowStartRef = React.useRef(windowStart)
  React.useLayoutEffect(() => {
    if (windowStart !== prevWindowStartRef.current) {
      prevWindowStartRef.current = windowStart
      const ink = instances.get(process.stdout) ?? instances.values().next().value
      ink?.invalidatePrevFrame()
      ink?.reanchorViewport()
    }
  }, [windowStart])
  // useInput 的滚轮分支需要这份几何（它在这些派生之前注册）。
  if (expanded) {
    editorViewportRef.current = { maxRows: editorMaxRows, total: visualLines.length }
  }

  // Folded chip content: block stats + first-line preview + hover hint,
  // all pre-truncated to the input width (the row is one line, always).
  // `·` separators are U+30FB KATAKANA MIDDLE DOT, NOT U+00B7: the latter
  // is East-Asian-ambiguous (model 1 cell, CJK terminal fonts paint 2) and
  // this row's stats→preview→hint truncation arithmetic all runs through
  // stringWidth — a painted-wide separator shifts every segment right by
  // one column per separator and the row reads as overlapping text.
  // U+30FB is officially Ambiguous too, but get-east-asian-width hardcodes
  // it Wide and mainstream terminals (Western included) paint it 2 cells —
  // the model and the painted width agree in practice. A wcwidth-strict
  // Western terminal painting it 1 cell would leave a spare column, which
  // the `- 6` slack below absorbs.
  const foldBadge = `▸ ${stats}`
  const foldHint = t('input-fold-hover')
  const foldPreviewWidth =
    inputWidth - stringWidth(foldBadge) - stringWidth(`・${foldHint}`) - 6
  const foldPreview =
    foldPreviewWidth >= 8
      ? truncateToWidth(foldText.split('\n')[0] ?? '', foldPreviewWidth)
      : ''

  // Expanded-state fold affordance: a `▾` prefix at the start of the FIRST
  // row (only while the window is at the top and no block exists); its
  // cells fold the whole input into a block again on click.
  const prefixLabel = `▾ ${stats}・`
  const prefixCols =
    !block && !expanded && big && windowStart === 0 ? stringWidth(prefixLabel) : 0

  // Offset range [start, end) of every visual row — the SAME break rule as
  // wrapToWidth — so the selection highlight can intersect each row. With a
  // fold block, the chip row maps to the block's own span (never selected:
  // updateSelection clamps the selection into the head or the tail side).
  const lineRanges: Array<[number, number]> = block
    ? [
        ...visualLineRanges(head, inputWidth),
        [block.start, block.end],
        ...visualLineRanges(tail, inputWidth).map(
          ([s, e]): [number, number] => [s + block.end, e + block.end],
        ),
      ]
    : visualLineRanges(value, inputWidth)

  /**
   * Inverse runs for one rendered row, shared by the inline prompt and the
   * expanded editor: the selection's intersection (if any) and the caret
   * cluster on the caret's row. Both render <Text inverse>; overlapping
   * intervals merge so a caret inside the selection stays one continuous
   * highlight. The caret row inverts the WHOLE cluster at the caret column
   * (solid block) — [col, next boundary) covers a surrogate pair or ZWJ
   * emoji as one glyph; at the text end it shows a blank inverse cell like
   * the empty-input caret (appended after everything, so a selection
   * ending there cannot swallow it).
   */
  const rowHighlightPieces = (
    text: string,
    absoluteLine: number,
  ): Array<{ text: string; inverse: boolean; chip: boolean }> => {
    const [rowStart] = lineRanges[absoluteLine] ?? [0, 0]
    // Per-character style: 0 plain, 1 chip (a staged token), 2 inverse
    // (selection or caret cluster). Inverse wins over chip.
    const PLAIN = 0
    const CHIP = 1
    const INVERSE = 2
    const kinds = new Uint8Array(text.length)
    const fill = (lo: number, hi: number, kind: number): void => {
      for (let i = Math.max(lo, 0); i < Math.min(hi, text.length); i++) kinds[i] = kind
    }
    const spans = boundImageSpans(value)
    for (const span of spans) fill(span.start - rowStart, span.end - rowStart, CHIP)
    const sel = selection
    if (sel) fill(sel.start - rowStart, sel.end - rowStart, INVERSE)
    let endBlankCaret = false
    if (absoluteLine === caretVisualLine) {
      const col = Math.min(caretCharCol, text.length)
      // A staged token is one caret cluster: with the caret at its start the
      // whole token inverts (the selected-chip look), and Delete removes it.
      const tokenAtCaret = spans.find(span => span.start === rowStart + col)
      const clusterEnd = tokenAtCaret !== undefined
        ? Math.min(tokenAtCaret.end - rowStart, text.length)
        : nextGraphemeBoundary(graphemeBoundaries(text), col)
      if (clusterEnd > col) fill(col, clusterEnd, INVERSE)
      else endBlankCaret = col === text.length
    }
    const pieces: Array<{ text: string; inverse: boolean; chip: boolean }> = []
    let pos = 0
    while (pos < text.length) {
      const kind = kinds[pos]!
      let end = pos + 1
      while (end < text.length && kinds[end] === kind) end++
      pieces.push({ text: text.slice(pos, end), inverse: kind === INVERSE, chip: kind === CHIP })
      pos = end
    }
    if (endBlankCaret) pieces.push({ text: ' ', inverse: true, chip: false })
    return pieces
  }

  const rendered = visibleLines.map((line, index) => {
    const absoluteLine = windowStart + index
    if (block && absoluteLine === chipRow) {
      // The fold block's atomic chip row: click expands it; hover pops the
      // peek card. The row is one line no matter how big the block is.
      return (
        <Box
          key={`fold-${absoluteLine}`}
          flexDirection="row"
          onClick={(event) => {
            event.stopImmediatePropagation()
            updateFoldBlock(null)
          }}
          onMouseEnter={hoverEnter}
          onMouseLeave={hoverLeave}
        >
          <Text dimColor>{foldBadge}</Text>
          {foldPreview !== '' && <Text dimColor>・</Text>}
          {foldPreview !== '' && <Text wrap="truncate-end">{foldPreview}</Text>}
          <Text dimColor>{`・${foldHint}`}</Text>
        </Box>
      )
    }
    const withPrefix = absoluteLine === 0 && prefixCols > 0
    const text = withPrefix ? truncateToWidth(line, inputWidth - prefixCols) : line
    const prefix = withPrefix ? <Text dimColor>{prefixLabel}</Text> : null
    const pieces = rowHighlightPieces(text, absoluteLine)
    return (
      <Text key={absoluteLine} wrap="truncate-end">
        {prefix}
        {pieces.length === 0 ? ' ' : pieces.map((piece, pieceIndex) =>
          piece.inverse ? (
            <Text key={pieceIndex} inverse>
              {piece.text}
            </Text>
          ) : piece.chip ? (
            <Text key={pieceIndex} color="suggestion">
              {piece.text}
            </Text>
          ) : (
            piece.text
          ),
        )}
      </Text>
    )
  })

  // ── 展开态编辑行 ────────────────────────────────────────────────────
  // Logical line number per visual row (a wrapped continuation keeps its
  // line's number): the row's range end sitting on a '\n' starts a new
  // logical line from the NEXT row.
  const editorRowLogical: number[] = []
  if (expanded) {
    let count = 0
    for (let i = 0; i < lineRanges.length; i++) {
      editorRowLogical.push(count)
      const rangeEnd = lineRanges[i]![1]
      if (value[rangeEnd] === '\n') count++
    }
  }
  const editorRows = expanded
    ? visibleLines.map((line, index) => {
        const absoluteLine = windowStart + index
        const isCaretRow = absoluteLine === caretVisualLine
        const logicalNo = editorRowLogical[absoluteLine]
        const gutterLabel =
          logicalNo === undefined
            ? ' '.repeat(editorNoWidth)
            : String(logicalNo + 1).padStart(editorNoWidth, ' ')
        const pieces = rowHighlightPieces(line, absoluteLine)
        return (
          <Text
            key={absoluteLine}
            wrap="truncate-end"
            backgroundColor={isCaretRow ? 'toolCardBackgroundDim' : undefined}
          >
            <Text
              dimColor={!isCaretRow}
              bold={isCaretRow}
              color={isCaretRow ? promptAccent : undefined}
            >
              {`${gutterLabel} │ `}
            </Text>
            {pieces.map((piece, pieceIndex) =>
              piece.inverse ? (
                <Text key={pieceIndex} inverse>
                  {piece.text}
                </Text>
              ) : piece.chip ? (
                <Text key={pieceIndex} color="suggestion">
                  {piece.text}
                </Text>
              ) : (
                piece.text
              ),
            )}
          </Text>
        )
      })
    : null

  // Peek card content: the BLOCK's text wrapped to the card's inner width,
  // capped at PEEK_MAX_ROWS visual rows (a preview — click to expand and
  // edit the real input). The footer reports the clipped remainder.
  const PEEK_MAX_ROWS = 10
  const peekVisualLines: string[] = []
  for (const line of foldText.split('\n')) {
    for (const row of wrapToWidth(line, cardContentWidth(columns))) {
      if (peekVisualLines.length >= PEEK_MAX_ROWS) break
      peekVisualLines.push(row)
    }
    if (peekVisualLines.length >= PEEK_MAX_ROWS) break
  }
  const peekClipped = peekVisualLines.length >= PEEK_MAX_ROWS

  // Composer height shrink: clearing multi-line text (Enter/Esc/Ctrl+C/
  // Backspace) collapses the input area within one commit, shifting the
  // status line up and the whole chrome with it. The renderer's
  // full-damage pass (didLayoutShift) repaints the shifted siblings, but
  // inline mode's virtual↔scrollback correspondence needs the stronger
  // in-place viewport repaint — same treatment as Ctrl+O and the
  // loaded-context toggle (see Chat.tsx). One-shot, only on SHRINK:
  // growth scrolls the terminal naturally and needs no recovery.
  const contentRows = value.length === 0 ? 1 : visibleLines.length
  noteAuxNumber('promptContentRows', contentRows)
  const prevContentRowsRef = React.useRef(contentRows)
  React.useLayoutEffect(() => {
    if (contentRows < prevContentRowsRef.current) {
      const ink = instances.get(process.stdout) ?? instances.values().next().value
      ink?.invalidatePrevFrame()
      ink?.reanchorViewport()
    }
    prevContentRowsRef.current = contentRows
  }, [contentRows])

  const lastNotification =
    channel.notifications[channel.notifications.length - 1]

  // Park the native terminal cursor at the input caret (via the renderer's
  // cursor-declaration mechanism). Terminal emulators render IME preedit
  // text and screen-reader focus at the physical cursor, so parking it at
  // the caret makes CJK/IME composition appear inline at the input instead
  // of at the screen's bottom row; in line-mode terminals the console echo
  // of typed characters lands at the same spot. `line`/`column` are
  // relative to the value box the ref attaches to.
  const valueBoxRef = useDeclaredCursor({
    line: caretVisualLine - windowStart,
    // Clamp the declared column to the wrap width: a grapheme wider than
    // the last remaining column (emoji at width 1) can push the visual
    // column past inputWidth, and the park must stay inside the value box.
    // In the expanded editor the declared box starts at its outer edge
    // (padding + gutter included), so those columns ride along and the
    // clamp grows with them.
    //
    // The declared column is relative to the VALUE BOX, and `caretVisualCol`
    // is already measured in that box's cell space: the text box IS the text
    // run, so nothing that renders before it — the session entry, the `❯ `
    // glyph, the fold prefix — shifts a cell inside it. Adding any of those
    // back double-counts them and parks the hardware cursor to the RIGHT of
    // the inverted caret cell (a 2-column miss shows up as a displaced IME
    // preedit target). Only the expanded editor declares against a wider box
    // (gutter + padding), so only that branch adds columns.
    column: Math.min(
      caretVisualCol + (expanded ? editorGutterCols + 1 : 0),
      expanded ? editorGutterCols + 1 + inputWidth : inputWidth,
    ),
    active: !suspended && !selectionActive,
  })

  const { handleValueClick, handleDragStart, handleDragMove, handleDragEnd } = createPromptInteractions({
    // layout & wrap geometry (render-derived)
    value, head, tail, block, inputWidth, chipRow, prefixCols, windowStart, visibleCount, visualLines,
    // refs
    valueRef, cursorRef, selectionRef, dragAnchorRef, lastClickAtRef, lastClickColRef, lastClickRowRef,
    foldBlockRef, draftImagesRef,
    // state setters & component helpers
    setCursor, setSelection, clearSelection, updateFoldBlock, syncImageGeneration, reportCaretImage, boundImageSpans,
    // props
    channel,
  })

  // 浮层整体挂载条件：与内部面板可见条件精确同值。关闭时必须把整个
  // absolute 浮层移除——渲染器的 absolute-removed 检测只看被移除节点自身
  // 的 style.position，常驻浮层 + 移除普通子节点不会触发 blit 解毒，被
  // 覆盖的转录行会留空（见 Chat.tsx dialogOverlayOpen 注释）。展开态由
  // 全屏编辑器接管，内联浮层全部撤下。
  const floatersOpen =
    !suspended &&
    !expanded &&
    (helpOpen || channel.pending.length > 0 || fileOverlayOpen || overlayOpen || peekOpen)
  // 顶边框右侧的会话名标签 chip：色随强调色；超宽截断，宽度
  // 随终端列数伸缩但不超过 28 显示单元。默认关闭——`/settings` 的
  // 「会话名标签」开关（dsh-tui.promptSessionLabel）开启后显示。
  const sessionTitle = channel.sessionTitle ?? ''
  const topRightLabel: InputBorderLabel | undefined =
    channel.promptSessionLabel === true && sessionTitle !== ''
      ? {
          text: truncateToWidth(sessionTitle, Math.max(8, Math.min(28, columns - 8))),
          color: channel.mode.plan === true ? 'planMode' : (sessionAccent ?? 'accent'),
          ink: 'inverseText',
        }
      : undefined

  // 浮层最佳路径（/ 命令卡、@ 文件卡、帮助/队列）经渲染器 absolute-overlay
  // 机制覆盖转录尾部与状态行。若覆盖期间上方兄弟重绘（spinner 滴答、流式
  // 文本），覆盖单元格会混入 prevScreen 的旧转录内容——"重叠变花"的根因
  // （渲染器注释描述的同族问题）。Chat.tsx 对其浮层/高度切换都做视口重锚
  // （Ctrl+O、loaded-context）；此处为斜杠/文件浮层的开关补上同样的恢复：
  // 打开时保证卡片整块重绘、关闭时保证被覆盖行回到干净的转录内容，而非与
  // scrollback 失同步后残留花屏。
  const prevFloatersOpenRef = React.useRef(floatersOpen)
  React.useLayoutEffect(() => {
    if (floatersOpen === prevFloatersOpenRef.current) return
    prevFloatersOpenRef.current = floatersOpen
    const ink = instances.get(process.stdout) ?? instances.values().next().value
    ink?.invalidatePrevFrame()
    ink?.reanchorViewport()
  }, [floatersOpen])

  // 全屏编辑器的真实可见性同时受 expanded 与 prompt-slot suspension
  // 控制。对话框临时接管时撤下、关闭后恢复，和手动展开/收起一样都必须
  // 重锚 inline 视口；只在一次真正的 false→true 展开时归零滚动位置，
  // suspension 往返保留用户浏览到的行。
  const editorVisible = expanded && !suspended
  const prevEditorVisibleRef = React.useRef(editorVisible)
  React.useLayoutEffect(() => {
    if (expanded && !prevExpandedRef.current) expandedScrollRef.current = 0
    prevExpandedRef.current = expanded
    if (editorVisible === prevEditorVisibleRef.current) return
    prevEditorVisibleRef.current = editorVisible
    const ink = instances.get(process.stdout) ?? instances.values().next().value
    ink?.invalidatePrevFrame()
    ink?.reanchorViewport()
  }, [editorVisible, expanded])

  // Feature turned off mid-session while the editor is up: withdraw the
  // cover (the draft and every other editing state survive).
  React.useEffect(() => {
    if (expanded && !expandEnabled) collapseEditor()
  }, [expanded, expandEnabled])

  // ── 全屏草稿编辑节点 ────────────────────────────────────────────────
  // 每次渲染构造新鲜闭包（value/caret/handlers），经 module store 发布给
  // Chat 根部末尾的 PromptEditorLayer（树序最后 → 盖住全部后绘兄弟）。
  // useInsertionEffect 发布：sink 的同步重渲染发生在 layout 阶段之前，
  // useDeclaredCursor（layout effect）读到的新 ref 已指向编辑区 Box。
  // 点击/拖拽坐标以内容区为原点（localCol 去掉行号槽宽度）。
  const editorNode = editorVisible ? (
    <ExpandedEditor
      value={value}
      cursor={cursor}
      promptAccent={promptAccent}
      editorGutterCols={editorGutterCols}
      editorRows={editorRows}
      vimEnabled={vimEnabled}
      vimInsert={vimInsert}
      valueBoxRef={valueBoxRef}
      editorViewportRef={editorViewportRef}
      editorFreeScrollRef={editorFreeScrollRef}
      expandedScrollRef={expandedScrollRef}
      setExpandedTick={setExpandedTick}
      cursorLine={cursorLine}
      cursorColumn={cursorColumn}
      submitFromEditor={submitFromEditor}
      collapseEditor={collapseEditor}
      handleValueClick={handleValueClick}
      handleDragStart={handleDragStart}
      handleDragMove={handleDragMove}
      handleDragEnd={handleDragEnd}
    />
  ) : null
  React.useInsertionEffect(() => {
    setPromptEditorNode(editorNode)
  })
  React.useEffect(() => {
    // 卸载保险：PromptInput 被替换（问卷/面板接管）时撤下全屏浮层。
    return () => {
      setPromptEditorNode(null)
    }
  }, [])

  // Approval, question and managed-dialog panels temporarily own Chat's
  // prompt slot. Stay mounted so an async command can settle without losing
  // its exact text/image draft, while contributing no layout, input, cursor,
  // editor layer, or external injection controller.
  if (suspended) return null

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      onClick={() => {
        // Click-to-refocus — the mouse counterpart of Tab-back: while
        // selection mode holds the keyboard, a click anywhere on the input
        // cluster hands it back to the composer. Deeper handlers run first
        // (bubbling); the ones that acted stop propagation on their own, so
        // reaching the root means the click landed on plain input chrome.
        if (selectionActive) onExitSelection?.()
      }}
    >
      {/* 瞬态面板浮层（帮助/队列/补全）：零布局高度、向上覆盖转录尾部，
          帧高不随面板开关涨落——否则帧顶行会被滚进 scrollback 并在关闭
          重绘时二次写入（/model 切换多一份启动画的根因，见 OverlayAbove）。 */}
      {floatersOpen && (
      <OverlayAbove maxHeight={Math.max(terminalRows - 6, 1)}>
        {helpOpen && (
          <Box marginBottom={1}>
            <HelpMenu
              commands={channel.commandList}
              viewportHeight={helpViewportHeight}
              viewportWidth={columns}
              scrollRef={helpScrollRef}
              onCommandPick={(name) => {
                // 点击命令行 = 填入 /name 并关闭帮助（Tab 补全的鼠标等价）
                updateFoldBlock(null)
                setInput(`/${name} `)
                onToggleHelp()
              }}
            />
          </Box>
        )}
        {!helpOpen && channel.pending.length > 0 && (
          <Box flexDirection="column" paddingLeft={2} paddingBottom={1}>
            {channel.pending.some(item => item.placement === 'steer') && (
              <Box flexDirection="column">
                <Text dimColor>⚡ {t('input-pending-steer-label')}</Text>
                {channel.pending
                  .filter(item => item.placement === 'steer')
                  .map(item => (
                    <Text key={item.id} dimColor wrap="truncate">
                      {'  '}↳ {item.text}
                    </Text>
                  ))}
              </Box>
            )}
            {channel.pending.some(item => item.placement === 'followup') && (
              <Box flexDirection="column">
                <Text dimColor>⏳ {t('input-pending-queue-label')}</Text>
                {channel.pending
                  .filter(item => item.placement === 'followup')
                  .map(item => (
                    <Text key={item.id} dimColor wrap="truncate">
                      {'  '}↳ {item.text}
                    </Text>
                  ))}
              </Box>
            )}
            <Text dimColor>Alt+↑ {t('input-pending-actions-hint')}</Text>
          </Box>
        )}
        {fileOverlayOpen && (
          <FileSuggestions
            files={fileMatches}
            selectedIndex={fileSelected}
            columns={columns}
            query={mention?.query ?? ''}
            accent={promptAccent}
            // 点击行 = 接受该项（与 Enter 同路径）
            onPick={(index) => {
              const file = fileMatches[index]
              if (file) acceptFile(file)
            }}
            // 滚轮 = 移动选中行（与 ↑/↓ 同路径，窗口跟随）
            onWheelStep={(step) => {
              setFileSelected(i => Math.max(0, Math.min(fileMatches.length - 1, i + step)))
            }}
          />
        )}
        {overlayOpen && (
          <CommandSuggestions
            commands={suggestions}
            selectedIndex={selectedCommand}
            columns={columns}
            query={value}
            accent={promptAccent}
            // 点击行 = 运行该命令（与 Enter 同路径）
            onPick={(index) => {
              const command = suggestions[index]
              if (command) tryRunCommand(command.commandLine)
            }}
            // 滚轮 = 移动选中行（与 ↑/↓ 同路径，窗口跟随）
            onWheelStep={(step) => {
              setSelectedCommand(i => Math.max(0, Math.min(suggestions.length - 1, i + step)))
            }}
          />
        )}
        {peekOpen && (
          // 悬停预览卡片：只读展示折叠内容的头部（输入框自身保持一行，
          // 布局零跳动）。点击任一行 = 固定展开进入真实输入框编辑；悬停
          // 期间鼠标直接打字同样先展开（见折叠态按键分支）。卡片自身的
          // enter/leave 维持 hovered，防止 chip→卡片过渡闪烁。
          <Box onMouseEnter={hoverEnter} onMouseLeave={hoverLeave}>
            <SuggestionCard
              title={stats}
              columns={columns}
              accent={promptAccent}
              footer={
                peekClipped
                  ? t('input-fold-peek-footer', { lines: foldText.split('\n').length })
                  : undefined
              }
              rows={peekVisualLines.map((row, index) => (
                <Text key={index} wrap="truncate-end">
                  {row}
                </Text>
              ))}
              onRowPick={() => {
                updateFoldBlock(null)
                setHovered(false)
              }}
            />
          </Box>
        )}
      </OverlayAbove>
      )}
      {lastNotification && (
        // position=absolute takes zero layout height so the transcript never
        // shifts when a notification appears/disappears; the layer floats one
        // row above the prompt border, right-aligned.
        <Box
          position="absolute"
          marginTop={-1}
          height={1}
          width="100%"
          paddingLeft={2}
          paddingRight={1}
          flexDirection="column"
          justifyContent="flex-end"
          overflow="hidden"
        >
          <Box justifyContent="flex-end">
            <Text
              color={lastNotification.color}
              dimColor={!lastNotification.color}
              wrap="truncate"
            >
              {lastNotification.text}
            </Text>
          </Box>
        </Box>
      )}
      {/* The prompt's own top/bottom border rows, self-drawn so the effort
          overlay can play on them (sweep → tier name → fade; see
          EffortInputBorder). Idle colour keeps the plan-mode accent the old
          Box border carried. */}
      <EffortInputBorder
        effort={channel.reasoningEffort}
        levels={channel.effortLevels}
        columns={columns}
        onLight={isLightThemeActive(themeName)}
        idleColor={promptAccent}
        topRightLabel={topRightLabel}
      >
        <Box flexDirection="row" alignItems="flex-start" width="100%">
          {/* ⌂ 会话列表入口：点击打开会话浏览；hover 提亮为输入框强调色。
              行首固定 2 列（`⌂` 1 列 + 分隔空格 1 列，见 homeButtonCols）；
              未传 onOpenSessions 时整体不渲染（宽度预算同步归还）。 */}
          {onOpenSessions !== undefined && (
            <Box
              flexShrink={0}
              onClick={(event) => {
                event.stopImmediatePropagation()
                onOpenSessions?.()
              }}
              onMouseEnter={() => {
                setHomeHovered(true)
              }}
              onMouseLeave={() => {
                setHomeHovered(false)
              }}
            >
              <Text
                dimColor={!homeHovered}
                bold={homeHovered}
                color={homeHovered ? promptAccent : undefined}
              >
                {HOME_BUTTON_TEXT}
              </Text>
            </Box>
          )}
          <EffortChargeGlyph
            effort={channel.reasoningEffort}
            levels={channel.effortLevels}
            working={channel.working}
          />
          {vimEnabled && (
            <Text bold color={vimInsert ? 'success' : 'warning'}>
              {vimInsert ? 'INSERT' : 'NORMAL'} </Text>
          )}
          <Box
            ref={expanded ? undefined : valueBoxRef}
            flexGrow={1}
            flexShrink={1}
            onClick={handleValueClick}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
          >
            {value.length === 0 ? (
              // Solid block caret on a BLANK cell: the terminal paints the
              // IME preedit (pinyin) at the physical cursor, which is parked
              // right here, so nothing else may occupy this cell.
              <>
                <Text inverse> </Text>
                {/* 三幕点焰第二幕：空输入行居中短暂浮现档名大写（纯文
                    本流自带偏移空格——不引入嵌套 Box，行数恒定；有文字
                    时不显示）。3 = 行内 `❯ `（2 列）+ 空输入块光标（1
                    列）；行首 ⌂ 入口渲染时徽标之前还要多占它的列数。 */}
                <EffortTierBadge
                  effort={channel.reasoningEffort}
                  levels={channel.effortLevels}
                  onLight={isLightThemeActive(themeName)}
                  columns={columns}
                  leadingColumns={3 + homeButtonCols}
                />
              </>
            ) : (
              <Box flexDirection="column">{rendered}</Box>
            )}
          </Box>
          {/* ⛶ 全屏草稿编辑入口：点击展开；hover 提亮为输入框强调色。
              inputWidth 已为它预留 2 列（见渲染派生区）；设置关闭时
              整体不渲染（宽度预算同步归还）。 */}
          {expandEnabled && (
            <Box
              flexShrink={0}
              onClick={(event) => {
                event.stopImmediatePropagation()
                toggleExpand()
              }}
              onMouseEnter={() => {
                setExpandHovered(true)
              }}
              onMouseLeave={() => {
                setExpandHovered(false)
              }}
            >
              <Text
                dimColor={!expandHovered}
                bold={expandHovered}
                color={expandHovered ? promptAccent : undefined}
              >
                ⛶
              </Text>
            </Box>
          )}
        </Box>
      </EffortInputBorder>
      {/* Agent-view footer: "← N agents" when background sessions are
          waiting on the user, "← for agents" otherwise — the ← affordance's
          discoverability hint. Only rendered when the Chat screen supplies
          the count. */}
      {backgroundAgentsNeedingInput !== undefined && (
        <Box flexDirection="row" justifyContent="flex-end" paddingRight={2}>
          <Text dimColor>
            {backgroundAgentsNeedingInput > 0
              ? t('input-background-hint-count', { n: backgroundAgentsNeedingInput })
              : t('input-background-hint-idle')}
          </Text>
        </Box>
      )}
    </Box>
  )
}
