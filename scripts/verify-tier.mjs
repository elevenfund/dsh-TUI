#!/usr/bin/env node
/**
 * T0 unit tests for the tier derivation in scripts/lib/tier.mjs.
 * This file must itself stay t0-classifiable: free of mount constructors,
 * driver imports, and timed waits. Synthetic fixtures below are therefore
 * string-split so their feature tokens never appear contiguously here.
 */
import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deriveTier, tierOf, TIERS, TIER_OVERRIDES } from './lib/tier.mjs'

let failures = 0
const check = (name, ok, detail) => {
  if (ok) console.log('PASS: ' + name)
  else { failures += 1; console.log('FAIL: ' + name + (detail ? '  (' + detail + ')' : '')) }
}

// ---- real anchor scripts: the pyramid's known exemplars ----
check('anchor: verify-chat-split (sync pure dispatch) is t0',
  deriveTier('scripts/verify-chat-split.ts') === 't0')
check('anchor: verify-selection-scroll (paced key scenario) is t2',
  deriveTier('scripts/verify-selection-scroll.tsx') === 't2')
check('anchor: verify-agent-view (mount, no driver) is t1',
  deriveTier('scripts/verify-agent-view.mjs') === 't1')

// ---- synthetic sources pin the classify rules (string-split fixtures) ----
const dir = mkdtempSync(join(tmpdir(), 'dsh-tui-tier-'))
const synth = (name, body) => { const p = join(dir, name); writeFileSync(p, body); return p }
const MOUNT_LINE = 'const out = new Fake' + 'Stdout(); render(<X/>, out); assert.ok(out.frames)\n'
const DRIVER_LINE = "import { settled } from '../li" + "b/term-test.mjs'\nawait settled(() => true)\n"
const WAIT_LINE = 'await sl' + 'eep(50)\n'
try {
  const pure = synth('pure.mjs', "import { strict as assert } from 'node:assert'\nassert.ok(1)\n")
  check('rule: no mount, no driver, no wait => t0', deriveTier(pure) === 't0')

  const mount = synth('mount.mjs', MOUNT_LINE)
  check('rule: mount only => t1', deriveTier(mount) === 't1')

  const driver = synth('driver.mjs', DRIVER_LINE)
  check('rule: driver import => t2', deriveTier(driver) === 't2')

  const sleepy = synth('sleepy.mjs', WAIT_LINE.repeat(6))
  check('rule: six timed waits without driver => t2', deriveTier(sleepy) === 't2')

  const fewSleep = synth('few-sleep.mjs', WAIT_LINE.repeat(2))
  check('rule: few waits, no mount => t1 (not t0)', deriveTier(fewSleep) === 't1')

  // bare mention (a comment) must not count as a use site
  const mention = synth('mention.mjs', "// has no FakeStdout, no lib/term-test import, no sleep() here\nassert.ok(1)\n")
  check('rule: token mentioned in a comment stays t0', deriveTier(mention) === 't0')

  // features are inherited through scripts/lib imports: a scenario script
  // driving frames via a shared scene lib is still mount/driver
  const libDir = join(dir, 'lib')
  mkdirSync(libDir, { recursive: true })
  writeFileSync(join(libDir, 'scene.mjs'), 'export const mount = () => new Fake' + 'Stdout()\n')
  const viaLib = synth('via-lib.mjs', "import { mount } from './li" + "b/scene.mjs'\nconst t = mount(); assert.ok(t)\n")
  check('rule: mount inherited through a shared lib import', deriveTier(viaLib) === 't1')

  check('rule: missing file falls back to t1', deriveTier(join(dir, 'nope.mjs')) === 't1')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// ---- entry form: [name, argv, env?] with override precedence ----
const entry = ['verify-chat-split', ['node', '--import', 'tsx/esm', 'scripts/verify-chat-split.ts']]
check('tierOf: derives from last argv element', tierOf(entry) === 't0')
TIER_OVERRIDES['verify-chat-split'] = 't2'
try {
  check('tierOf: TIER_OVERRIDES wins over source scan', tierOf(entry) === 't2')
} finally {
  delete TIER_OVERRIDES['verify-chat-split']
}

// ---- contract: the tier order used by --cascade ----
check('contract: TIERS is exactly [t0, t1, t2]', JSON.stringify(TIERS) === '["t0","t1","t2"]')

// self-check: this file must classify as t0 or the pyramid loses its own
// first entry — keep it free of mounts, drivers, and sleeps.
check('self: verify-tier itself classifies as t0', deriveTier('scripts/verify-tier.mjs') === 't0')

if (failures > 0) { console.error('verify-tier: ' + failures + ' failure(s)'); process.exit(1) }
console.log('verify-tier: all checks passed')
