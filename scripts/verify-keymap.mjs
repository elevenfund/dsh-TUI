#!/usr/bin/env node
/**
 * Keymap regression (compiled lib): the shared combo grammar, the built-in
 * action registry behind /settings remapping, and the Alt+V paste alias.
 *
 * Pure checks (all platforms):
 * - parse: grammar accepts ctrl/alt combos + named keys, refuses bare
 *   letters, modifier-less shifts, unknown names, duplicate modifiers and
 *   escape combos
 * - match: defaults still bind (ctrl+v paste, ctrl+g editor…), the alt+v
 *   paste alias matches meta+v, ctrl+shift+v does NOT (native terminal
 *   paste must keep falling through), mac super alias for ctrl combos
 * - overrides: setKeymapOverrides remaps live and drops invalid entries
 *   (a cordis.yml typo must never disable a built-in)
 * - reserved: fixed editor combos stay reserved and the effective action
 *   combos (including remaps) join the set the plugin registry refuses
 * - drafts: parseComboDraft accepts multi-combo lists, rejects junk, and
 *   draftComboConflicts catches cross-action + fixed-reserved collisions
 *
 * Live Chat check (headless, real useInput path): pressing ESC v (Alt+V)
 * must trigger the clipboard paste branch — the 'v' must NOT be typed into
 * the prompt — and a remapped editor key (alt+g) must open the external
 * editor path rather than inserting 'g'.
 *
 * Run after build: `node scripts/verify-keymap.mjs`
 */
import { Writable, PassThrough } from 'node:stream'
import React from 'react'
import xtermHeadless from '@xterm/headless'
const { Terminal: XTerm } = xtermHeadless
import { render } from '../lib/types/ui.js'
import { Chat } from '../lib/types/screens/Chat.js'
import { setLang } from '../lib/types/i18n.js'
import {
  actionMatches,
  draftComboConflicts,
  effectiveComboString,
  effectiveCombos,
  isFixedReserved,
  parseCombo,
  parseComboDraft,
  reservedActionCombos,
  resetKeymapOverrides,
  setKeymapOverrides,
} from '../lib/types/utils/keymap.js'
import { settle, settled, sleep, viewportLines } from './lib/term-test.mjs'

let failed = 0
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failed += 1
}

// ---- units live in verify-keymap-units.mjs (T0, synchronous) ----
resetKeymapOverrides()

// ---- live Chat: Alt+V triggers the paste branch ---------------------------
// The host clipboard is whatever it happens to be, so the deterministic
// proof is indirect but airtight: with meta held, the typing branch can
// never insert a character (PromptInput excludes modified keys), so ANY
// prompt change or clipboard notification after the keypress can only come
// from the paste branch consuming it. $VISUAL/$EDITOR are cleared so the
// editor check resolves via the unavailable-notify path instead of
// spawning a real editor that would hold the output pipes open.
delete process.env.VISUAL
delete process.env.EDITOR
const term = new XTerm({ cols: 110, rows: 34, scrollback: 100, allowProposedApi: true })

function makeStreams() {
  const stdout = new Writable({ write(chunk, _enc, cb) { term.write(String(chunk), cb) } })
  stdout.columns = 110
  stdout.rows = 34
  stdout.isTTY = true
  const stderr = new Writable({ write(_c, _e, cb) { cb() } })
  stderr.isTTY = true
  const stdin = new PassThrough()
  stdin.isTTY = true
  stdin.setRawMode = () => stdin
  stdin.setEncoding = () => stdin
  stdin.ref = () => stdin
  stdin.unref = () => stdin
  return { stdout, stderr, stdin }
}

const listeners = new Set()
const notifications = []
const rows = []
const channel = {
  version: 0,
  rows,
  status: 'idle',
  sessionTitle: 'keymap',
  agentId: 'keymap',
  model: 'deepseek-v4-flash',
  provider: 'deepseek',
  tokens: { input: 0, output: 0 },
  cwd: '/tmp',
  displayCwd: '/tmp',
  gitBranch: 'main',
  working: false,
  spinnerMode: 'requesting',
  responseChars: 0,
  activeToolCount: 0,
  turnStart: 0,
  lastUserText: '',
  pending: [],
  notifications,
  contextWindow: undefined,
  reasoningEffort: 'high',
  activityEnabled: false,
  contextBarEnabled: true,
  statusBar: {},
  agentPreset: 'standard',
  goal: undefined,
  todos: [],
  mode: { id: 'default', plan: false, sandbox: 'workspace-write', approval: 'ask' },
  modeIndex: 0,
  cycleMode() {},
  commandList: [],
  commandCompletions: () => [],
  contextSegments: { system: 0, prompt: 0, assistant: 0, thinking: 0, tools: 0 },
  notify(text, options) { notifications.push({ text: String(text), options }) },
  pushLocal() {},
  subscribe(l) { listeners.add(l); return () => listeners.delete(l) },
  emit() { channel.version += 1; for (const l of listeners) l() },
  submit() {},
  steer() {},
  removePending: () => true,
  cancel() {},
  interruptAndDeliver: () => 0,
  clear() {},
  loadOlder: () => 0,
  listModels: async () => [],
  listFiles: async () => [],
  listSessions: async () => [],
  setResumeTarget() {},
  setActivityFrames: () => true,
  activityFrames: 'moon8',
  runExternalCommand: async () => '',
  mcpStatus: () => [],
  exportSession: () => null,
  initWorkspace: () => null,
  doctorInfo: () => [],
  listSubagents: async () => [],
  listPresets: async () => [],
  switchPreset: async () => false,
  switchModel: async () => false,
  rewindTo: async () => null,
  resumeTo: async () => ({ ok: false, reason: 'unavailable' }),
  newSession: async () => false,
  compact() {},
}

