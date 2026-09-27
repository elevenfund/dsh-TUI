/**
 * Small, shared glyphs used by the terminal UI. Keep this module limited to
 * symbols with active consumers so each visual mark has one clear meaning.
 */

/** Activity bullet: ring on macOS, solid dot elsewhere. */
export const BLACK_CIRCLE = process.platform === 'darwin' ? '⏺' : '●'

/** Prompt pointer, a bold right chevron (`❯`). */
export const POINTER = '\u276f' // ❯
/** Success checkmark (`✓`). */
export const TICK = '\u2713' // ✓
/** Settled tool-status dot (`•`). */
export const BULLET = '\u2022' // •
/** Failed tool status (`✗`). */
export const MULTIPLICATION_X = '\u2717' // ✗

/** Direction markers used by the token counter and navigation affordances. */
export const UP_ARROW = '\u2191' // ↑
export const DOWN_ARROW = '\u2193' // ↓

/** Settled marker shown after a reasoning block stops streaming. */
export const THINKING_SETTLED_MARKER = '\u25c6' // ◆ (grok-style step bullet)
/** Diamond bullet shared by tool cards and settled thinking rows. */
export const DIAMOND = '\u25c6' // ◆
