/**
 * The `⏵` self-narration line of an assistant reply (the dsh-working-activity
 * narrate contract emits one `⏵` line before each tool call in the reply).
 * The line renders as the step's title (grok-style fold-row headline), dim
 * and set apart from the body; the live working line ALSO surfaces the
 * first one while the turn streams. Extraction is per TEXT SEGMENT — a
 * multi-step reply carries several `⏵` lines and each binds to the tool
 * block that follows it (T38).
 */

export interface NarrationParts {
  /** The narration text without its `⏵ ` prefix, or undefined when the reply opens with no narration line. */
  narration?: string
  /** The reply without its leading narration line. */
  body: string
}

/** Split a reply into its leading `⏵` narration line and the body. */
export function extractNarration(text: string): NarrationParts {
  const newline = text.indexOf('\n')
  const firstLine = newline === -1 ? text : text.slice(0, newline)
  if (!firstLine.trimStart().startsWith('⏵')) return { body: text }
  const narration = firstLine.replace(/^\s*⏵\s*/, '').trim()
  const body = newline === -1 ? '' : text.slice(newline + 1).replace(/^\n+/, '')
  return { narration: narration === '' ? undefined : narration, body }
}

/** The reply without its leading `⏵` narration line (see extractNarration). */
export function stripNarration(text: string): string {
  return extractNarration(text).body
}