const { stdout, stderr, stdin } = makeStreams()
const instance = await render(
  React.createElement(Chat, {
    channel,
    questionStore: { subscribe: () => () => {}, getSnapshot: () => null, answerCurrent: () => {} },
    onExit() {},
  }),
  { stdout, stderr, stdin, exitOnCtrlC: false, patchConsole: false },
)
// 固定窗:pacing 启动首帧内容（含随机 tip）没有稳定的轮询锚点。
await sleep(700)
setLang('en')

const screen = () => viewportLines(term).join('\n')

const promptText = () => {
  // Anchored at line start: the input border rows and hint lines can carry
  // a mid-line '>', but only the prompt row carries the '❯' glyph.
  //
  // The row now begins with the ⌸ session-entry control, which sits BEFORE the
  // ❯ caret, so the anchor has to allow that leading cell or `^[❯]` never
  // matches and every draft reads as empty. The EMPTY prompt renders box-drawing
  // decoration on the same row and the row ends with the ⛶ expand-editor
  // affordance — strip those before comparing content, along with the ⌸ itself.
  const match = screen().match(/^\s*⌸?\s*[❯]\s*(.*)$/m)
  const raw = match === null ? '' : (match[1] ?? '')
  return raw.replace(/[╭╮╰╯─│═║⛶⌸]+/g, '').trim()
}
const clipboardNotice = () => notifications.some(n => /clipboard|剪贴板/i.test(String(n.text)))

// Baseline: a plain 'v' types normally.
stdin.write('v')
check('plain v types', await settled(() => promptText() === 'v'), JSON.stringify(promptText()))

// Ctrl+C clears the non-empty prompt (idle single press).
stdin.write('\x03')
check('ctrl+c clears the prompt', await settled(() => promptText() === ''), JSON.stringify(promptText()))

// Alt+V arrives as ESC v. Whatever the clipboard holds, the paste branch
// must consume the key: a prompt change or a clipboard notification are
// the only possible outcomes (typing 'v' with meta held is impossible).
const beforeAltV = promptText()
notifications.length = 0
stdin.write('\x1bv')
check(
  'alt+v reaches the clipboard paste branch',
  await settled(() => promptText() !== beforeAltV || clipboardNotice()),
  JSON.stringify({ before: beforeAltV, after: promptText(), notices: notifications.map(n => n.text) }),
)
check('alt+v does not type a bare v on an empty clipboard', clipboardNotice() || promptText() !== 'v')

// Ctrl+V (0x16) goes through the same branch.
stdin.write('\x03')
await settle(() => promptText() === '')
const beforeCtrlV = promptText()
notifications.length = 0
stdin.write('\x16')
check(
  'ctrl+v reaches the clipboard paste branch',
  await settled(() => promptText() !== beforeCtrlV || clipboardNotice()),
  JSON.stringify({ before: beforeCtrlV, after: promptText(), notices: notifications.map(n => n.text) }),
)

// Remap the editor action to alt+g and verify the external-editor branch
// takes the key: with $VISUAL/$EDITOR unset the outcome is the
// unavailable notification, and no 'g' is typed either way.
stdin.write('\x03')
await settle(() => promptText() === '')
setKeymapOverrides({ editor: 'alt+g' })
notifications.length = 0
stdin.write('\x1bg')
const editorNotice = await settled(() => notifications.some(n => /editor|编辑器/i.test(String(n.text))))
check('remapped alt+g editor key does not type g', promptText() !== 'g', JSON.stringify(promptText()))
check('remapped editor key reached the editor path (notify seen)', editorNotice, JSON.stringify(notifications.map(n => n.text)))
check('default ctrl+g no longer matches after remap', !actionMatches('editor', 'g', { ctrl: true }))
resetKeymapOverrides()

instance.unmount()
console.log(failed === 0 ? '\nall keymap checks passed' : `\n${failed} keymap check(s) failed`)
process.exit(failed === 0 ? 0 : 1)
