import type { Key } from '../../ink/events/input-event.js'
import type { ChatRow } from '../../dsh-adapter/channel.js'
import { actionMatches } from '../../utils/keymap.js'
import { isMod } from '../../utils/modifiers.js'
import { reduceToolBlocks } from '../../components/messages/tool-blocks.js'
import { stripNarration } from '../../utils/narration.js'

/**
 * Selection-mode state machine, pure: given the key and a small snapshot of
 * the world, produce the intent — never perform it. Extracted verbatim from
 * the useInput selection branch so key semantics are unit-testable without
 * a renderer, a FakeStdout, or keystroke pacing sleeps.
 */

/** One actionable outcome of a selection-mode keypress. */
export type SelectionIntent =
  | { type: 'interrupt-or-exit' }
  | { type: 'page'; delta: 1 | -1 }
  | { type: 'toggle-transcript-mode' }
  | { type: 'move'; delta: 1 | -1 }
  | { type: 'expand' }
  | { type: 'collapse' }
  | { type: 'jump-top' }
  | { type: 'jump-bottom' }
  | { type: 'open-detail' }
  | { type: 'exit' }
  | { type: 'none' }

/** World snapshot the key → intent mapping needs (all plain data). */
export interface SelectionKeyContext {
  /** A turn is in flight — Ctrl+C interrupts instead of leaving the mode. */
  working: boolean
  /** Help owns Ctrl+O while open, so the transcript toggle yields. */
  helpOpen: boolean
  /** Deduplicated plain Enter (the useInput plainReturn gate), for details. */
  plainReturn: boolean
  /** Cursor row id, null when the transcript has nothing selectable. */
  selectedId: number | null
  /** Kind of the cursor row, for the fold-bearing expand/collapse gate. */
  selectedKind: ChatRow['kind'] | undefined
  /** Global expand mode is OFF (rows render collapsed by default). */
  expanded: boolean
  /** Row-local expansion registrations (l registered, h clears). */
  expandedRows: ReadonlySet<number>
}

/** Map one keypress to its selection-mode intent (pure). */
export function selectionKeyIntent(
  input: string,
  key: Key,
  ctx: SelectionKeyContext,
): SelectionIntent {
  // `isMod` (ctrl, or super on the mac) keeps the extraction faithful to
  // the original Chat guard: on Linux/Windows a super-modified j/k stayed
  // a plain navigation key, and only macOS treats Cmd+<key> as modified.
  const plain = !key.meta && !isMod(key)
  if (key.ctrl && !key.meta && input === 'c') {
    // Ctrl+C keeps its global interrupt meaning inside selection mode
    // (grok's "Cancel turn" works from the transcript too); idle, the
    // key just leaves the mode — same muscle memory as Esc/Tab.
    return { type: 'interrupt-or-exit' }
  }
  if (key.ctrl && !key.meta && input === 'f') return { type: 'page', delta: 1 }
  if (key.ctrl && !key.meta && input === 'b') return { type: 'page', delta: -1 }
  // Ctrl+O stays live inside selection mode: the global expand/collapse
  // owns row fold states and must not wait for the composer. Routed through
  // the keymap registry so a user remap applies here too.
  if (!ctx.helpOpen && actionMatches('transcript', input, key)) return { type: 'toggle-transcript-mode' }
  if (key.upArrow || (plain && input === 'k')) return { type: 'move', delta: -1 }
  if (key.downArrow || (plain && input === 'j')) return { type: 'move', delta: 1 }
  // l / → expands (vim right = open); only fold-bearing kinds respond, and only
  // while the global expand state leaves room for a row-local registration.
  if ((key.rightArrow || (plain && input === 'l')) && ctx.selectedId !== null) {
    const foldBearing = ctx.selectedKind === 'reasoning' || ctx.selectedKind === 'tool'
    if (foldBearing && !ctx.expanded && !ctx.expandedRows.has(ctx.selectedId)) return { type: 'expand' }
    return { type: 'none' }
  }
  // h / ← collapses (vim left = close); no seek — the shrink leaves the row put.
  if ((key.leftArrow || (plain && input === 'h')) && ctx.selectedId !== null) {
    const foldBearing = ctx.selectedKind === 'reasoning' || ctx.selectedKind === 'tool'
    if (foldBearing && ctx.expandedRows.has(ctx.selectedId)) return { type: 'collapse' }
    return { type: 'none' }
  }
  // g / gg → first selectable row (single g is the less habit, double gg
  // the vim one). G → last row AND the live tail (bottom + sticky re-pin).
  if (plain && input === 'g') return { type: 'jump-top' }
  if (input === 'G' && !key.ctrl && !key.meta && !key.super) return { type: 'jump-bottom' }
  // grok semantics ("Enter details"): Enter opens the full-content viewer.
  if (ctx.plainReturn && ctx.selectedId !== null) return { type: 'open-detail' }
  // Tab mirrors grok's focus rotation; Esc exits the same way.
  if ((key.tab && !key.shift) || key.escape) return { type: 'exit' }
  return { type: 'none' }
}

