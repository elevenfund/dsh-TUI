/**
 * Shared headless scene harness for the verify-selection-* batteries
 * (split out of verify-transcript-selection.tsx, which stays the reference
 * copy until the split lands).
 *
 * Owns what every battery duplicated: the isolated fake HOME, the headless
 * env knobs, the xterm-backed fake stdio trio, the mock channel fixture with
 * its recorder arrays, the mount boilerplate, the S0 smoke checks plus the
 * dim/rest fg-bg baselines, and the PASS/FAIL reporter. Each
 * verify-selection-*.tsx script imports this, replays only the key sequence
 * its feature owns, and keeps the original T-numbered assertions verbatim.
 *
 * Waits go through `scripts/lib/term-test.mjs` (`settled`) so the assertions
 * ride the same stdin→React→throttle→xterm pipeline as the original battery.
 */

// Same isolation trick as the original battery (issue #986): fake-home must
// load before any src import resolves DATA_DIR at module scope.
import './fake-home.mjs'

process.env.FORCE_COLOR = '3'
process.env.DSH_TUI_LANG = 'en'
process.env.SSH_CONNECTION = 'headless-test'
delete process.env.TMUX

const [
  { PassThrough, Writable },
  React,
  { Terminal: XTerm },
  { render, AlternateScreen },
  { Chat },
  { QuestionStore },
  termTest,
] = await Promise.all([
  import('node:stream'),
  import('react'),
  import('@xterm/headless'),
  import('../../src/ui.js'),
  import('../../src/screens/Chat.js'),
  import('../../src/dsh-adapter/questions.js'),
  import('./term-test.mjs'),
])

export const sleep = termTest.sleep
export const settled = termTest.settled
export const keySleep = termTest.keySleep

const COLS = 100
const ROWS = 40

/** Test hook: sees every write before the terminal parses it (T14/T24 answer
 *  the alt-screen probe here — a real terminal replies DECRPM itself). */
export class FakeStdout extends Writable {
  static onWrite = null
  columns = COLS
  rows = ROWS
  isTTY = true
  constructor(term) {
    super()
    this.term = term
  }
  _write(chunk, _e, cb) {
    const text = String(chunk)
    FakeStdout.onWrite?.(text)
    this.term.write(text, cb)
  }
}

class FakeStderr extends Writable {
  isTTY = true
  _write(_c, _e, cb) {
    cb()
  }
}
class FakeStdin extends PassThrough {
  isTTY = true
  isRaw = false
  setRawMode(next) {
    this.isRaw = next
    return this
  }
  setEncoding() {
    return this
  }
  ref() {
    return this
  }
  unref() {
    return this
  }
}

export const toolResult = Array.from({ length: 60 }, (_, i) => `result-line-${i}`).join('\n')
// Two multi-word columns: without the content-width override the table is
// 96 cells wide in a 94-cell column (COLS 100 − 6 inset) and the Text
// layout re-wraps it, breaking the box borders mid-row. Multi-word cells
// matter: wrap-ansi's wordWrap never folds an unbroken long word, which
// would push the table into the vertical fallback instead.
const tableCell = word => Array.from({ length: 8 }, () => word).join(' ')
const tableMarkdown = `| ${tableCell('a')} | ${tableCell('b')} |\n|---|---|\n| ${tableCell('c')} | ${tableCell('d')} |`
export const transcriptEvents = [
  { type: 'user/message', data: { id: 'm1', source: { kind: 'user' }, content: [{ type: 'text', text: 'count tsx files under src' }] } },
  { type: 'assistant/chunk', data: { chunk: { type: 'reasoning-delta', text: 'plan first' } } },
  { type: 'tool/call', data: { callId: 'c1', name: 'Bash', arguments: '{"command":"find src -name *.tsx | wc -l"}' } },
  { type: 'tool/result', data: { message: { source: { callId: 'c1' }, content: [{ type: 'text', text: '122' }] } } },
  { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Found **122** tsx files' }] } } },
]
const tableEvents = [
  { type: 'user/message', data: { id: 't1', source: { kind: 'user' }, content: [{ type: 'text', text: 'show the table' }] } },
  { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: tableMarkdown }] } } },
]

/** The base 4-row transcript every battery starts from (user / reasoning /
 *  folded tool / assistant). Callers needing the long scene append the 60
 *  filler rows + c2 tail row themselves so each file states its own scene. */
