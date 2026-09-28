#!/usr/bin/env node
/**
 * Keymap unit regression (T0, synchronous).
 *
 * Split out of verify-keymap.mjs: combo grammar, default matching, user
 * overrides, reserved sets, and settings drafts — all pure parsing over
 * utils/keymap with no mount. The live-Chat Alt+V paste proof stays in the
 * original script.
 *
 * Run: node scripts/verify-keymap-units.mjs
 */
import {
  actionMatches,
  draftComboConflicts,
  effectiveComboString,
  isFixedReserved,
  parseCombo,
  parseComboDraft,
  reservedActionCombos,
  resetKeymapOverrides,
  setKeymapOverrides,
} from '../lib/types/utils/keymap.js'

let failed = 0
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failed += 1
}

// ---- grammar --------------------------------------------------------------
check('parse: ctrl+shift+p', parseCombo('ctrl+shift+p')?.char === 'p')
check('parse: alt+v', parseCombo('alt+v')?.char === 'v')
check('parse: named key ctrl+return', parseCombo('ctrl+return')?.named === 'return')
check('parse: ctrl+space → char " "', parseCombo('ctrl+space')?.char === ' ')
check('parse: bare letter refused', parseCombo('p') === undefined)
check('parse: shift-only refused', parseCombo('shift+p') === undefined)
check('parse: unknown key name refused', parseCombo('ctrl+wat') === undefined)
check('parse: duplicated modifier refused', parseCombo('ctrl+ctrl+p') === undefined)
check('parse: escape combos refused', parseCombo('alt+escape') === undefined)

// ---- default matching -----------------------------------------------------
resetKeymapOverrides()
check('default paste matches ctrl+v', actionMatches('paste', 'v', { ctrl: true }))
check('default paste matches alt+v (meta)', actionMatches('paste', 'v', { meta: true }))
check('ctrl+shift+v does NOT match paste (native terminal paste)', !actionMatches('paste', 'v', { ctrl: true, shift: true }))
// editor moved off ctrl+g (alt+g keeps the mnemonic) — ctrl+g now opens
// the unified task center; see the editor entry comment in utils/keymap.ts.
check('default editor matches alt+g', actionMatches('editor', 'g', { meta: true }))
check('default trajectory matches ctrl+t', actionMatches('trajectory', 't', { ctrl: true }))
check('default history matches ctrl+r', actionMatches('history', 'r', { ctrl: true }))
check('default paste display string', effectiveComboString('paste') === 'ctrl+v, alt+v', effectiveComboString('paste'))

// ---- overrides ------------------------------------------------------------
// (ctrl+shift+insert is deliberately NOT valid grammar — "insert" is not a
// named key — and must be dropped so paste keeps its defaults.)
setKeymapOverrides({ paste: 'ctrl+shift+insert', editor: 'wat??', history: 'alt+r, ctrl+shift+r' })
check('invalid override entry falls back to default', actionMatches('editor', 'g', { meta: true }))
check('other invalid entry keeps paste default', actionMatches('paste', 'v', { ctrl: true }))
setKeymapOverrides({ paste: 'ctrl+shift+v', editor: 'wat??', history: 'alt+r, ctrl+shift+r' })
check('override moves the paste binding', actionMatches('paste', 'v', { ctrl: true, shift: true }))
check('override drops ctrl+v from paste', !actionMatches('paste', 'v', { ctrl: true }))
check('multi-combo override: alt+r', actionMatches('history', 'r', { meta: true }))
check('multi-combo override: ctrl+shift+r', actionMatches('history', 'r', { ctrl: true, shift: true }))
check('override reflected in display string', effectiveComboString('history') === 'alt+r, ctrl+shift+r', effectiveComboString('history'))

// ---- reserved sets --------------------------------------------------------
const reserved = reservedActionCombos()
check('remapped paste combo joins reserved set', reserved.has('ctrl+shift+v'))
check('remapped combo frees nothing stale', !reserved.has('ctrl+v'))
check('other actions keep their defaults reserved', reserved.has('ctrl+o') && reserved.has('ctrl+q'))
check('fixed: ctrl+u kill-line reserved', isFixedReserved('ctrl+u'))
check('fixed: ctrl+return reserved', isFixedReserved('ctrl+return'))
check('fixed: ctrl+w reserved', isFixedReserved('ctrl+w'))
check('fixed: ctrl+j newline fallback reserved', isFixedReserved('ctrl+j'))
check('free combo not reserved', !isFixedReserved('ctrl+n'))

// ---- settings drafts ------------------------------------------------------
// (Reset first: the override block above moved paste off ctrl+v, and the
// conflict checks below assume the DEFAULT bindings.)
resetKeymapOverrides()
check('draft: single combo', parseComboDraft('alt+b')?.combos.join(',') === 'alt+b')
check('draft: comma list', parseComboDraft('alt+b, ctrl+shift+b')?.combos.length === 2)
check('draft: blank restores default', parseComboDraft('  ')?.combos.length === 0)
check('draft: junk refused', parseComboDraft('press the b key') === undefined)
check('draft: escape combo refused', parseComboDraft('alt+escape') === undefined)
check('conflict: history → ctrl+v refused (owned by paste)', draftComboConflicts('history', ['ctrl+v']))
check('conflict: paste → ctrl+u refused (fixed kill-line)', draftComboConflicts('paste', ['ctrl+u']))
check('no conflict: history restating ctrl+r', !draftComboConflicts('history', ['ctrl+r']))
check('no conflict: fresh combo ctrl+n', !draftComboConflicts('history', ['ctrl+n']))
// Restating an action's OWN default (even one that is also fixed-reserved
// for the editor, like dashboard's ctrl+a / showAll's ctrl+e) changes
// nothing about what shadows what — it must not read as a conflict.
check('no conflict: dashboard restating its fixed-reserved default ctrl+a', !draftComboConflicts('dashboard', ['ctrl+a']))
check('no conflict: showAll restating its fixed-reserved default ctrl+e', !draftComboConflicts('showAll', ['ctrl+e']))
check('conflict: showAll claiming ctrl+a (dashboard owns it)', draftComboConflicts('showAll', ['ctrl+a']))
check('conflict: dashboard claiming ctrl+e (showAll owns it)', draftComboConflicts('dashboard', ['ctrl+e']))
check('conflict: another action cannot borrow the fixed ctrl+u', draftComboConflicts('dashboard', ['ctrl+u']))
resetKeymapOverrides()

if (failed > 0) {
  console.error(`keymap units: ${failed} check(s) failed`)
  process.exit(1)
}
console.log('keymap units passed (grammar, defaults, overrides, reserved sets, drafts)')