/**
 * Cursor target when (re)entering selection mode: restore the pre-exit
 * cursor when the transcript is unchanged since the exit; a new turn
 * follows the bottom row instead, matching where sticky streaming left
 * the page. Pure — rows are read, the seek is the caller's effect.
 */
export function selectionRestoreTarget(
  rows: readonly ChatRow[],
  snapshot: { maxId: number; count: number } | null,
  previousId: number | null,
  isSelectable: (row: ChatRow) => boolean,
): number | null {
  const unchanged =
    snapshot !== null &&
    rows.length === snapshot.count &&
    rows.reduce((max, row) => Math.max(max, row.id), 0) === snapshot.maxId
  const restored =
    unchanged && previousId !== null
      ? rows.find(row => row.id === previousId && isSelectable(row))
      : undefined
  const target = restored ?? rows.findLast(row => isSelectable(row))
  return target !== undefined ? target.id : null
}

/** Next cursor id for a one-row step, or null when there is no neighbor.
 *  `isHidden` skips rows that render null this frame (folded verb-group
 *  members, absorbed reasoning) — without it the cursor can land on an
 *  invisible member whose highlight stays pinned to the group row, and
 *  j/k appears to need a second press to move. */
export function selectionStepId(
  selectableRows: readonly ChatRow[],
  selectedId: number | null,
  delta: 1 | -1,
  isHidden: (id: number) => boolean = () => false,
): number | null {
  if (selectedId === null) return null
  const index = selectableRows.findIndex(row => row.id === selectedId)
  if (index < 0) return null
  for (let i = index + delta; i >= 0 && i < selectableRows.length; i += delta) {
    const row = selectableRows[i]!
    if (!isHidden(row.id)) return row.id
  }
  return null
}

/** Row ids that render null under the CURRENT fold state, mirroring the
 *  filters MessageList applies BEFORE virtualization — or the cursor lands
 *  on an invisible row and a step reads as eaten. Three sources:
 *  folded verb-group members beyond each group's first (the first renders
 *  as the group row), the reasoning those groups absorbed, and MessageList's
 *  rendersEmptyAssistant / thinkingVisible drops (a settled assistant row
 *  whose consumed `⏵` narration was its entire text, and every reasoning
 *  row while thinking display is off) — the latter two apply regardless of
 *  the global expand state, so there is no expanded early-exit here. */
export function hiddenCursorRowIds(
  rows: readonly ChatRow[],
  expanded: boolean,
  expandedRows: ReadonlySet<number>,
  thinkingVisible = true,
): ReadonlySet<number> {
  const base = reduceToolBlocks(rows)
  const unfoldedKeys = new Set<string>()
  for (const group of base.groups) {
    if (expanded || group.members.some(member => expandedRows.has(member.row.id))) {
      unfoldedKeys.add(group.firstKey)
    }
  }
  const state = unfoldedKeys.size > 0 ? reduceToolBlocks(rows, { expandedGroups: unfoldedKeys }) : base
  const hidden = new Set<number>(state.absorbedReasoning)
  for (const id of state.groupedRows) hidden.add(id)
  for (const group of state.groups) hidden.delete(group.members[0]!.row.id)
  for (const row of rows) {
    // rendersEmptyAssistant, verbatim from MessageList's visible-rows filter.
    if (row.kind === 'assistant' && row.streaming !== true &&
      state.narrationConsumed.has(row.id) &&
      stripNarration(row.text ?? '').trim() === '' &&
      (row.images?.length ?? 0) === 0) hidden.add(row.id)
    // thinkingVisible=false drops every reasoning row from the render.
    if (row.kind === 'reasoning' && !thinkingVisible) hidden.add(row.id)
  }
  return hidden
}