export function baseRows() {
  return [
    { id: 1, kind: 'user', text: 'user line alpha' },
    { id: 5, kind: 'reasoning', text: 'reasoning body marker xyz', durationMs: 800 },
    {
      id: 2,
      kind: 'tool',
      text: '',
      tool: {
        callId: 'c1',
        name: 'bash',
        argsText: '{"command":"seq 1 30"}',
        status: 'ok',
        resultText: toolResult,
        startedAt: Date.now() - 10_000,
        durationMs: 120,
      },
    },
    { id: 3, kind: 'assistant', text: 'assistant reply omega' },
  ]
}

/** 60 assistant filler rows + the c2 tail tool row pushed by the original
 *  battery's T7 — the "long transcript" scene shared by the scroll, overlay
 *  and interrupt batteries. */
export function longTailRows() {
  return [
    ...Array.from({ length: 60 }, (_, i) => ({ id: 10 + i, kind: 'assistant', text: `filler line ${i}` })),
    {
      id: 100,
      kind: 'tool',
      text: '',
      tool: {
        callId: 'c2',
        name: 'bash',
        argsText: '{"command":"tail-check"}',
        status: 'ok',
        resultText: 'tail-result-0',
        startedAt: Date.now() - 1000,
        durationMs: 30,
      },
    },
  ]
}

/** The image-bearing user row the original battery pushed at T24. */
export function imageTurnRow() {
  return {
    id: 300,
    kind: 'user',
    text: 'image turn line',
    images: [{
      id: 'img-shot',
      width: 800,
      height: 600,
      name: 'shot.png',
      async read() { return new Uint8Array() },
    }],
  }
}

/** The markdown assistant row the original battery pushed at T27. */
export function markdownTurnRow() {
  return {
    id: 310,
    kind: 'assistant',
    text: '**bm** prose\n\n```ts\nconst value = 1\n```\n',
  }
}

/**
 * Mount the Chat scene against a fresh xterm + fake stdio trio, run the S0
 * smoke checks and capture the dim-fg / default-bg / plain-fg baselines the
 * selection assertions compare against. Returns the scene handle.
 */
