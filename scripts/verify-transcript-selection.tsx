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
const followUpCalls: Array<[string, string]> = []
const notifyCalls: string[] = []
const killCalls: string[] = []
const removeCalls: string[] = []
// Two multi-word columns: without the content-width override the table is
// 96 cells wide in a 94-cell column (COLS 100 − 6 inset) and the Text
// layout re-wraps it, breaking the box borders mid-row. Multi-word cells
// matter: wrap-ansi's wordWrap never folds an unbroken long word, which
// would push the table into the vertical fallback instead.
const tableCell = (word: string): string => Array.from({ length: 8 }, () => word).join(' ')
const tableMarkdown = `| ${tableCell('a')} | ${tableCell('b')} |\n|---|---|\n| ${tableCell('c')} | ${tableCell('d')} |`
const transcriptEvents = [
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
  notify(text: unknown) { notifyCalls.push(String(text)) },
  subagents: [],
  backgroundJobs: [] as Array<Record<string, unknown>>,
  subagentModes: () => Promise.resolve({ 'sa-1': true, 'sa-2': false }),
  subagentTranscript: (id: string) => Promise.resolve(id === 'sa-1' || id === 'sa-7' ? transcriptEvents : id === 'sa-9' ? tableEvents : []),
  jobControl: {
    kill: (id: string) => { killCalls.push(id); return true },
  },
  subagentControl: {
    interrupt: () => true,
    followUp: async (id: string, text: string) => { followUpCalls.push([id, text]); return true },
    remove: (id: string) => { removeCalls.push(id); return 'removed' },
  },
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
  await sleep(250) // 固定窗:pacing 等输入批次与渲染帧排空
  stdin.write('zz')
  await sleep(250) // 固定窗:pacing 等输入批次与渲染帧排空
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
  await sleep(250) // 固定窗:pacing 等输入批次与渲染帧排空
  const bash1 = findText('Bash(')
  check(
    'T3a ↑ 后 tool 行高亮且点亮（bg+fg）',
    bash1 !== null && bgKey(bash1.col, bash1.row) !== defaultBg && fgKey(bash1.col, bash1.row) !== dimFg,
  )
  stdin.write('\x1b[A')
  await sleep(250) // 固定窗:pacing 等输入批次与渲染帧排空
  const thought1 = findText('Thought')
  const bash2 = findText('Bash(')
  check(
    'T3a2 ↑↑ 后 reasoning 行高亮、tool 行释放',
    thought1 !== null && bash2 !== null && bgKey(thought1.col, thought1.row) !== defaultBg && bgKey(bash2.col, bash2.row) === defaultBg,
  )
  // T4: ↓ 回到 tool 行，l 展开折叠正文。
  stdin.write('\x1b[B')
  await sleep(250) // 固定窗:pacing 等输入批次与渲染帧排空
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
  await sleep(250) // 固定窗:pacing 等输入批次与渲染帧排空
  stdin.write('zz')
  check('T5 Tab 退出后打字恢复', await settled(() => screenHas('zz')))

  // T6: 再进一次，Esc 也能退出并恢复打字。
  stdin.write('\t')
  await sleep(250) // 固定窗:pacing 等输入批次与渲染帧排空
  stdin.write('\x1b')
  await sleep(250) // 固定窗:pacing 等输入批次与渲染帧排空
  stdin.write('qq')
  check('T6 Esc 退出后打字恢复', await settled(() => screenHas('qq')))

  // T9: 选择模式里 Ctrl+O 随时生效并覆盖单行展开状态。断言用 reasoning
  // 行的 verbose 差异（展开=全文可见；收起=单行 Thought，正文不可见）。
  for (let i = 0; i < 8; i++) stdin.write('\x1b[5~')
  await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
  stdin.write('\t')
  await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
  check('T9-pre 选择模式已激活', await settled(() => screenHas('esc to return to input')))
  // 进入选择模式的光标现在落在末行 assistant（nearest 底对齐，页面回底）；
  // 先 g 跳回顶部，reasoning/tool 回到屏内，Ctrl+O 的展开才可见。
  stdin.write('g')
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  stdin.write('\x0f') // Ctrl+O → transcript mode on
  await sleep(600) // 固定窗:pacing 等输入批次与渲染帧排空
  check(
    'T9a 选择模式里 Ctrl+O 全局展开（reasoning 全文可见）',
    await settled(() => screenHas('reasoning body marker xyz')),
  )
  stdin.write('\x0f') // Ctrl+O → off，单行 expandedRows 一并清除
  await sleep(600) // 固定窗:pacing 等输入批次与渲染帧排空
  check(
    'T9b Ctrl+O 收起覆盖单行展开（reasoning 回折叠）',
    await settled(() => !screenHas('reasoning body marker xyz') && !screenHas('result-line-59')),
  )
  stdin.write('\x1b')
  await sleep(250) // 固定窗:pacing 等输入批次与渲染帧排空

  // T10: vim l/h 定向折叠——l 只展开（并 pin 行首），h 只收起，幂等。
  stdin.write('\t')
  await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
  check('T10-pre 选择模式已激活', await settled(() => screenHas('esc to return to input')))
  stdin.write('g')
  await sleep(250) // 固定窗:pacing 等输入批次与渲染帧排空
  const user10 = findText('user line alpha')
  check('T10a g 跳首行并高亮', user10 !== null && bgKey(user10.col, user10.row) !== defaultBg)
  stdin.write('j')
  await sleep(200) // 固定窗:pacing 等输入批次与渲染帧排空
  stdin.write('j')
  await sleep(250) // 固定窗:pacing 等输入批次与渲染帧排空
  const bash10 = findText('Bash(')
  check('T10b j j 选中 tool 行', bash10 !== null && bgKey(bash10.col, bash10.row) !== defaultBg)
  stdin.write('l')
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  check(
    'T10c l 展开并 pin 首行',
    await settled(() => screenHas('result-line-0') && !screenHas('result-line-59')),
  )
  stdin.write('h')
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  check('T10d h 收起', await settled(() => !screenHas('result-line-0') && !screenHas('result-line-59')))
  stdin.write('h') // 已收起：幂等无操作
  await sleep(250) // 固定窗:pacing 等输入批次与渲染帧排空
  const bash10b = findText('Bash(')
  check('T10e h 幂等（仍收起、仍选中）', bash10b !== null && bgKey(bash10b.col, bash10b.row) !== defaultBg)

  // T10f: 全局展开态独占折叠（Ctrl+O 契约）——l 在已全局展开的行上
  // 不登记行级展开、不触发 pin 跳页；关回折叠全局态后该行保持折叠
  // （旧行为会白登记一条，收起后展开残留）。
  const topOf = (): string => viewportLines().find(line => line.trim() !== '') ?? ''
  stdin.write('\x0f') // Ctrl+O → transcript mode on（tool 行随之展开）
  await sleep(600) // 固定窗:pacing 全局重排 + reanchor 落定，无可观测锚点
  const top10f = topOf()
  stdin.write('l')
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  check(
    'T10f1 全局展开态 l 不跳页（视口顶不动）',
    topOf() === top10f,
  )
  stdin.write('\x0f') // Ctrl+O → off：无行级登记 → tool 行回折叠
  await sleep(600) // 固定窗:pacing 全局重排 + reanchor 落定，无可观测锚点
  check(
    'T10f2 全局展开态 l 无行级登记（收起后无展开残留）',
    await settled(() => !screenHas('result-line-0') && !screenHas('result-line-59')),
  )

  // T12: nearest 光标滚动——视口内移动只动光标、页面纹丝不动（旧
  // top-align 行为会把光标行钉到屏幕顶，页面每次跳变）。
  const before12 = topOf()
  stdin.write('k') // reasoning 行在屏内：光标上移，页面不动
  await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
  const thought12 = findText('Thought')
  check(
    'T12a 视口内 k 光标上移、页面不动',
    thought12 !== null && bgKey(thought12.col, thought12.row) !== defaultBg && topOf() === before12,
  )
  stdin.write('j') // 回 tool 行，同样在屏内
  await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
  const bash12 = findText('Bash(')
  check(
    'T12b 视口内 j 光标下移、页面不动',
    bash12 !== null && bgKey(bash12.col, bash12.row) !== defaultBg && topOf() === before12,
  )
  stdin.write('\x1b')
  await sleep(250) // 固定窗:pacing 等输入批次与渲染帧排空



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
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  check('T7a Tab 进入即 seek 到末行', await settled(() => screenHas('tail-check')))
  // 一路 ↑ 走到第一个可选行（user，在 60 行 filler 之上、视口之外）。
  // 单键间隔 100ms（人手速度）：同帧连发时 moveSelection 闭包里的
  // selectedId 是旧值，光标走不动——真实按键每键之间有一次 commit。
  for (let i = 0; i < 70; i++) {
    stdin.write('\x1b[A')
    await sleep(100) // 固定窗:pacing 等输入批次与渲染帧排空
  }
  await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
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
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
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
  await sleep(250) // 固定窗:pacing 等输入批次与渲染帧排空
  check(
    'T11c gg 第二按幂等（仍首行仍高亮）',
    lineHighlighted('user line alpha'),
  )

  // T15: Tab 退出再进入（中间无输入）恢复光标与视口——旧行为重进时
  // findLast 种末行 + 滚底；只有 rows 变化（提交新消息）才应跟随底部。
  stdin.write('\t') // 退出（Chat 分支消费）
  await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
  stdin.write('\t') // 重进（PromptInput 的空闲 Tab）
  await sleep(350) // 固定窗:pacing 等输入批次与渲染帧排空
  check(
    'T15a Tab 往返后光标恢复（仍 user 行、视口未跳底）',
    screenHas('esc to return to input') && lineHighlighted('user line alpha') && screenHas('user line alpha'),
  )

  // T16: 浮窗标题分支——user 行 → User message + 原文；reasoning 行 →
  // Thinking + 时长（T13 只测了 tool 行）。
  stdin.write('\r')
  await sleep(450) // 固定窗:pacing 等输入批次与渲染帧排空
  check(
    'T16a user 行浮窗（User message 标题 + 原文）',
    await settled(() => screenHas('User message') && screenHas('user line alpha')),
  )
  stdin.write('\x1b')
  await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
  stdin.write('j') // user → reasoning（user 是首个可选行，k 不动）
  await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
  stdin.write('\r')
  await sleep(450) // 固定窗:pacing 等输入批次与渲染帧排空
  check(
    'T16b reasoning 行浮窗（Thinking 标题）',
    await settled(() => screenHas('Thinking · 0.8s')),
  )
  stdin.write('\x1b')
  await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空

  // T17: 快照过期分支——退出后有新行（模拟提交），重进必须跟末行
  // 而不是恢复旧光标（"输入了才滚到底"的另一半）。
  stdin.write('\t') // 退出（快照当前 rows）
  await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
  const rowsArr = channel.rows as Array<Record<string, unknown>>
  rowsArr.push({ id: 200, kind: 'user', text: 'fresh turn line' })
  bump()
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  stdin.write('\t') // 重进：rows 已变 → 跟末行
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  check(
    'T17 提交新消息后重进跟随末行（非恢复旧光标）',
    screenHas('esc to return to input') && lineHighlighted('fresh turn line'),
  )

  // T18: 浮窗区域预算——输入簇增高（背景 agent 提示行 +1）时卡片顶部
  // 不被 transcript 区域边缘裁掉（标题仍可见）。
  ;(channel as Record<string, unknown>).backgroundAgentsNeedingInput = 1
  bump()
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  stdin.write('\r')
  await sleep(500) // 固定窗:pacing 等输入批次与渲染帧排空
  check(
    'T18 输入簇增高时浮窗标题不被裁（maxRows=viewport 预算）',
    await settled(() => screenHas('User message')),
  )
  stdin.write('\x1b')
  await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
  ;(channel as Record<string, unknown>).backgroundAgentsNeedingInput = undefined
  bump()
  await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
  // 复原 T13 的前提：光标回首个可选行（T13a 从 user jj 到 tool）。
  stdin.write('g')
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空

  // T13: Enter 打开 row-detail 浮窗（grok "Enter details" 语义）——全文在
  // 卡片内滚动阅读；折叠展开归 l/h；Esc/Enter 关闭回选择模式且光标不动。
  stdin.write('j')
  await sleep(200) // 固定窗:pacing 等输入批次与渲染帧排空
  stdin.write('j')
  await sleep(250) // 固定窗:pacing 等输入批次与渲染帧排空
  check('T13a jj 光标到 tool 行', lineHighlighted('Bash('))
  stdin.write('\r')
  await sleep(500) // 固定窗:pacing 等输入批次与渲染帧排空
  const okTitle = await settled(() => screenHas('Bash(seq 1 30)'))
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
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  check('T13d 浮窗内 G 滚到输出尾部', await settled(() => screenHas('result-line-59') && !screenHas('result-line-0')))
  stdin.write('\x1b')
  await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
  check(
    'T13e Esc 关闭浮窗、光标仍在 tool 行',
    !screenHas('j/k scroll') && screenHas('esc to return to input') && lineHighlighted('Bash('),
  )
  stdin.write('\r')
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  stdin.write('\r')
  await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
  check('T13f Enter 关闭浮窗', !screenHas('j/k scroll') && screenHas('esc to return to input'))

  // T19/T20: 选择模式下的 Ctrl+C（grok 语义：Cancel turn 全局可达）——
  // working 时打断且停留在选择模式；idle 时退出选择模式（同 Esc/Tab 的
  // 肌肉记忆，绝不清空隐藏输入框草稿）。
  let cancelCount = 0
  ;(channel as Record<string, unknown>).cancel = () => {
    cancelCount++
  }
  ;(channel as Record<string, unknown>).working = true
  bump()
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  stdin.write('\x03')
  await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
  check(
    'T19a 选择模式 working Ctrl+C 打断（cancel 调用、仍在选择模式）',
    cancelCount === 1 && screenHas('esc to return to input') && lineHighlighted('Bash('),
  )
  ;(channel as Record<string, unknown>).working = false
  bump()
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  stdin.write('\x03')
  await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
  check('T20 选择模式 idle Ctrl+C 退出选择模式', !screenHas('esc to return to input'))
  stdin.write('\t')
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  check('T20b 重进选择模式（光标恢复 tool 行）', screenHas('esc to return to input') && lineHighlighted('Bash('))

  // T21: Ctrl+B / Ctrl+F vim 翻页（同 PgUp/PgDn 页大小）——视口移动、
  // selectedId 保留（k/j 把光标行拉回视口，翻页不与选择打架）。
  stdin.write('\x02') // Ctrl+B → page up
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  check('T21a Ctrl+B 翻到会话顶部', await settled(() => screenHas('user line alpha')))
  stdin.write('k') // 光标 tool → reasoning，nearest seek 拉回视口
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  check(
    'T21b 翻页后 selectedId 保留（k 拉回高亮）',
    lineHighlighted('Thought'),
    `hl=${JSON.stringify(viewportLines().filter(l => l.trim() !== '').map(l => l.trim().slice(0, 44)))}`,
  )
  // Ctrl+F page-by-page to the bottom（filler 48 行、每页净进 viewport-1 行，
  // 循环发送直到 clamp 到底：fresh turn 可见 + pill 消失）。
  let pagedToBottom = false
  for (let i = 0; i < 12 && !pagedToBottom; i++) {
    stdin.write('\x06')
    await sleep(250) // 固定窗:pacing 等输入批次与渲染帧排空
    pagedToBottom = screenHas('fresh turn line') && !screenHas('back to bottom')
  }
  check('T21c Ctrl+F 连续翻页到底部（clamp 后 sticky 恢复、pill 消失）', pagedToBottom)

  // T22/T23: 浮窗内 Ctrl+C——working 时打断且浮窗保持（grok: Cancel 全局，
  // Esc 才是 close）；idle 时维持关闭语义。
  stdin.write('j') // reasoning → tool
  await sleep(250) // 固定窗:pacing 等输入批次与渲染帧排空
  stdin.write('\r')
  await sleep(500) // 固定窗:pacing 等输入批次与渲染帧排空
  check('T22a 浮窗打开', screenHas('Bash(seq 1 30)'))
  ;(channel as Record<string, unknown>).working = true
  bump()
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  stdin.write('\x03')
  await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
  check(
    'T22b 浮窗内 working Ctrl+C 打断且浮窗保持',
    cancelCount === 2 && screenHas('Bash(seq 1 30)'),
  )
  ;(channel as Record<string, unknown>).working = false
  bump()
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  stdin.write('\x03')
  await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
  check('T23 浮窗内 idle Ctrl+C 关闭浮窗', !screenHas('Bash(seq 1 30)') && screenHas('esc to return to input'))
  stdin.write('\x1b')
  await sleep(250) // 固定窗:pacing 等输入批次与渲染帧排空

  // T24: 图片预览浮窗内 Ctrl+C——与 row-detail 同一条全局打断契约：
  // working 时打断且浮窗保持（Cancel 全局，Esc 才是 close）；idle 时关闭。
  // 浮窗经缩略图点击打开（完整 Chat 键位链，非组件直渲染）。headless
  // 终端不应答 alt-screen 探测——同 T14 的 onWrite 应答后 SGR 点击放行。
  // push 后走 '\t' 进选择模式：enterSelection 的 findLast + 底对齐 seek
  // 把新行 forceMount 滚入视口（mock 原地 push 不触发 sticky 补画）。
  ;(channel.rows as Array<Record<string, unknown>>).push({
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
  })
  bump()
  stdin.write('\t') // 退出选择模式后重进：findLast → 新行滚入
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  check('T24a 缩略图渲染（fallback 文本）', await settled(() => screenHas('[Image · shot.png]')),
    `screen=${JSON.stringify(viewportLines().filter(l => l.trim() !== '').map(l => l.trim().slice(0, 60)))}`)
  FakeStdout.onWrite = chunk => {
    if (chunk.includes('[?1049$p')) {
      queueMicrotask(() => stdin.write('\x1b[?1049;2$y'))
    }
  }
  stdin.write('\x1b[I') // FOCUS_IN → 触发 alt-screen 探测
  await sleep(300) // 固定窗:pacing 等探测应答与 altScreenActive 生效，无可观测锚点
  const thumbRow = (() => {
    const lines = viewportLines()
    for (let r = 0; r < lines.length; r++) {
      if (lines[r]!.includes('Image · shot.png')) return r
    }
    return -1
  })()
  check('T24b 定位缩略图行', thumbRow >= 0, `row=${thumbRow}`)
  stdin.write(`\x1b[<0;5;${thumbRow + 1}M`) // press（SGR 坐标 1-based）
  await sleep(120) // 固定窗:pacing 等输入批次与渲染帧排空
  stdin.write(`\x1b[<0;5;${thumbRow + 1}m`) // release → dispatchClick
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  check('T24c 点击缩略图打开图片预览浮窗', screenHas('Open original'))
  ;(channel as Record<string, unknown>).working = true
  bump()
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  stdin.write('\x03')
  await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
  check(
    'T24d 图片浮窗内 working Ctrl+C 打断且浮窗保持',
    cancelCount === 3 && screenHas('Open original'),
  )
  ;(channel as Record<string, unknown>).working = false
  bump()
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  stdin.write('\x03')
  await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
  check('T24e 图片浮窗内 idle Ctrl+C 关闭浮窗', !screenHas('Open original'))

  // T25: G 重粘 sticky——翻上去（自动跟随断开）→ G 跳末行恢复自动滚动 →
  // 新行到达无需任何按键即滚入视口（grok 语义：跳到尾 = 重新跟随尾巴）。
  stdin.write('\x02') // Ctrl+B 翻页离开底部
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  check('T25a Ctrl+B 已离开底部', !screenHas('image turn line'))
  stdin.write('G')
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  check('T25b G 跳末行（末行滚入）', await settled(() => screenHas('image turn line')))
  // T25c（真机项，headless 不可测）：G 重粘 sticky 后，流式新行应自动
  // 滚入。mock 原地 push 不换 rows 引用，挂载窗口与 scrollHeight 互相
  // 锁死（sticky=true 也不挂尾），headless 复现不了真实 emitStream 的
  // 跟随链——该语义由真机 tmux 场景验证（见 DEV.md）。

  // T26: 提交新 prompt 自动回底——浏览历史时提交，视图回到对话尾
  // （新问题的回答在尾部，grok 提交即回底）。
  stdin.write('\x02') // Ctrl+B 翻上去（断开跟随）
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  check('T26a 已离开底部', !screenHas('image turn line'))
  stdin.write('\x1b') // 退出选择模式回 composer
  await sleep(250) // 固定窗:pacing 等输入批次与渲染帧排空
  stdin.write('followme')
  await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
  stdin.write('\r') // Enter 提交（mock submit 空函数，不落行）
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  check(
    'T26b 提交后自动回底（尾部可见）',
    await settled(() => screenHas('image turn line')),
    `screen=${JSON.stringify(viewportLines().filter(l => l.trim() !== '').map(l => l.trim().slice(0, 50)).slice(-6))}`,
  )

  // T27: assistant 行 Enter 浮窗——标题 Reply、正文 markdown 渲染（grok 的
  // 详情卡保留格式：code fence 与 ** 加粗标记被剥除，不按原文显示），且
  // 浮窗开着时流式追加的内容跟随出现（流式行上读详情不被冻结）。
  ;(channel.rows as Array<Record<string, unknown>>).push({
    id: 310,
    kind: 'assistant',
    text: '**bm** prose\n\n```ts\nconst value = 1\n```\n',
  })
  bump()
  stdin.write('\t') // 重进选择模式（findLast 跟随新末行 id 310）
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  check('T27a 光标跟到新 assistant 行', await settled(() => lineHighlighted('bm') || screenHas('bm')))
  stdin.write('\r') // Enter → 浮窗
  await sleep(500) // 固定窗:pacing 等输入批次与渲染帧排空
  check(
    'T27b assistant 浮窗 markdown（加粗标记剥除、标题 Reply）',
    await settled(() => screenHas('Reply') && screenHas('const value = 1') && !screenHas('**bm**') && screenHas('bm')),
    `screen=${JSON.stringify(viewportLines().filter(l => l.trim() !== '').map(l => l.trim().slice(0, 50)).slice(-8))}`,
  )
  ;(channel.rows as Array<Record<string, unknown>>).find(r => r.id === 310)!.text =
    '**bm** prose\n\n```ts\nconst value = 1\n```\nstreaming tail marker\n'
  bump()
  check('T27c 浮窗跟随流式追加（无冻结）', await settled(() => screenHas('streaming tail marker')))
  stdin.write('\x1b')
  await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空

  // T30: l/h 在无折叠语义的行上 no-op——assistant/user 行按 l 不登记展开、
  // 不触发 pin 跳页（grok 的行级展开只作用于 thought/tool 卡）。
  const top30 = topOf()
  stdin.write('l') // 光标在 assistant 行（id 310）
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  check('T30a assistant 行 l 不跳页', topOf() === top30)
  stdin.write('g') // 到首个可选行（user）
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  const top30b = topOf()
  stdin.write('l') // user 行
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  check('T30b user 行 l 不跳页', topOf() === top30b)
  stdin.write('\x1b') // 退出选择模式（恢复 T14 的 '\t' 进入前提）
  await sleep(250) // 固定窗:pacing 等输入批次与渲染帧排空

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
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  check('T14a 重进选择模式', screenHas('esc to return to input'))
  stdin.write('\x1b[I') // FOCUS_IN → 触发 alt-screen 探测
  await sleep(300) // 固定窗:pacing 等探测应答与 altScreenActive 生效，无可观测锚点
  const inputRow = (() => {
    const lines = viewportLines()
    for (let r = lines.length - 1; r >= 0; r--) {
      if (lines[r]!.includes('❯')) return r
    }
    return -1
  })()
  check('T14b 定位输入行', inputRow >= 0, `row=${inputRow}`)
  stdin.write(`\x1b[<0;5;${inputRow + 1}M`) // press（SGR 坐标 1-based）
  await sleep(120) // 固定窗:pacing 等输入批次与渲染帧排空
  stdin.write(`\x1b[<0;5;${inputRow + 1}m`) // release → dispatchClick
  await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
  check('T14c 点击输入行退出选择模式', !screenHas('esc to return to input'))
  stdin.write('mm')
  check('T14d 退出后打字恢复', await settled(() => screenHas('mm')))
  FakeStdout.onWrite = null

  // T31: subagent management surfaces — status chip, settlement toast, and
  // the Ctrl+A dashboard's follow-up composer (send_message seam). The mock
  // channel re-assigns channel.subagents (a fresh array reference per bump,
  // matching the real projection's syncNow snapshot) so Chat's settlement
  // effect observes the transition.
  const saRunning = { agentId: 'sa-1', runId: 'sa-1', description: 'research task', provider: 'subagent', model: 'm', status: 'running', startedAt: Date.now() - 5000, output: [], outputEvents: [], toolCalls: [] }
  channel.subagents = [saRunning, { ...saRunning, agentId: 'sa-2', runId: 'sa-2', description: 'old one-shot', status: 'completed', completedAt: Date.now() - 1000 }]
  bump()
  check('T31a running 子代理出现在状态行 chip（⑂ 1）', await settled(() => screenHas('⑂ 1')))
  channel.subagents = [{ ...saRunning, status: 'completed', completedAt: Date.now() }]
  bump()
  await sleep(500) // 固定窗:pacing 等 settle effect 派发 toast
  check('T31b 面板关闭时 settle 触发 toast',
    notifyCalls.some(text => text.includes('subagent done: research task')),
    JSON.stringify(notifyCalls))
  channel.subagents = [saRunning]
  bump()
  await settled(() => screenHas('⑂ 1'))
  stdin.write('\x01') // Ctrl+A → dashboard
  await sleep(500) // 固定窗:pacing 等面板挂载帧
  check('T31c Ctrl+A 打开子代理面板', screenHas('Subagent Dashboard') && screenHas('research task'))
  check('T31d continuable 焦点行提示追问键', screenHas('m follow up'))
  stdin.write('m')
  await sleep(300) // 固定窗:pacing 等输入行挂载
  check('T31e m 打开追问输入行', screenHas('type a follow-up'))
  stdin.write('dig deeper')
  await sleep(300) // 固定窗:pacing 等输入批次
  stdin.write('\r')
  await sleep(500) // 固定窗:pacing 等投递与 toast
  check('T31f 追问经 send_message 投递并回执',
    followUpCalls.length === 1 && followUpCalls[0]![0] === 'sa-1' && followUpCalls[0]![1] === 'dig deeper'
    && notifyCalls.some(text => text.includes('follow-up delivered')),
    `calls=${JSON.stringify(followUpCalls)} notify=${JSON.stringify(notifyCalls)}`)
  stdin.write('\x1b') // 关闭面板回主界面
  await sleep(400) // 固定窗:pacing 等卸载帧
  // The viewport keeps its pre-dashboard scroll position (mid-transcript
  // filler rows), so assert the dashboard is gone and the transcript is back.
  check('T31g Esc 关闭面板', !screenHas('Subagent Dashboard') && screenHas('filler line'))
  channel.subagents = []
  bump()
  await sleep(300) // 固定窗:pacing 等重渲染（chip 消失，不影响后续）

  // T32: task center — unified panel (Ctrl+G), agent strip, and the
  // transcript detail scene.
  const saT32 = { agentId: 'sa-1', runId: 'sa-1', description: 'research task', provider: 'subagent', model: 'glm', status: 'running', startedAt: Date.now() - 3000, output: ['scanning docs'], outputEvents: [], toolCalls: [{ name: 'Grep' }] }
  channel.subagents = [saT32]
  bump()
  check('T32a 常驻浮层出现（◍ 描述 + 实时尾行 + ⌃G 提示）',
    await settled(() => screenHas('◍') && screenHas('research task') && screenHas('⌃G')))
  stdin.write('\x07') // Ctrl+G → task center
  await sleep(500) // 固定窗:pacing 等面板挂载
  check('T32b Ctrl+G 打开任务中心（两区分区标题）',
    screenHas('Task Center') && screenHas('Tasks (0)') && screenHas('Subagents (1)'))
  check('T32c 焦点行统计与追问提示', screenHas('research task') && screenHas('m follow up'))
  stdin.write('\r') // Enter → transcript detail scene
  await sleep(500) // 固定窗:pacing 等 events 读取与折叠
  check('T32d 详情=完整对话转录（user prompt + 定稿 assistant + 工具卡）',
    screenHas('count tsx files under src') && screenHas('Found') && screenHas('122') && screenHas('Bash'),
    viewportLines().slice(0, 8).join(' | '))
  stdin.write('m')
  await sleep(300) // 固定窗:pacing 等输入行
  stdin.write('go deeper')
  await sleep(300) // 固定窗:pacing 等输入批次
  stdin.write('\r')
  await sleep(500) // 固定窗:pacing 等投递
  check('T32e 转录场景内追问投递', followUpCalls.some(([id, text]) => id === 'sa-1' && text === 'go deeper'),
    JSON.stringify(followUpCalls))
  stdin.write('\x1b') // 回面板
  await sleep(300) // 固定窗:pacing 等返回
  // Focus a running job row: seed one, reopen, kill with k.
  channel.backgroundJobs = [{ id: 'j-9', kind: 'bash', label: 'watch logs', status: 'running', startedAt: Date.now() - 2000, outputLines: ['line-1'] }]
  channel.subagents = [saT32]
  bump()
  await sleep(400) // 固定窗:pacing 等面板重渲染
  check('T32f 面板含后台任务区行', screenHas('j-9') && screenHas('watch logs'))
  // Move focus up into the tasks section then stop with x.
  stdin.write('\x1b[A') // ↑ from subagents row (index 1) to job row (index 0)
  await sleep(200) // 固定窗:pacing 等焦点移动
  stdin.write('x')
  await sleep(300) // 固定窗:pacing 等 kill 派发
  check('T32g x 终止焦点后台任务', killCalls.length === 1 && killCalls[0] === 'j-9', JSON.stringify(killCalls))
  stdin.write('\x1b') // 关闭面板
  await sleep(300) // 固定窗:pacing 等卸载
  check('T32h Esc 关闭任务中心回主界面', !screenHas('Task Center') && screenHas('◍'))
  channel.subagents = []
  channel.backgroundJobs = []
  bump()
  await sleep(300) // 固定窗:pacing 等清理重渲染

  // T33: return-context split (strip vs panel entry), settled-row removal,
  // and the detail scene's table-width fix. The strip lists RUNNING rows
  // only, so the strip door is exercised on the live child.
  const saRun33 = { agentId: 'sa-7', runId: 'sa-7', description: 'live worker', provider: 'subagent', model: 'glm', status: 'running', startedAt: Date.now() - 4000, output: ['working'], outputEvents: [], toolCalls: [] }
  const saDone33 = { agentId: 'sa-9', runId: 'sa-9', description: 'settled worker', provider: 'subagent', model: 'glm', status: 'completed', startedAt: Date.now() - 9000, completedAt: Date.now() - 1000, output: [], outputEvents: [], toolCalls: [] }
  channel.subagents = [saRun33, saDone33]
  bump()
  await settled(() => screenHas('◍') && screenHas('live worker'))
  // Strip click opens the live child's detail (SGR mouse: press+release).
  const stripPos = findText('live worker')
  if (stripPos !== null) {
    stdin.write(`\x1b[<0;${stripPos.col + 3};${stripPos.row + 1}M`)
    await sleep(150) // 固定窗:pacing 让 press 先进 gesture latch
    stdin.write(`\x1b[<0;${stripPos.col + 3};${stripPos.row + 1}m`)
  }
  await settled(() => screenHas('count tsx files under src'))
  check('T33a strip 点击打开详情（转录内容出现）', screenHas('count tsx files under src'))
  stdin.write('\x1b') // Esc: strip entry returns to the MAIN session
  await sleep(400) // 固定窗:pacing 等返回
  check('T33b strip 进入的详情 Esc 回主界面（不回面板）',
    !screenHas('count tsx files under src') && !screenHas('Task Center') && screenHas('live worker'))
  // Panel entry: Ctrl+G, j moves focus to the settled row, d removes it.
  stdin.write('\x07') // Ctrl+G → task center
  await sleep(500) // 固定窗:pacing 等面板挂载
  check('T33c Ctrl+G 面板含已结算行', screenHas('Task Center') && screenHas('settled worker'))
  stdin.write('j')
  await sleep(200) // 固定窗:pacing 等焦点移动
  check('T33d vim j 下移焦点到已结算行（d 提示出现）', screenHas('d remove'))
  stdin.write('d') // d only fires on a settled subagent row
  await sleep(300) // 固定窗:pacing 等删除派发
  check('T33e d 移除已结算子代理（running 行不响应）',
    removeCalls.length === 1 && removeCalls[0] === 'sa-9'
    && notifyCalls.some(text => text.includes('subagent removed from the list')),
    `remove=${JSON.stringify(removeCalls)}`)
  stdin.write('\r') // Enter → the settled child's detail (table markdown)
  // Table borders must fit the content column (COLS 100 − 6 inset): without
  // the width override the 95-cell top border re-wraps mid-row.
  await settled(() => screenHas('completed') && viewportLines().some(line => line.includes('┌')))
  const tableTop = viewportLines().find(line => line.includes('┌')) ?? ''
  check('T33f 表格按内容列宽度收缩（顶边框 ≤94 列）', tableTop.trimEnd().length > 0 && tableTop.trimEnd().length <= 94,
    `len=${tableTop.trimEnd().length}`)
  stdin.write('\x1b') // Esc: panel entry returns to the PANEL
  await sleep(400) // 固定窗:pacing 等返回
  check('T33g 面板进入的详情 Esc 回面板', screenHas('Task Center') && screenHas('Subagents'))
  stdin.write('\x1b') // 关闭面板
  await sleep(300) // 固定窗:pacing 等卸载
  check('T33h Esc 关闭任务中心回主界面', !screenHas('Task Center') && screenHas('◍'))
  channel.subagents = []
  bump()
  await sleep(300) // 固定窗:pacing 等清理重渲染

  // T34: the working line's thinking phase shows the live reasoning tail
  // (grok-style one-line thinking flow) instead of random phrases.
  {
    const { liveThinkingTail } = await import('../src/components/ActivityLine.js')
    check('T34a liveThinkingTail 取流式 reasoning 尾行',
      liveThinkingTail([{ kind: 'reasoning', text: 'first line\n\n  tail of thinking  ', streaming: true }]) === 'tail of thinking')
    check('T34b 段间隙已 settle 的 reasoning 保留尾行',
      liveThinkingTail([{ kind: 'reasoning', text: 'done thinking', streaming: false }]) === 'done thinking')
    check('T34c 本 turn 无 reasoning（user 边界）回退短语',
      liveThinkingTail([{ kind: 'assistant', text: 'old', streaming: false }, { kind: 'user', text: 'new turn', streaming: false }, { kind: 'tool', text: '', streaming: false }]) === undefined)
  }

} finally {
  app.unmount()
}

if (failures > 0) {
  console.error(`\nverify-transcript-selection: ${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nverify-transcript-selection: all checks passed')
