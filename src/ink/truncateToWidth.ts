import { stringWidth } from './stringWidth.js'

/**
 * Slice a string to at most `maxWidth` terminal cells, walking by code
 * point so CJK wide characters never split mid-glyph. Assumes no ANSI in
 * the input (callers pass plain text).
 */
export function truncateToWidth(text: string, maxWidth: number): string {
  let width = 0
  let out = ''
  for (const char of text) {
    const charWidth = stringWidth(char)
    if (width + charWidth > maxWidth) break
    width += charWidth
    out += char
  }
  return out
}

/**
 * Clip plain text to at most `maxWidth` terminal cells, appending an
 * ellipsis when content was dropped (the ellipsis reserves one cell).
 * Walks by code point so CJK wide characters never split mid-glyph.
 * `emptyWhenTooNarrow` keeps the two historical degenerate shapes: a panel
 * line budget yields its whole row ('') at a floor width, a title budget
 * still shows the ellipsis ('…').
 */
export function clipToWidth(
  text: string,
  maxWidth: number,
  options: { emptyWhenTooNarrow?: boolean } = {},
): string {
  if (maxWidth <= 1) return options.emptyWhenTooNarrow === true ? '' : '…'
  if (stringWidth(text) <= maxWidth) return text
  let used = 0
  let out = ''
  for (const char of text) {
    const charWidth = stringWidth(char)
    if (used + charWidth > maxWidth - 1) break
    used += charWidth
    out += char
  }
  return `${out}…`
}

/** The panel-line flavour: a floor-width budget yields its whole row. */
export const clipLineToWidth = (text: string, maxWidth: number): string =>
  clipToWidth(text, maxWidth, { emptyWhenTooNarrow: true })
