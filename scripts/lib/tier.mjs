// Test-tier derivation: classify each registered verify script into the
// pyramid layers from dsh-tui-refactor-assessment.md §6 by scanning its
// source for three static features. Tiering new scripts is automatic —
// no registration needed beyond GROUPS itself.
//
//   t0  synchronous pure-function tests — no FakeStdout mount, no
//       term-test driver, no sleep() call. Inputs are constructed as
//       data and asserted directly; each entry runs in ~a second.
//   t1  render-mount assertions — FakeStdout is mounted and frames are
//       asserted, but there is no multi-step paced-key scenario.
//   t2  interaction scenarios — term-test driver (paced keys + settle
//       waits) or ≥6 sleep() calls; real-time pacing is by design.
//
// TIER_OVERRIDES patches the rare case where static features misjudge
// (e.g. a script that spawns a child process synchronously and is slower
// than the t0 budget). Overrides must name the entry, not the script.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export const TIERS = ['t0', 't1', 't2']

export const TIER_OVERRIDES = {
  // 'verify-example': 't1',
}

const cache = new Map()

// Feature patterns are pinned to *use sites*, not bare mentions: comments
// legitimately say "no FakeStdout", and string fixtures inside tests can
// quote any of these tokens. Matching usage forms keeps the scan simple
// without those false positives. The patterns are built by concatenation so
// this file's own source never contains the feature tokens verbatim —
// otherwise tier.mjs would classify as a mount itself and every importer
// would inherit that feature.
const RE_MOUNT = new RegExp('new Fake' + 'Stdout\\b')
const RE_DRIVER = new RegExp('(?:from\\s+|import\\(\\s*)[\'"][^\'"]*term-' + 'test')
const RE_SLEEP = new RegExp('\\bawait sl' + 'eep\\(', 'g')
// Local lib imports (static and dynamic) — mount/driver features are
// inherited through them: a scenario script that drives frames via a shared
// scene lib is still a driver/mount even though its own source only calls
// the lib. Only modules under scripts/lib/ are inherited; src/ modules are
// production code, not test scaffolding.
const RE_LIB_IMPORT = new RegExp('(?:from\\s+|import\\(\\s*)[\'"](\\.{1,2}(?:\\/[\\w.-]+)*\\/lib\\/[\\w.-]+\\.mjs)[\'"]', 'g')

function ownFeatures(src) {
  return {
    hasMount: RE_MOUNT.test(src),
    hasDriver: RE_DRIVER.test(src),
    sleeps: (src.match(RE_SLEEP) || []).length,
  }
}

function classify(scriptPath, seen = new Set()) {
  if (seen.has(scriptPath)) return { hasMount: false, hasDriver: false, sleeps: 0 }
  seen.add(scriptPath)
  let src = ''
  try { src = readFileSync(scriptPath, 'utf8') } catch { return null }
  const feats = ownFeatures(src)
  for (const m of src.matchAll(RE_LIB_IMPORT)) {
    const libPath = resolve(dirname(scriptPath), m[1])
    const libFeats = classify(libPath, seen)
    if (!libFeats) continue
    feats.hasMount ||= libFeats.hasMount
    feats.hasDriver ||= libFeats.hasDriver
  }
  return feats
}

function decide(feats) {
  if (!feats.hasMount && !feats.hasDriver && feats.sleeps === 0) return 't0'
  if (feats.hasDriver || feats.sleeps >= 6) return 't2'
  return 't1'
}

/** Derive the tier of a script file path. Unreadable files default to t1. */
export function deriveTier(scriptPath) {
  if (cache.has(scriptPath)) return cache.get(scriptPath)
  const feats = classify(scriptPath)
  const tier = feats ? decide(feats) : 't1'
  cache.set(scriptPath, tier)
  return tier
}

/** Derive the tier of a GROUPS entry: [name, argv, extraEnv?]. */
export function tierOf(entry) {
  const override = TIER_OVERRIDES[entry[0]]
  if (override) return override
  return deriveTier(entry[1][entry[1].length - 1])
}
