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
  /** Test hook: sees every write before the terminal parses it (T14 answers
   *  the alt-screen probe here — a real terminal replies DECRPM itself). */
  static onWrite: ((chunk: string) => void) | null = null
  override _write(chunk: unknown, _e: BufferEncoding, cb: () => void): void {
    const text = String(chunk)
    FakeStdout.onWrite?.(text)
    term.write(text, cb)
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

const toolResult = Array.from({ length: 60 }, (_, i) => `result-line-${i}`).join('\n')
const listeners = new Set<() => void>()
const channel: Record<string, unknown> = {
  version: 0,
  rows: [
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
  check('S0 三行消息渲染', screenHas('user line alpha') && screenHas('Bash(') && screenHas('assistant reply omega'))

  // 未选中的折叠 tool 头取 fg 基线（rest 态 dim）。
  const bashPos0 = findText('Bash(')
  check('S0 tool 头可见', bashPos0 !== null)
  const dimFg = bashPos0 ? fgKey(bashPos0.col, bashPos0.row) : ''
  const defaultBg = bashPos0 ? bgKey(bashPos0.col, bashPos0.row) : ''
  // 未选中的 assistant 行首 ● 取 fg 基线（选中态点亮用）。
  const asstPos0 = findText('●')
  check('S0 assistant 行可见', asstPos0 !== null)
  const plainFg = asstPos0 ? fgKey(asstPos0.col, asstPos0.row) : ''

  // T1: 空闲 Tab 进入选择模式；PromptInput 挂起，打字不落地。
  stdin.write('\t')
  await sleep(250)
  stdin.write('zz')
  await sleep(250)
  check('T1 Tab 进入后打字失效', !screenHas('zz'))

  // T2: 进入即选中最后一个可选行——assistant 正文也可达（导航要能到最
  // 底部的输出）；视觉是 ● 点亮，不刷整行蓝底。
  const asstA = findText('●')
  const bashA = findText('Bash(')
  check(
    'T2 进入即选中末行 assistant 行（● 点亮、无整行背景）',
    asstA !== null && fgKey(asstA.col, asstA.row) !== plainFg && bgKey(asstA.col, asstA.row) === defaultBg,
  )
  check('T2b tool 行保持无高亮', bashA !== null && bgKey(bashA.col, bashA.row) === defaultBg)

  // T3: ↑ 一次到 tool 行、再 ↑ 到 reasoning 行。
  stdin.write('\x1b[A')
  await sleep(250)
  const bash1 = findText('Bash(')
  check(
    'T3a ↑ 后 tool 行高亮且点亮（bg+fg）',
    bash1 !== null && bgKey(bash1.col, bash1.row) !== defaultBg && fgKey(bash1.col, bash1.row) !== dimFg,
  )
  stdin.write('\x1b[A')
  await sleep(250)
  const thought1 = findText('Thought')
  const bash2 = findText('Bash(')
  check(
    'T3a2 ↑↑ 后 reasoning 行高亮、tool 行释放',
    thought1 !== null && bash2 !== null && bgKey(thought1.col, thought1.row) !== defaultBg && bgKey(bash2.col, bash2.row) === defaultBg,
  )
  // T4: ↓ 回到 tool 行，l 展开折叠正文。
  stdin.write('\x1b[B')
  await sleep(250)
  stdin.write('l')
  // 60 行正文 > 40 行视口：展开后视口必须 pin 在被展开行的顶部——首行
  // 可见、末行被推出视口（pin 末行方向的回归即在此暴露）。
  // （Enter 已改为 grok 的 "Enter details" 浮窗，展开折叠归 l/h——T13。）
  check(
    'T4 l 展开后视口 pin 首行',
    await settled(() => screenHas('result-line-0') && !screenHas('result-line-59')),
    `line0=${screenHas('result-line-0')} line59=${screenHas('result-line-59')}`,
  )

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

  // T9: 选择模式里 Ctrl+O 随时生效并覆盖单行展开状态。断言用 reasoning
  // 行的 verbose 差异（展开=全文可见；收起=单行 Thought，正文不可见）。
  for (let i = 0; i < 8; i++) stdin.write('\x1b[5~')
  await sleep(300)
  stdin.write('\t')
  await sleep(300)
  check('T9-pre 选择模式已激活', await settled(() => screenHas('esc to return to input')))
  // 进入选择模式的光标现在落在末行 assistant（nearest 底对齐，页面回底）；
  // 先 g 跳回顶部，reasoning/tool 回到屏内，Ctrl+O 的展开才可见。
  stdin.write('g')
  await sleep(400)
  stdin.write('\x0f') // Ctrl+O → transcript mode on
  await sleep(600)
  check(
    'T9a 选择模式里 Ctrl+O 全局展开（reasoning 全文可见）',
    await settled(() => screenHas('reasoning body marker xyz')),
  )
  stdin.write('\x0f') // Ctrl+O → off，单行 expandedRows 一并清除
  await sleep(600)
  check(
    'T9b Ctrl+O 收起覆盖单行展开（reasoning 回折叠）',
    await settled(() => !screenHas('reasoning body marker xyz') && !screenHas('result-line-59')),
  )
  stdin.write('\x1b')
  await sleep(250)

  // T10: vim l/h 定向折叠——l 只展开（并 pin 行首），h 只收起，幂等。
  stdin.write('\t')
  await sleep(300)
  check('T10-pre 选择模式已激活', await settled(() => screenHas('esc to return to input')))
  stdin.write('g')
  await sleep(250)
  const user10 = findText('user line alpha')
  check('T10a g 跳首行并高亮', user10 !== null && bgKey(user10.col, user10.row) !== defaultBg)
  stdin.write('j')
  await sleep(200)
  stdin.write('j')
  await sleep(250)
  const bash10 = findText('Bash(')
  check('T10b j j 选中 tool 行', bash10 !== null && bgKey(bash10.col, bash10.row) !== defaultBg)
  stdin.write('l')
  await sleep(400)
  check(
    'T10c l 展开并 pin 首行',
    await settled(() => screenHas('result-line-0') && !screenHas('result-line-59')),
  )
  stdin.write('h')
  await sleep(400)
  check('T10d h 收起', await settled(() => !screenHas('result-line-0') && !screenHas('result-line-59')))
  stdin.write('h') // 已收起：幂等无操作
  await sleep(250)
  const bash10b = findText('Bash(')
  check('T10e h 幂等（仍收起、仍选中）', bash10b !== null && bgKey(bash10b.col, bash10b.row) !== defaultBg)

  // T12: nearest 光标滚动——视口内移动只动光标、页面纹丝不动（旧
  // top-align 行为会把光标行钉到屏幕顶，页面每次跳变）。
  const topOf = (): string => viewportLines().find(line => line.trim() !== '') ?? ''
  const before12 = topOf()
  stdin.write('k') // reasoning 行在屏内：光标上移，页面不动
  await sleep(300)
  const thought12 = findText('Thought')
  check(
    'T12a 视口内 k 光标上移、页面不动',
    thought12 !== null && bgKey(thought12.col, thought12.row) !== defaultBg && topOf() === before12,
  )
  stdin.write('j') // 回 tool 行，同样在屏内
  await sleep(300)
  const bash12 = findText('Bash(')
  check(
    'T12b 视口内 j 光标下移、页面不动',
    bash12 !== null && bgKey(bash12.col, bash12.row) !== defaultBg && topOf() === before12,
  )
  stdin.write('\x1b')
  await sleep(250)



  // T7: 滚动跟随——追加大量行后，Tab 进入选择模式会 findLast 末行并
  // seekRow 滚入；随后一路 ↑ 到顶，顶行也要滚入视口。
  ;(channel.rows as Array<Record<string, unknown>>).push(
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
  )
  bump()
  stdin.write('\t')
  await sleep(400)
  check('T7a Tab 进入即 seek 到末行', await settled(() => screenHas('tail-check')))
  // 一路 ↑ 走到第一个可选行（user，在 60 行 filler 之上、视口之外）。
  // 单键间隔 100ms（人手速度）：同帧连发时 moveSelection 闭包里的
  // selectedId 是旧值，光标走不动——真实按键每键之间有一次 commit。
  for (let i = 0; i < 70; i++) {
    stdin.write('\x1b[A')
    await sleep(100)
  }
  await sleep(300)
  check(
    'T7b ↑ 走到顶行时 seekRow 滚入视口',
    await settled(() => screenHas('user line alpha')),
    `uservis=${screenHas('user line alpha')} top=${JSON.stringify((viewportLines().find(l => l.trim() !== '') ?? '').slice(0, 50))} asstvis=${screenHas('assistant reply omega')}`,
  )
  // T7b 最后一个 forceMount 的清除宏任务（setTimeout 0）此刻可能尚未排空：
  // 窗口还带着旧扩窗、末行 el 仍挂载；紧按 G 会让 scrollToElement 的 anchor
  // 在清除触发的收窄 re-render 里随行一起卸载，anchorTop 读不到、seek 静默
  // 丢失（HEAD 既有竞态，与被测行为无关；真实按键间隔远大于该宏任务）。
  await sleep(150) // 固定窗:pacing 等待 forceMount 清除宏任务排空，无可观测锚点

  // T11: G/g 跳尾行/首行（G 是 vim 习惯，单按 g 兼容 less；gg 第二按幂等）。
  // 跳首行后 isSticky=false，屏顶会叠出 PinnedTurnHeader（同文本、无高亮），
  // 所以断言必须找"文本匹配且该行带选中背景"的那一行。
  const lineHighlighted = (s: string): boolean => {
    const lines = viewportLines()
    for (let r = 0; r < lines.length; r++) {
      if (!lines[r]!.includes(s)) continue
      if (JSON.stringify(buf().getLine(buf().baseY + r)?.getCell(3)?.getBgColor() ?? null) !== defaultBg) return true
    }
    return false
  }
  stdin.write('G')
  await sleep(400)
  const tail11 = findText('tail-check')
  check(
    'T11a G 跳末行并滚入（高亮）',
    tail11 !== null && bgKey(tail11.col, tail11.row) !== defaultBg,
  )
  stdin.write('g')
  const ok11b = await settled(() => lineHighlighted('user line alpha'))
  check(
    'T11b g 跳首行并滚入（高亮）',
    ok11b,
    `visible=${screenHas('user line alpha')}`,
  )
  stdin.write('g')
  await sleep(250)
  check(
    'T11c gg 第二按幂等（仍首行仍高亮）',
    lineHighlighted('user line alpha'),
  )

  // T15: Tab 退出再进入（中间无输入）恢复光标与视口——旧行为重进时
  // findLast 种末行 + 滚底；只有 rows 变化（提交新消息）才应跟随底部。
  stdin.write('\t') // 退出（Chat 分支消费）
  await sleep(300)
  stdin.write('\t') // 重进（PromptInput 的空闲 Tab）
  await sleep(350)
  check(
    'T15a Tab 往返后光标恢复（仍 user 行、视口未跳底）',
    screenHas('esc to return to input') && lineHighlighted('user line alpha') && screenHas('user line alpha'),
  )

  // T16: 浮窗标题分支——user 行 → User message + 原文；reasoning 行 →
  // Thinking + 时长（T13 只测了 tool 行）。
  stdin.write('\r')
  await sleep(450)
  check(
    'T16a user 行浮窗（User message 标题 + 原文）',
    await settled(() => screenHas('User message') && screenHas('user line alpha')),
  )
  stdin.write('\x1b')
  await sleep(300)
  stdin.write('j') // user → reasoning（user 是首个可选行，k 不动）
  await sleep(300)
  stdin.write('\r')
  await sleep(450)
  check(
    'T16b reasoning 行浮窗（Thinking 标题）',
    await settled(() => screenHas('Thinking · 0.8s')),
  )
  stdin.write('\x1b')
  await sleep(300)

  // T17: 快照过期分支——退出后有新行（模拟提交），重进必须跟末行
  // 而不是恢复旧光标（"输入了才滚到底"的另一半）。
  stdin.write('\t') // 退出（快照当前 rows）
  await sleep(300)
  const rowsArr = channel.rows as Array<Record<string, unknown>>
  rowsArr.push({ id: 200, kind: 'user', text: 'fresh turn line' })
  bump()
  await sleep(400)
  stdin.write('\t') // 重进：rows 已变 → 跟末行
  await sleep(400)
  check(
    'T17 提交新消息后重进跟随末行（非恢复旧光标）',
    screenHas('esc to return to input') && lineHighlighted('fresh turn line'),
  )

  // T18: 浮窗区域预算——输入簇增高（背景 agent 提示行 +1）时卡片顶部
  // 不被 transcript 区域边缘裁掉（标题仍可见）。
  ;(channel as Record<string, unknown>).backgroundAgentsNeedingInput = 1
  bump()
  await sleep(400)
  stdin.write('\r')
  await sleep(500)
  check(
    'T18 输入簇增高时浮窗标题不被裁（maxRows=viewport 预算）',
    await settled(() => screenHas('User message')),
  )
  stdin.write('\x1b')
  await sleep(300)
  ;(channel as Record<string, unknown>).backgroundAgentsNeedingInput = undefined
  bump()
  await sleep(300)
  // 复原 T13 的前提：光标回首个可选行（T13a 从 user jj 到 tool）。
  stdin.write('g')
  await sleep(400)

  // T13: Enter 打开 row-detail 浮窗（grok "Enter details" 语义）——全文在
  // 卡片内滚动阅读；折叠展开归 l/h；Esc/Enter 关闭回选择模式且光标不动。
  stdin.write('j')
  await sleep(200)
  stdin.write('j')
  await sleep(250)
  check('T13a jj 光标到 tool 行', lineHighlighted('Bash('))
  stdin.write('\r')
  await sleep(500)
  const okTitle = await settled(() => screenHas('bash(seq 1 30)'))
  const okArgs = screenHas('$ {"command"')
  const okHead = screenHas('result-line-0')
  const okHint = screenHas('j/k scroll')
  check(
    'T13b Enter 打开浮窗（标题+参数+输出头部+hint）',
    okTitle && okArgs && okHead && okHint,
    `title=${okTitle} args=${okArgs} head=${okHead} hint=${okHint} top=${JSON.stringify((viewportLines().find(l => l.trim() !== '') ?? '').slice(0, 70))}`,
  )
  check('T13c 60 行输出尾部初始在浮窗外', !screenHas('result-line-59'))
  check(
    'T13c2 浮窗内源换行保真（一行独占一个 result-line-N，非软折行连排）',
    await settled(() => {
      // 行形态 `│ result-line-N   │`：卡片边框与内容同视觉行，底层 dim 文字
      // 可能从背板透出（◆/● 前缀）——按边框+文本匹配，不要求整行相等。
      const lines = viewportLines()
      return lines.some(l => l.includes('│ result-line-3')) && lines.some(l => l.includes('│ result-line-4'))
    }),
  )
  stdin.write('G')
  await sleep(400)
  check('T13d 浮窗内 G 滚到输出尾部', await settled(() => screenHas('result-line-59') && !screenHas('result-line-0')))
  stdin.write('\x1b')
  await sleep(300)
  check(
    'T13e Esc 关闭浮窗、光标仍在 tool 行',
    !screenHas('j/k scroll') && screenHas('esc to return to input') && lineHighlighted('Bash('),
  )
  stdin.write('\r')
  await sleep(400)
  stdin.write('\r')
  await sleep(300)
  check('T13f Enter 关闭浮窗', !screenHas('j/k scroll') && screenHas('esc to return to input'))
  stdin.write('\x1b')
  await sleep(250)

  // T14: 鼠标点击输入簇退出选择模式（Tab-back 的鼠标等价）。headless 终端
  // 不应答 alt-screen 探测——onWrite 收到 ?1049$p 时回 DECRPM set，
  // dispatchClick 的 altScreenActive 守卫随即放行 SGR 点击（真实终端自己
  // 走完这条握手，链路同 drag-protocol I9b）。
  FakeStdout.onWrite = chunk => {
    if (chunk.includes('[?1049$p')) {
      queueMicrotask(() => stdin.write('\x1b[?1049;2$y'))
    }
  }
  stdin.write('\t')
  await sleep(400)
  check('T14a 重进选择模式', screenHas('esc to return to input'))
  stdin.write('\x1b[I') // FOCUS_IN → 触发 alt-screen 探测
  await sleep(300) // 固定窗:等探测应答与 altScreenActive 生效，无可观测锚点
  const inputRow = (() => {
    const lines = viewportLines()
    for (let r = lines.length - 1; r >= 0; r--) {
      if (lines[r]!.includes('❯')) return r
    }
    return -1
  })()
  check('T14b 定位输入行', inputRow >= 0, `row=${inputRow}`)
  stdin.write(`\x1b[<0;5;${inputRow + 1}M`) // press（SGR 坐标 1-based）
  await sleep(120)
  stdin.write(`\x1b[<0;5;${inputRow + 1}m`) // release → dispatchClick
  await sleep(400)
  check('T14c 点击输入行退出选择模式', !screenHas('esc to return to input'))
  stdin.write('mm')
  check('T14d 退出后打字恢复', await settled(() => screenHas('mm')))
  FakeStdout.onWrite = null

} finally {
  app.unmount()
}

if (failures > 0) {
  console.error(`\nverify-transcript-selection: ${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nverify-transcript-selection: all checks passed')
