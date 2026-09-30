/**
 * Number, token-count, and duration formatters shared by the status line
 * and message rows.
 *
 * All number output uses the `en` locale with at most one fraction digit.
 * Values at or above 1000 switch to compact notation (e.g. `1.5K`), which
 * callers receive lowercased as `1.5k` for a calmer status-line look.
 */

/** Build a formatter that emits either compact or standard notation. */
function buildNumberFormat(compact: boolean): Intl.NumberFormat {
  return new Intl.NumberFormat('en', {
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  })
}

/**
 * Format a number for display, switching to compact notation at 1000.
 * @param number - The value to format.
 * @returns The formatted number, lowercased (e.g. `1.2k`, `1.5m`).
 */
export function formatNumber(number: number): string {
  return buildNumberFormat(number >= 1000).format(number).toLowerCase()
}

/**
 * Format a token count for display.
 * Compact values that round to an even unit (e.g. `1.0k`) drop the
 * trailing zero so the status line reads `1k` instead of `1.0k`.
 * @param count - The token count to format.
 * @returns The formatted count (e.g. `988`, `3.4k`, `1k`).
 */
export function formatTokens(count: number): string {
  return formatNumber(count).replace('.0', '')
}

/**
 * Format a duration in milliseconds as a compact one-fact string:
 * `3.2s` under a minute (one fraction digit — short steps keep their
 * sub-second precision), `1m04s` under an hour, `1h02m` beyond. Minutes
 * carry no fraction. Negative durations are clamped to zero.
 * @param durationMs - Duration in milliseconds.
 * @returns The compact duration string.
 */
export function formatDuration(durationMs: number): string {
  const clamped = Math.max(0, durationMs)
  if (clamped < 60_000) return `${(Math.floor(clamped / 100) / 10).toFixed(1)}s`
  const minutes = Math.floor(clamped / 60_000)
  if (minutes < 60) return `${minutes}m${String(Math.floor((clamped % 60_000) / 1000)).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}
