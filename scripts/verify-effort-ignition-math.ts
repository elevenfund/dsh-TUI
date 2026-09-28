#!/usr/bin/env node
/**
 * Effort ignition math-layer regression (T0, synchronous).
 *
 * Split out of verify-effort-ignition.tsx so the pure layer — waveform
 * sampling, easings, the per-column colour contract, boundary guards —
 * runs as data-in/data-out assertions with no mount, no terminal, no
 * sleeps. The mount-driven three-act visual contract stays in the .tsx.
 *
 * Run: node scripts/verify-effort-ignition-math.mjs
 */
const math = await import('../src/trajectory/effortIgnition.js')

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail === '' ? '' : ` (${detail})`}`)
  if (!ok) failures++
}

check('crest: 1 at the crest, 0 at one half-width out', math.crest(0) === 1 && math.crest(1) === 0)
check('crest: beyond the half-width is silent, both directions',
  math.crest(1.5) === 0 && math.crest(-1) === 0 && math.crest(-2) === 0)
check('easings: endpoints are exact',
  math.easeOutCubic(0) === 0 && math.easeOutCubic(1) === 1
  && math.easeInOutCubic(0) === 0 && math.easeInOutCubic(1) === 1)
check('easings: clamped outside [0,1]',
  math.easeOutCubic(2) === 1 && math.easeInOutCubic(-3) === 0)
check('line colors: exactly one entry per column',
  math.ignitionLineColors({ elapsedMs: 300, width: 40, onLight: false }).length === 40)
check('line colors: empty before start and after the end',
  math.ignitionLineColors({ elapsedMs: 0, width: 40, onLight: false }).length === 0
  && math.ignitionLineColors({ elapsedMs: math.SWEEP_TOTAL_MS + 1, width: 40, onLight: false }).length === 0)
check('line colors: boundary guards (width 0, negative/NaN/at-total elapsed)',
  math.ignitionLineColors({ elapsedMs: 300, width: 0, onLight: false }).length === 0
  && math.ignitionLineColors({ elapsedMs: -5, width: 40, onLight: false }).length === 0
  && math.ignitionLineColors({ elapsedMs: Number.NaN, width: 40, onLight: false }).length === 0
  && math.ignitionLineColors({ elapsedMs: math.SWEEP_TOTAL_MS, width: 40, onLight: false }).length === 0)
check('line colors: single-column terminal yields one entry',
  math.ignitionLineColors({ elapsedMs: 300, width: 1, onLight: false }).length === 1)
check('line colors: every painted entry is a truecolor rgb() string',
  math
    .ignitionLineColors({ elapsedMs: 200, width: 60, onLight: false })
    .every(color => color === undefined || /^rgb\(\d+,\d+,\d+\)$/.test(String(color))))
check('line colors: some columns are painted mid-wave',
  math
    .ignitionLineColors({ elapsedMs: 300, width: 80, onLight: false })
    .some(color => color !== undefined))

if (failures > 0) {
  console.error(`effort ignition math: ${failures} check(s) failed`)
  process.exit(1)
}
console.log('effort ignition math passed (crest, easings, line colors, boundary guards)')
