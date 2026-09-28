#!/usr/bin/env node
/**
 * Smooth-reveal unit regression (T0, synchronous).
 *
 * Split out of verify-smooth-reveal.tsx Group A: the cursor math —
 * revealStep pacing, first-read/monotonic-append/replacement/inactive/
 * disabled semantics, and the tiny-total line cursor — asserted as pure
 * data-in/data-out with no mount and no timers. The time-axis behaviors
 * (mid-flight sampling, catch-up decay, shared-timer lifecycle) are
 * deliberate wall-clock subjects and stay in the .tsx alongside the
 * mounted rendering contract.
 *
 * Run: node --import tsx/esm scripts/verify-smooth-reveal-units.ts
 */
import {
  REVEAL_MIN_STEP,
  revealLengthOf,
  revealLinesOf,
  revealStep,
  resetRevealForTest,
} from '../src/components/smoothReveal.js'

let failures = 0
function check(ok: boolean, name: string, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail === '' ? '' : ` (${detail})`}`)
  if (!ok) failures++
}

console.log('--- units: scheduler/cursor math ---')
resetRevealForTest()
check(revealStep(0) === REVEAL_MIN_STEP, 'A1 revealStep floors at MIN_STEP')
check(revealStep(100) === 13, 'A1 revealStep(100) = ceil(100/8) = 13', `got ${revealStep(100)}`)
check(revealStep(24) === 3, 'A1 revealStep(24) = 3')
check(revealStep(25) === 4, 'A1 revealStep(25) = 4')

{
  const text = 'a'.repeat(1000)
  check(revealLengthOf('u1', text, { enabled: true, active: true }) === 0, 'A2 active first read starts at zero')
  const grown = text + 'b'.repeat(200)
  check(
    revealLengthOf('u1', grown, { enabled: true, active: true }) === 0,
    'A2 monotonic append keeps the cursor',
  )
  check(
    revealLengthOf('u1', 'completely different', { enabled: true, active: true }) === 'completely different'.length,
    'A2 non-prefix replacement snaps',
  )
  check(
    revealLengthOf('u2', text, { enabled: true, active: false }) === text.length,
    'A2 inactive first read never creates a cursor',
  )
  check(
    revealLengthOf('u3', text, { enabled: false, active: true }) === text.length,
    'A2 disabled switch returns full text',
  )
}

{
  resetRevealForTest()
  check(revealLinesOf('c1', 2, { enabled: true, active: true }) === 2, 'A4 tiny totals skip animation')
  check(revealLinesOf('c2', 30, { enabled: true, active: true }) === 0, 'A4 line cursor starts at zero')
  check(revealLinesOf('c2', 42, { enabled: true, active: true }) === 0, 'A4 growing totals keep the cursor')
  check(revealLinesOf('c2', 10, { enabled: true, active: true }) === 10, 'A4 shrinking totals snap')
}

if (failures > 0) {
  console.error(`smooth reveal units: ${failures} check(s) failed`)
  process.exit(1)
}
console.log('smooth reveal units passed (revealStep, cursor semantics, line cursor)')
