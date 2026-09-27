import { stringWidth } from '../../ink/stringWidth.js'
import { getGraphemeSegmenter } from '../../utils/intl.js'
import { graphemeBoundaries, imageTokenAround, imageTokenSpans } from './text-motion.js'

/**
 * Pure wrap/click geometry for the prompt composer: grapheme word-wrap
 * (`wrapLineRows`), caret location in the wrapped layout, the click
 * inverse, and double-click word selection. Extracted verbatim from
 * PromptInput.tsx; every mapping shares the same row boundaries so
 * offsets stay 1:1 with the rendered rows.
 */

/**
 * Grapheme word-wrap for one logical line: break at the last space when
 * the row overflows; hard-wrap a word that cannot fit; never split a
 * cluster (ZWJ emoji, combining sequences, CJK wide cells stay whole).
 */
function wrapLineRows(
  line: string,
  width: number,
): Array<{ start: number; end: number }> {
  if (line === '') return [{ start: 0, end: 0 }]
  const rows: Array<{ start: number; end: number }> = []
  const segmenter = getGraphemeSegmenter()
  // The space inside `[Image #N]` is not a break opportunity: the token is
  // one unit on screen (its caret cluster and chip styling span it), so it
  // wraps whole, like a word.
  const unbreakable = imageTokenSpans(line)
  let rowStart = 0
  let currentWidth = 0
  let offset = 0
  let lastBreak = -1
  for (const { segment } of segmenter.segment(line)) {
    const w = stringWidth(segment)
    while (currentWidth + w > width && offset > rowStart) {
      if (lastBreak > rowStart) {
        rows.push({ start: rowStart, end: lastBreak })
        rowStart = lastBreak
        currentWidth = stringWidth(line.slice(rowStart, offset))
        lastBreak = -1
      } else {
        rows.push({ start: rowStart, end: offset })
        rowStart = offset
        currentWidth = 0
        lastBreak = -1
      }
    }
    currentWidth += w
    offset += segment.length
    if (segment === ' ' && imageTokenAround(unbreakable, offset) === undefined) lastBreak = offset
  }
  rows.push({ start: rowStart, end: offset })
  return rows
}

/** Wrap text to `width` columns via {@link wrapLineRows} (newlines honoured). */
export function wrapToWidth(text: string, width: number): string[] {
  return text.split('\n').flatMap(line =>
    wrapLineRows(line, width).map(r => line.slice(r.start, r.end)),
  )
}

/**
 * Locate `offset` in the wrapped layout of `text`. Uses the full wrap —
 * not a prefix — so a cursor inside a carried word maps to the displayed
 * row. At a wrap join the caret stays on the earlier row (after the space).
 */
export function caretInText(
  text: string,
  width: number,
  offset: number,
): { line: number; charCol: number; visualCol: number } {
  let line = 0
  let lineBase = 0
  let last = { line: 0, charCol: 0, visualCol: 0 }
  for (const logical of text.split('\n')) {
    for (const r of wrapLineRows(logical, width)) {
      const start = lineBase + r.start
      const charCol = Math.max(0, offset - start)
      last = {
        line,
        charCol,
        visualCol: stringWidth(logical.slice(r.start, r.start + charCol)),
      }
      if (offset <= lineBase + r.end) return last
      line++
    }
    lineBase += logical.length + 1
  }
  return last
}

/**
 * Inverse of {@link wrapToWidth}: map a click position (visual row index +
 * visual column) back to a UTF-16 offset in the original text. Uses the
 * same {@link wrapLineRows} row boundaries, so every visual row's start
 * offset is known exactly. Within the clicked row, the caret snaps to the
 * boundary nearest the click: a grapheme whose midpoint lies past the
 * click column takes the caret before it, otherwise after.
 */
export function clickToCursorOffset(
  text: string,
  width: number,
  visualLine: number,
  visualCol: number,
  snapWithin: 'nearest' | 'grapheme-start' = 'nearest',
): number {
  const segmenter = getGraphemeSegmenter()
  let row = 0
  let lineBase = 0
  for (const line of text.split('\n')) {
    for (const r of wrapLineRows(line, width)) {
      if (row === visualLine) {
        let currentWidth = 0
        let local = 0
        for (const { segment } of segmenter.segment(line.slice(r.start, r.end))) {
          const w = stringWidth(segment)
          // Caret positioning uses the nearest edge. Double-click selection
          // instead needs the grapheme UNDER the cell: on the second cell of a
          // CJK/emoji glyph, nearest-edge would point after the glyph (and the
          // final glyph would select nothing).
          if (snapWithin === 'grapheme-start' && currentWidth + w > visualCol) {
            return lineBase + r.start + local
          }
          if (currentWidth + w / 2 > visualCol) return lineBase + r.start + local
          if (currentWidth + w > visualCol) return lineBase + r.start + local + segment.length
          currentWidth += w
          local += segment.length
        }
        return lineBase + r.end
      }
      row++
    }
    lineBase += line.length + 1
  }
  return lineBase
}

/**
 * Offset range [start, end) of every visual row, using the same {@link
 * wrapLineRows} boundaries as `wrapToWidth`. The selection highlight
 * intersects each row with these ranges so offsets map 1:1 onto the
 * rendered row strings.
 */
export function visualLineRanges(text: string, width: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let lineBase = 0
  for (const line of text.split('\n')) {
    for (const r of wrapLineRows(line, width)) ranges.push([lineBase + r.start, lineBase + r.end])
    lineBase += line.length + 1
  }
  return ranges
}

/** Word characters for double-click selection: letters (any script),
 *  digits and the punctuation set terminal emulators treat as word-part by
 *  default (`/usr/bin/bash` selects whole — iTerm2 defaults). */
const WORD_CHAR = /[\p{L}\p{N}_/.\-+~\\]/u

/** Character class for double-click word expansion: whitespace, word
 *  char, everything else (punctuation/symbols). A same-class grapheme
 *  run is one word. */
function selectionCharClass(c: string): 0 | 1 | 2 {
  if (c === '' || /\s/.test(c)) return 0
  if (WORD_CHAR.test(c)) return 1
  return 2
}

/**
 * Word selection around `offset` within [lo, hi): expand left/right over
 * grapheme clusters of the same class as the clicked one (terminal
 * double-click semantics — punctuation runs select as one). Returns null
 * when the offset sits at the range's end (nothing to select).
 */
export function wordSelectionAt(
  text: string,
  offset: number,
  lo: number,
  hi: number,
): { start: number; end: number } | null {
  if (offset < lo || offset >= hi) return null
  const bounds = graphemeBoundaries(text.slice(lo, hi)).map(b => b + lo)
  let i = 0
  while (i < bounds.length - 1 && bounds[i + 1]! <= offset) i++
  const clusterAt = (index: number): string => text.slice(bounds[index]!, bounds[index + 1]!)
  const cls = selectionCharClass(clusterAt(i))
  let a = i
  while (a > 0 && selectionCharClass(clusterAt(a - 1)) === cls) a--
  let b = i
  while (b < bounds.length - 2 && selectionCharClass(clusterAt(b + 1)) === cls) b++
  return { start: bounds[a]!, end: bounds[b + 1]! }
}
