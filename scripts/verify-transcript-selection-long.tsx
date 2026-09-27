/**
 * verify-transcript-selection-long — 长会话选择模式 g/G 回归：真实 Chat +
 * 302 行消息（超出 MessageList 的 RENDERED_ROW_CAP=120，首行进入
 * recent-rows 折叠区），经 stdin 注入按键，断言：
 *
 *   1. 初始 sticky 底部，末行 tool 可见（长会话打开的真实姿态）
 *   2. Tab 进入选择模式即选中末行（高亮）
 *   3. G 跳末行正常（末行恒在最近窗口内，挂载着 —— 对照组）
 *   4. g 跳首行必须穿透折叠窗口：旧行为 seekRowIntoView 的 forceMount
 *      只在 visibleRows 内扩窗，被 RENDERED_ROW_CAP 切掉的首行永远挂
 *      不上，完成效应等不到 ref，按 g 无任何反应（长会话 g 失效 bug）
 *   5. gg 第二按幂等（仍首行仍高亮）
 *
 * 运行：node --import tsx/esm scripts/verify-transcript-selection-long.tsx
 */
export {} // 模块边界：避免顶层 await/全局名与其他 verify 脚本冲突

// 与 verify-transcript-selection 同因（issue #986）：DATA_DIR 在 import 时
// 解析，隔离的假 HOME 防止真 history.jsonl 干扰输入历史语义。
import './lib/fake-home.mjs'

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
  import('../src/ui.js'),
  import('../src/screens/Chat.js'),
  import('../src/dsh-adapter/questions.js'),
  import('./lib/term-test.mjs'),
])

const { sleep, settled } = termTest

let failures = 0
function check(name: string, ok: boolean, extra = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}

const COLS = 100
const ROWS = 40
const term = new XTerm({ cols: COLS, rows: ROWS, scrollback: 100, allowProposedApi: true })
class FakeStdout extends Writable {
  columns = COLS
  rows = ROWS
  isTTY = true
  override _write(chunk: unknown, _e: Buffer.Encoding, cb: () => void): void {
    term.write(String(chunk), cb)
  }
}
class FakeStderr extends Writable {
  isTTY = true
  override _write(_c: unknown, _e: Buffer.Encoding, cb: () => void): void {
    cb()
  }
}
class FakeStdin extends PassThrough {
  isTTY = true
  isRaw = false
  setRawMode(next: boolean): this {
    this.isRaw = next
    return this
  }
  override setEncoding(): this {
    return this
  }
  ref(): this {
    return this
  }
  unref(): this {
    return this
  }
}
const stdout = new FakeStdout()
const stderr = new FakeStderr()
const stdin = new FakeStdin()

const buf = () => term.buffer.active
const viewportLines = () => termTest.viewportLines(term)
const screenHas = (s: string): boolean => viewportLines().some(line => line.includes(s))
const findText = (s: string): { col: number; row: number } | null => {
  const lines = viewportLines()
  for (let row = 0; row < lines.length; row++) {
    const col = lines[row]!.indexOf(s)
    if (col >= 0) return { col, row }
  }
  return null
}
/** Stable string key for a cell's background (default, palette, or RGB). */
const bgKey = (col: number, row: number): string => JSON.stringify(buf().getLine(buf().baseY + row)?.getCell(col)?.getBgColor() ?? null)

const FIRST_TEXT = 'first row marker alpha'
const TAIL_TEXT = 'tail-check'
const listeners = new Set<() => void>()
// 302 rows: the first user row lands BEHIND the recent-rows fold
// (rows.length - RENDERED_ROW_CAP = 182 hidden), the tail tool row sits
// inside the always-mounted recent window — exactly a real long session.
const rows: Array<Record<string, unknown>> = [
  { id: 1, kind: 'user', text: FIRST_TEXT },
  ...Array.from({ length: 300 }, (_, i) => ({ id: 10 + i, kind: 'user', text: `bulk filler ${i}` })),
  {
    id: 500,
    kind: 'tool',
    text: '',
    tool: {
      callId: 'c1',
      name: 'bash',
      argsText: `{"command":"${TAIL_TEXT}"}`,
      status: 'ok',
      resultText: 'tail-result-0',
      startedAt: Date.now() - 1000,
      durationMs: 30,
    },
  },
]
const channel: Record<string, unknown> = {
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
  subscribe(cb: () => void) {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
  submit() {},
  cancel: () => {},
  clear: () => {},
  notify() {},
  listModels: () => Promise.resolve([]),
  listSessions: () => [],
  setResumeTarget: () => {},
  loadOlder: () => {},
  mcpStatus: () => [],
}

const bump = (): void => {
  channel.version = (channel.version as number) + 1
  for (const cb of listeners) cb()
}

const app = await render(
  <AlternateScreen>
    <Chat channel={channel as never} questionStore={new QuestionStore()} onExit={() => {}} />
  </AlternateScreen>,
  { stdout, stdin, stderr, exitOnCtrlC: false, patchConsole: false },
)

// 初始 rows 需要 version 推送驱动一次采集渲染（Chat 以 version 为门控读快照）。
bump()

try {
  await sleep(600) // 固定窗:pacing 首帧挂载 + 输入监听挂接，无单一可观测锚点
  // S0: sticky 底部姿态 + 折叠生效（首行在折叠区，屏上只有最近窗口的行）。
  check('S0 末行可见（sticky 底部）', await settled(() => screenHas(TAIL_TEXT)))
  check('S0 首行被折叠（首行文本不在屏上）', !screenHas(FIRST_TEXT))

  // 未选中行的背景基线。
  const tail0 = findText(TAIL_TEXT)
  check('S0b 末行 tool 头可见', tail0 !== null)
  const defaultBg = tail0 ? bgKey(tail0.col, tail0.row) : ''

  // L1: Tab 进入选择模式，选中末行 tool。
  stdin.write('\t')
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  const lineHighlighted = (s: string): boolean => {
    const lines = viewportLines()
    for (let r = 0; r < lines.length; r++) {
      if (!lines[r]!.includes(s)) continue
      if (JSON.stringify(buf().getLine(buf().baseY + r)?.getCell(3)?.getBgColor() ?? null) !== defaultBg) return true
    }
    return false
  }
  check('L1 Tab 进入即选中末行（高亮）', await settled(() => lineHighlighted(TAIL_TEXT)))

  // L2: G 跳末行 —— 对照组：末行恒在最近窗口内（挂载着），必须一直正常。
  stdin.write('G')
  check('L2 G 跳末行并高亮（对照组）', await settled(() => lineHighlighted(TAIL_TEXT)))

  // L3: g 跳首行 —— 核心：首行被 RENDERED_ROW_CAP 折叠在 visibleRows 之外，
  // forceMount 扩窗够不到，旧行为按 g 完全无反应。
  await sleep(300) // 固定窗:pacing 分开 data 事件：紧邻写入会被 useInput 合并成 "Gg"，g 分支不触发
  stdin.write('g')
  check(
    'L3 g 穿透折叠窗口跳首行（高亮滚入）',
    await settled(() => lineHighlighted(FIRST_TEXT)),
    `visible=${screenHas(FIRST_TEXT)}`,
  )
  // L4: gg 第二按幂等（仍首行仍高亮）。
  await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
  stdin.write('g')
  check('L4 gg 第二按幂等（仍首行仍高亮）', lineHighlighted(FIRST_TEXT))

} finally {
  app.unmount()
}

if (failures > 0) {
  console.error(`\nverify-transcript-selection-long: ${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nverify-transcript-selection-long: all checks passed')