export async function bootSelectionScene(rows = baseRows()) {
  // Long scenes (> viewport) mount sticky-at-bottom, so the S0 smoke checks
  // the trailing rows instead of the 4-row head trio. dimFg/defaultBg/plainFg
  // baselines are still taken off whatever tool/assistant rows are visible.
  const longScene = rows.length > 30
  const term = new XTerm({ cols: COLS, rows: ROWS, scrollback: 100, allowProposedApi: true })
  const stdout = new FakeStdout(term)
  const stderr = new FakeStderr()
  const stdin = new FakeStdin()

  let failures = 0
  function check(name, ok, extra = '') {
    console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? `  (${extra})` : ''}`)
    if (!ok) failures++
  }
  function finish(label) {
    app.unmount()
    if (failures > 0) {
      console.error(`\n${label}: ${failures} check(s) FAILED`)
      process.exit(1)
    }
    console.log(`\n${label}: all checks passed`)
  }

  const buf = () => term.buffer.active
  const viewportLines = () => termTest.viewportLines(term)
  const screenHas = s => viewportLines().some(line => line.includes(s))
  const findText = s => {
    const lines = viewportLines()
    for (let row = 0; row < lines.length; row++) {
      const col = lines[row].indexOf(s)
      if (col >= 0) return { col, row }
    }
    return null
  }
  /** Stable string key for a cell's background (default, palette, or RGB). */
  const bgKey = (col, row) => JSON.stringify(buf().getLine(buf().baseY + row)?.getCell(col)?.getBgColor() ?? null)
  /** Stable string key for a cell's foreground color. */
  const fgKey = (col, row) => JSON.stringify(buf().getLine(buf().baseY + row)?.getCell(col)?.getFgColor() ?? null)

  const listeners = new Set()
  const followUpCalls = []
  const notifyCalls = []
  const killCalls = []
  const removeCalls = []
  const channel = {
    version: 0,
    rows,
    status: 'idle',
    sessionTitle: 'probe',
    agentId: 'probe',
    model: 'deepseek-v4-flash',
    mode: { plan: false },
    reasoningEffort: 'max',
    tokens: { input: 1, output: 1 },
    cwd: '/tmp/demo',
    displayCwd: '/tmp/demo',
    gitBranch: 'main',
    working: false,
    spinnerMode: 'requesting',
    responseChars: 0,
    activeToolCount: 0,
    turnStart: Date.now(),
    lastUserText: '',
    pending: [],
    commandList: [],
    notifications: [],
    whaleIdle: false,
    subscribe(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    submit() {},
    cancel: () => {},
    clear: () => {},
    // PromptInput calls this the moment a draft starts with '/'; returning
    // [] keeps the slash-command overlay closed (batteries that need it
    // patch a richer fake onto the channel).
    commandCompletions: () => [],
    notify(text) { notifyCalls.push(String(text)) },
    subagents: [],
    backgroundJobs: [],
    subagentModes: () => Promise.resolve({ 'sa-1': true, 'sa-2': false }),
    subagentTranscript: id => Promise.resolve(id === 'sa-1' || id === 'sa-7' ? transcriptEvents : id === 'sa-9' ? tableEvents : []),
    jobControl: {
      kill: id => { killCalls.push(id); return true },
    },
    subagentControl: {
      interrupt: () => true,
      followUp: async (id, text) => { followUpCalls.push([id, text]); return true },
      remove: id => { removeCalls.push(id); return 'removed' },
    },
    listModels: () => Promise.resolve([]),
    listSessions: () => [],
    setResumeTarget: () => {},
    loadOlder: () => {},
    mcpStatus: () => [],
  }
  const bump = () => {
    channel.version = (channel.version ?? 0) + 1
    for (const cb of listeners) cb()
  }

  const app = await render(
    React.createElement(AlternateScreen, null,
      React.createElement(Chat, { channel, questionStore: new QuestionStore(), onExit: () => {} })),
    { stdout, stdin, stderr, exitOnCtrlC: false, patchConsole: false },
  )

  // 初始 rows 需要 version 推送驱动一次采集渲染（Chat 以 version 为门控读快照）。
  bump()
  await sleep(600) // 固定窗:pacing 首帧挂载 + 输入监听挂接，无单一可观测锚点
  check(longScene ? 'S0 长场景挂载（尾部行渲染）' : 'S0 三行消息渲染',
    longScene
      ? screenHas('tail-check') && viewportLines().some(line => line.trim() !== '')
      : screenHas('user line alpha') && screenHas('Bash(') && screenHas('assistant reply omega'))

  // 未选中的折叠 tool 头取 fg 基线（rest 态 dim）。
  const bashPos0 = findText('Bash(')
  check('S0 tool 头可见', bashPos0 !== null)
  const dimFg = bashPos0 ? fgKey(bashPos0.col, bashPos0.row) : ''
  const defaultBg = bashPos0 ? bgKey(bashPos0.col, bashPos0.row) : ''
  // 未选中的 assistant 行首 ● 取 fg 基线（选中态点亮用）。
  const asstPos0 = findText('●')
  check('S0 assistant 行可见', asstPos0 !== null)
  const plainFg = asstPos0 ? fgKey(asstPos0.col, asstPos0.row) : ''

  const topOf = () => viewportLines().find(line => line.trim() !== '') ?? ''
  // 跳首行后 isSticky=false，屏顶会叠出 PinnedTurnHeader（同文本、无高亮），
  // 所以断言必须找"文本匹配且该行带选中背景"的那一行。
  const lineHighlighted = s => {
    const lines = viewportLines()
    for (let r = 0; r < lines.length; r++) {
      if (!lines[r].includes(s)) continue
      if (JSON.stringify(buf().getLine(buf().baseY + r)?.getCell(3)?.getBgColor() ?? null) !== defaultBg) return true
    }
    return false
  }

  return {
    app, term, stdout, stderr, stdin,
    channel, bump, listeners,
    followUpCalls, notifyCalls, killCalls, removeCalls,
    check, finish,
    // Deterministic drain anchor for selection-mode scripts: two successive
    // probes of the viewport must agree before continuing (replaces the
    // per-script fixed drain sleeps).
    drained: opts => termTest.drainedScreen(term, opts),
    buf, viewportLines, screenHas, findText, bgKey, fgKey, topOf, lineHighlighted,
    dimFg, defaultBg, plainFg,
  }
}
