/**
 * verify-transcript-selection — 消息选择模式回归（grok 式 Tab 轮换 + 光标
 * 种子时序）：真实 Chat + 三行可选消息（user / tool / assistant），经 stdin
 * 注入按键，断言：
 *
 *   1. 空闲 Tab 进入选择模式（PromptInput 挂起：打字不落地）
 *   2. 进入即选中最后一个可选行（enterSelection 直接从 channel.rows 种子，
 *      不再读 selectionActive 门控的空列表——旧 bug：selectedId 卡 null，
 *      ↑/↓ 全部 no-op）
 *   3. ↑/↓ 移动选中高亮（背景色在行间转移）
 *   4. Enter 展开选中的折叠 tool 行
 *   5. 折叠 tool 头默认 dim、选中点亮（fg 变化）
 *   6. Tab / Esc 退出后打字恢复
 *
 * 运行：node --import tsx/esm scripts/verify-transcript-selection.tsx
 */
export {} // 模块边界：避免顶层 await/全局名与其他 verify 脚本冲突

// 与 verify-input-selection 同因（issue #986）：DATA_DIR 在 import 时解析，
// 隔离的假 HOME 防止真 history.jsonl 干扰 ↑ 的输入历史语义。
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
  override _write(chunk: unknown, _e: BufferEncoding, cb: () => void): void {
    term.write(String(chunk), cb)
  }
}
class FakeStderr extends Writable {
  isTTY = true
  override _write(_c: unknown, _e: BufferEncoding, cb: () => void): void {
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
/** Stable string key for a cell's foreground color. */
const fgKey = (col: number, row: number): string => JSON.stringify(buf().getLine(buf().baseY + row)?.getCell(col)?.getFgColor() ?? null)

const toolResult = Array.from({ length: 30 }, (_, i) => `result-line-${i}`).join('\n')
const listeners = new Set<() => void>()
const channel: Record<string, unknown> = {
  version: 0,
  rows: [
    { id: 1, kind: 'user', text: 'user line alpha' },
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
  ],
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
  await sleep(600) // 固定窗:Chat 首帧挂载 + 输入监听挂接，无单一可观测锚点
  if (process.env.VTS_DUMP) console.error(viewportLines().map((l, i) => `${String(i).padStart(2)}|${l}`).join('\n'))
  check('S0 三行消息渲染', screenHas('user line alpha') && screenHas('Bash(') && screenHas('assistant reply omega'))

  // 未选中的折叠 tool 头取 fg 基线（rest 态 dim）。
  const bashPos0 = findText('Bash(')
  check('S0 tool 头可见', bashPos0 !== null)
  const dimFg = bashPos0 ? fgKey(bashPos0.col, bashPos0.row) : ''
  const defaultBg = bashPos0 ? bgKey(bashPos0.col, bashPos0.row) : ''

  // T1: 空闲 Tab 进入选择模式；PromptInput 挂起，打字不落地。
  stdin.write('\t')
  await sleep(250)
  stdin.write('zz')
  await sleep(250)
  check('T1 Tab 进入后打字失效', !screenHas('zz'))

  // T2: 进入即选中最后一个可选行（assistant）——背景出现在该行。
  const asst = findText('assistant reply omega')
  check('T2 进入即选中末行（背景高亮）', asst !== null && bgKey(asst.col, asst.row) !== defaultBg)

  // T3: ↑ 两次 → tool 行高亮 → user 行高亮（背景转移，光标会移动）。
  stdin.write('\x1b[A')
  await sleep(250)
  const bash1 = findText('Bash(')
  check('T3a ↑ 后 tool 行高亮', bash1 !== null && bgKey(bash1.col, bash1.row) !== defaultBg)
  stdin.write('\x1b[A')
  await sleep(250)
  const user1 = findText('user line alpha')
  const bash2 = findText('Bash(')
  check(
    'T3b ↑↑ 后 user 行高亮、tool 行释放',
    user1 !== null && bash2 !== null && bgKey(user1.col, user1.row) !== defaultBg && bgKey(bash2.col, bash2.row) === defaultBg,
  )
  // T4: ↓ 回到 tool 行，Enter 展开折叠正文。
  stdin.write('\x1b[B')
  await sleep(250)
  // T3c: 选中点亮的 tool 头 fg 与 rest 态不同（dim → lit）。
  const bash3 = findText('Bash(')
  check('T3c 选中后 tool 头点亮（fg 变化）', bash3 !== null && fgKey(bash3.col, bash3.row) !== dimFg)
  stdin.write('\r')
  check('T4 Enter 展开折叠 tool 正文', await settled(() => screenHas('result-line-0') && screenHas('result-line-29')))

  // T5: Tab 退出选择模式，打字恢复。
  stdin.write('\t')
  await sleep(250)
  stdin.write('zz')
  check('T5 Tab 退出后打字恢复', await settled(() => screenHas('zz')))

  // T6: 再进一次，Esc 也能退出并恢复打字。
  stdin.write('\t')
  await sleep(250)
  stdin.write('\x1b')
  await sleep(250)
  stdin.write('qq')
  check('T6 Esc 退出后打字恢复', await settled(() => screenHas('qq')))
} finally {
  app.unmount()
}

if (failures > 0) {
  console.error(`\nverify-transcript-selection: ${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nverify-transcript-selection: all checks passed')
