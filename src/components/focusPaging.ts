import type { Key } from '../ink/events/input-event.js'

/** The g/G + PgUp/PgDn focus rule the list panels share (jobs panel, task
 * center): `g`/`G` jump the focus to the first/last row, PgUp/PgDn move it
 * by half a viewport. Pure decision only — callers apply the move to their
 * own focus index and ScrollBox ref, so the rule lives in exactly one place
 * while each panel keeps its state. */
export type FocusJumpOrPage =
  | { readonly kind: 'jump'; readonly index: number; readonly scrollTo: number }
  | { readonly kind: 'page'; readonly by: number }

export function focusJumpOrPage(
  input: string,
  key: Key,
  count: number,
  viewportHeight: number | undefined,
): FocusJumpOrPage | undefined {
  const unmodified = !key.ctrl && !key.meta && !key.super
  if (unmodified && input === 'g') {
    return { kind: 'jump', index: 0, scrollTo: 0 }
  }
  if (unmodified && input === 'G') {
    return { kind: 'jump', index: count - 1, scrollTo: Number.MAX_SAFE_INTEGER }
  }
  if (key.pageUp || key.pageDown) {
    const page = Math.max(1, Math.floor((viewportHeight ?? 12) / 2))
    return { kind: 'page', by: key.pageDown ? page : -page }
  }
  return undefined
}
