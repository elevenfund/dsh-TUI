/**
 * Terminal-free wait helpers for T0 unit scripts.
 *
 * tier.mjs derives t2 from, among other traits, importing term-test.mjs —
 * scripts that only need to poll an async store (a real cordis Context
 * initializing, a projection flushing) get dragged into t2 by that import
 * even though they mount nothing. Import settle/settled from here instead:
 * identical semantics, no terminal coupling, tier stays t0.
 *
 * Do NOT add FakeStdout/XTerm/render/sleep-based helpers to this file.
 */

const DEFAULT_TIMEOUT_MS = 8000

/** Awaitable micro-sleep; not a tier feature on its own (never a fixed drain window). */
const ms = wait => new Promise(resolve => setTimeout(resolve, wait))

/** Poll pred() every stepMs until true or timeout; resolves silently on timeout. */
export async function settle(pred, opts = {}) {
  const stepMs = opts.stepMs ?? 30
  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  while (Date.now() < deadline) {
    if (pred()) return
    await ms(stepMs)
  }
}

/** settle(), then return the final predicate value — wait and assert share one condition. */
export async function settled(pred, opts = {}) {
  await settle(pred, opts)
  return Boolean(pred())
}
