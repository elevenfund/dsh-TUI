import stripAnsi from 'strip-ansi'
import { getGraphemeSegmenter } from '../../utils/intl.js'
import type { ComposerImageRef } from '../../dsh-adapter/channel.js'

/**
 * Pure text geometry for the prompt composer: editable-text sanitizing,
 * `[Image #N]` token spans, whitespace word boundaries, vim normal-mode
 * motion, and grapheme-cluster boundary math. Extracted verbatim from
 * PromptInput.tsx so the cursor math is unit-testable without a renderer,
 * a FakeStdout, or keystroke pacing sleeps.
 */

/**
 * Editable prompt text must have one stable source-to-screen geometry. The
 * renderer interprets ANSI as zero-width styling and expands tabs relative to
 * global tab stops; keeping either in `value` would let wrapping/click mapping
 * count different cells and could split an escape sequence during selection.
 * Strip terminal controls and expand tabs at ingress while preserving newlines.
 */
const EDITABLE_CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/u

/** Normalize editable text so no terminal control characters remain in state. */
export function sanitizeEditableText(text: string): string {
  // Fast path for ordinary and multi-line drafts: newline is intentionally
  // absent from the probe, so a large clean paste returns without regex work.
  if (!EDITABLE_CONTROL.test(text)) return text
  return stripAnsi(text)
    .replace(/\r\n?/gu, '\n')
    .replace(/\t/gu, '        ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
}

export const COMPOSER_IMAGE_TOKEN = /\[Image #\d+\]/gu

/** One `[Image #N]` occurrence: [start, end) offsets into the draft. */
export interface ImageTokenSpan {
  readonly start: number
  readonly end: number
  readonly token: string
}

/** Every `[Image #N]` in `text`, in order. */
export function imageTokenSpans(text: string): ImageTokenSpan[] {
  const spans: ImageTokenSpan[] = []
  for (const match of text.matchAll(COMPOSER_IMAGE_TOKEN)) {
    const start = match.index ?? 0
    spans.push({ start, end: start + match[0].length, token: match[0] })
  }
  return spans
}

/** The span whose interior (exclusive of both edges) contains `offset`. */
export function imageTokenAround(spans: readonly ImageTokenSpan[], offset: number): ImageTokenSpan | undefined {
  return spans.find(span => span.start < offset && offset < span.end)
}

/**
 * A caret never rests inside a staged token: an offset in a span's interior
 * moves to the edge `prefer` names — `'start'` (the token becomes the caret
 * cluster), `'end'`, or whichever is nearer.
 */
export function snapOffImageToken(
  spans: readonly ImageTokenSpan[],
  offset: number,
  prefer: 'start' | 'end' | 'nearest',
): number {
  const span = imageTokenAround(spans, offset)
  if (span === undefined) return offset
  if (prefer === 'start') return span.start
  if (prefer === 'end') return span.end
  return offset - span.start < span.end - offset ? span.start : span.end
}

/** Expand a deletion or selection to include every staged token it touches. */
export function expandImageTokenRange(spans: readonly ImageTokenSpan[], start: number, end: number) {
  return {
    start: snapOffImageToken(spans, start, 'start'),
    end: snapOffImageToken(spans, end, 'end'),
  }
}

/** Capabilities referenced by `text`, in first occurrence order. A raw token
 * restored from disk/history has no sidecar entry and therefore stays inert. */
export function composerImageRefsForText(
  text: string,
  stagedByToken: ReadonlyMap<string, string>,
): ComposerImageRef[] {
  const refs: ComposerImageRef[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(COMPOSER_IMAGE_TOKEN)) {
    const token = match[0]
    if (seen.has(token)) continue
    seen.add(token)
    const stageId = stagedByToken.get(token)
    if (stageId !== undefined) refs.push({ token, stageId })
  }
  return refs
}

/** Index of the word boundary at or before `cursor` (readline alt+b). */
export function wordBoundaryLeft(text: string, cursor: number): number {
  let index = cursor
  while (index > 0 && /\s/.test(text[index - 1]!)) index--
  while (index > 0 && !/\s/.test(text[index - 1]!)) index--
  return index
}

/** Index of the word boundary after `cursor` (readline alt+f). */
export function wordBoundaryRight(text: string, cursor: number): number {
  const length = text.length
  let index = cursor
  while (index < length && !/\s/.test(text[index]!)) index++
  while (index < length && /\s/.test(text[index]!)) index++
  return index
}

// --- vim normal-mode helpers -----------------------------------------------
// `/vim` 编辑模式的 normal 键位几何：行/词移动与删除目标。空白分词
// （不区分 vim 的 word/WORD），对输入框场景足够且行为直观。

/** Offset of the current line's first character. */
export function vimLineStart(text: string, cursor: number): number {
  return text.lastIndexOf('\n', cursor - 1) + 1
}

/** Offset of the current line's last character (exclusive, no '\n'). */
export function vimLineEnd(text: string, cursor: number): number {
  const next = text.indexOf('\n', cursor)
  return next === -1 ? text.length : next
}

/** Offset of the line's first non-whitespace character (`^`). */
export function vimLineFirstNonBlank(text: string, cursor: number): number {
  const start = vimLineStart(text, cursor)
  const end = vimLineEnd(text, cursor)
  let i = start
  while (i < end && /\s/.test(text[i]!)) i++
  return i
}

/** Next word start (`w`): skip the rest of the current word, then leading
 *  whitespace. Whitespace-delimited, vim-style. */
export function vimWordForward(text: string, cursor: number): number {
  const len = text.length
  let i = cursor
  if (i < len && !/\s/.test(text[i]!)) {
    while (i < len && !/\s/.test(text[i]!)) i++
  }
  while (i < len && /\s/.test(text[i]!)) i++
  return i
}

/** Previous word start (`b`): from inside a word, its own start; from
 *  whitespace, the preceding word's start. */
export function vimWordBackward(text: string, cursor: number): number {
  let i = cursor
  while (i > 0 && /\s/.test(text[i - 1]!)) i--
  while (i > 0 && !/\s/.test(text[i - 1]!)) i--
  return i
}

/** End of the current word (`dw`): the whitespace boundary after `cursor`. */
export function vimWordEnd(text: string, cursor: number): number {
  const len = text.length
  let i = cursor
  while (i < len && !/\s/.test(text[i]!)) i++
  return i
}

// --- grapheme-cluster geometry ---------------------------------------------
// The caret, editing keys, and wrapping MUST agree on one text unit. Mixing
// UTF-16 code units (arrows/backspace), code points (wrap), and display
// cells (stringWidth) lets the caret land inside a surrogate pair or a ZWJ
// emoji — the inverted caret then shows half a glyph, Backspace deletes
// half a character, and `line.slice()` splits clusters. All offsets below
// are UTF-16 indices snapped to grapheme boundaries via the shared
// Intl.Segmenter (utils/intl.ts).

/** Ascending grapheme boundary offsets of `text` (starts at 0, ends at
 *  `text.length`). Empty text yields `[0]`. */
export function graphemeBoundaries(text: string): number[] {
  const bounds = [0]
  for (const { index, segment } of getGraphemeSegmenter().segment(text)) {
    const end = index + segment.length
    if (end > bounds[bounds.length - 1]!) bounds.push(end)
  }
  return bounds
}

/** Largest grapheme boundary `<= offset` (clamped into the text). Snaps a
 *  cursor that landed mid-cluster back onto a boundary. */
function boundaryAtOrBefore(bounds: number[], offset: number): number {
  let lo = 0
  let hi = bounds.length - 1
  let ans = bounds[0]!
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (bounds[mid]! <= offset) {
      ans = bounds[mid]!
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

/** Largest grapheme boundary strictly before `offset` (0 when none). */
export function previousGraphemeBoundary(bounds: number[], offset: number): number {
  let lo = 0
  let hi = bounds.length - 1
  let ans = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (bounds[mid]! < offset) {
      ans = bounds[mid]!
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

/** Smallest grapheme boundary strictly after `offset` (text.length when
 *  none). Returns `offset` unchanged when it already is the last boundary. */
export function nextGraphemeBoundary(bounds: number[], offset: number): number {
  let lo = 0
  let hi = bounds.length - 1
  let ans = bounds[hi] ?? 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (bounds[mid]! > offset) {
      ans = bounds[mid]!
      hi = mid - 1
    } else {
      lo = mid + 1
    }
  }
  return ans
}

/** Snap an arbitrary UTF-16 offset onto a grapheme boundary of `text`,
 *  clamping into range. The safety net under every cursor write. */
export function normalizeCursorOffset(text: string, offset: number): number {
  const clamped = Math.max(0, Math.min(offset, text.length))
  return boundaryAtOrBefore(graphemeBoundaries(text), clamped)
}
