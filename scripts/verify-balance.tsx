/**
 * /balance 与状态栏花费估算回归。
 *
 * Part A 已拆至 verify-balance-units.ts（T0）：fetchBalance 解析与失败
 *  分类、deepseekPricing 单价/时段/计价——注入 fake fetch 无挂载。
 *
 * Part B —— 真实 Chat 中的 /balance 交互（xterm headless）：
 *  - 输入 /balance 触发恰好一次 balanceInfo，摘要行出现；
 *  - hover 摘要行展开明细（币种拆分、token/花费估算、刷新与关闭 chip）；
 *  - 点击摘要行重新查询；点击 × 关闭报告；
 *  - 失败态（认证失败）摘要与 hover 原因展示。
 *
 * Run: node --import tsx/esm scripts/verify-balance.tsx
 */
process.env.FORCE_COLOR = '3'
process.env.DSH_TUI_THEME = 'dark'
process.env.DSH_TUI_LANG = 'zh'

const [
  { PassThrough, Writable },
  React,
  { Terminal: XTerm },
  { render, AlternateScreen },
  { Chat },
  { setLang },
  { settle, screenHas, findText, viewportLines, sleep },
  { stringWidth },
] = await Promise.all([
  import('node:stream'),
  import('react'),
  import('@xterm/headless'),
  import('../src/ui.js'),
  import('../src/screens/Chat.js'),
  import('../src/i18n.js'),
  import('./lib/term-test.mjs'),
  import('../src/ink/stringWidth.js'),
])

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${name}${detail === '' ? '' : `  (${detail})`}`)
  if (!condition) failures += 1
}

const COLS = 100
const ROWS = 30
const term = new XTerm({ cols: COLS, rows: ROWS, scrollback: 0, allowProposedApi: true })

/** 视口纯文本（join 后做 includes 断言）。 */
function screenText(target: XTerm): string {
  return viewportLines(target, ROWS).join('\n')
}

class FakeStdout extends Writable {
  columns = COLS
  rows = ROWS
  isTTY = true
  _write(chunk: unknown, _encoding: BufferEncoding, callback: () => void) {
    term.write(String(chunk), callback)
  }
}

class FakeStderr extends Writable {
  isTTY = true
  _write(_chunk: unknown, _encoding: BufferEncoding, callback: () => void) { callback() }
}

class FakeStdin extends PassThrough {
  isTTY = true
  setRawMode() { return this }
  ref() { return this }
  unref() { return this }
}

/** SGR hover 注入（1-indexed）。 */
const hover = (col: number, row: number) => stdin.write(`\x1b[<35;${col};${row}M`)
/** SGR 点击注入：press+release 同一单元格（1-indexed）。 */
const clickCell = (col: number, row: number) => {
  stdin.write(`\x1b[<0;${col};${row}M`)
  stdin.write(`\x1b[<0;${col};${row}m`)
}

/**
 * findText 的 col 是 JS 字符索引；SGR 鼠标坐标按显示列（CJK 宽字符
 * 占 2 列）。把字符索引换算成显示列。
 */
function cellOf(target: XTerm, pos: { col: number; row: number }): { col: number; row: number } {
  const line = viewportLines(target)[pos.row] ?? ''
  return { col: stringWidth(line.slice(0, pos.col)), row: pos.row }
}

function makeChannel() {
  const listeners = new Set<() => void>()
  let balanceCalls = 0
  let nextRowId = 3
  const channel: any = {
    version: 0,
    rows: [
      { id: 1, kind: 'user', text: '检查这个问题' },
      { id: 2, kind: 'assistant', text: '已经检查。', streaming: false },
    ],
    status: 'idle',
    sessionTitle: '我的会话',
    sessionColor: '',
    autoRecapOnOpen: false,
    agentId: 'probe',
    model: 'deepseek-v4-flash',
    provider: 'deepseek',
    tokens: {
      input: 1234,
      output: 5678,
      cacheRead: 900,
      cacheWrite: 100,
      peak: { input: 400, output: 2000, cacheRead: 300, cacheWrite: 40 },
      idle: { input: 834, output: 3678, cacheRead: 600, cacheWrite: 60 },
    },
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
    notifications: [],
    contextWindow: undefined,
    reasoningEffort: 'max',
    activityEnabled: false,
    contextBarEnabled: true,
    agentPreset: 'standard',
    goal: undefined,
    todos: [],
    commandList: [
      { name: 'balance', description: 'Show DeepSeek account balance' },
      { name: 'cost', description: 'Show session token usage' },
      { name: 'status', description: 'Show session status' },
    ],
    commandCompletions() { return [] },
    contextSegments: { system: 0, prompt: 0, assistant: 0, thinking: 0, tools: 0 },
    mode: { id: 'default', plan: false, sandbox: 'workspace-write', approval: 'ask' },
    modeIndex: 0,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    notify() {},
    pushLocal() {},
    renameSession() {},
    balanceInfo: async () => {
      balanceCalls += 1
      return balanceResult
    },
    emit() {
      channel.version += 1
      for (const listener of listeners) listener()
    },
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
    pluginsInfo: () => [],
    listSubagents: async () => [],
    listPresets: async () => [],
    switchPreset: async () => false,
    switchModel: async () => false,
    rewindTo: async () => null,
    resumeTo: async () => ({ ok: false, reason: 'unavailable' }),
    newSession: async () => false,
    compact() {},
    traceEvents: () => [],
    settingsSections: () => [],
    subscribeSettingsSections: () => () => {},
    get balanceCalls() { return balanceCalls },
  }
  return channel
}

setLang('zh')
const stdin = new FakeStdin()
/** 可变的查询结果：主实例先跑成功态，再切失败态复测（避免双渲染实例）。 */
let balanceResult: import('../src/deepseekBalance.js').BalanceResult = {
  ok: true,
  isAvailable: true,
  balances: [{ currency: 'CNY', total: 110, granted: 10, toppedUp: 100 }],
}
const channel = makeChannel()
const questionStore = { subscribe: () => () => {}, getSnapshot: () => null, answerCurrent: () => {} }
const approvalStore = { subscribe: () => () => {}, getSnapshot: () => null }
const instance = await render(
  <AlternateScreen>
    <Chat
      fullscreen
      channel={channel}
      questionStore={questionStore as any}
      approvalStore={approvalStore as any}
    />
  </AlternateScreen>,
  {
    stdout: new FakeStdout(),
    stderr: new FakeStderr(),
    stdin,
    exitOnCtrlC: false,
    patchConsole: false,
  },
)

// ── 1. /balance 触发查询：摘要行出现，balanceInfo 恰好一次 ──────────────
// 输入分两步（同 verify-session-color-recap）：先写文本并等上屏确认，
// 再写回车——整块 `/balance\r` 在 prompt 就绪前写入会丢回车。
stdin.write('/balance')
await settle(() => screenText(term).includes('/balance'))
stdin.write('\r')
await settle(() => screenHas(term, 'DeepSeek 余额 ¥110.00'))
check('摘要行显示余额', screenHas(term, 'DeepSeek 余额 ¥110.00'))
check('触发恰好一次 balanceInfo', channel.balanceCalls === 1, String(channel.balanceCalls))
check('摘要行不可用标记未出现', !screenHas(term, '查询失败'))

// ── 2. hover 摘要行：明细与操作 chip 出现 ────────────────────────────────
const summaryPos = findText(term, 'DeepSeek 余额 ¥110.00')
check('摘要行在视口内', summaryPos !== null)
if (summaryPos !== null) {
  const cell = cellOf(term, summaryPos)
  hover(cell.col + 1, cell.row + 1)
}
await settle(() => screenHas(term, '总额 ¥110.00'))
check('hover 显示币种拆分', screenHas(term, '总额 ¥110.00') && screenHas(term, '赠送 ¥10.00') && screenHas(term, '充值 ¥100.00'))
check('hover 显示 token 与花费估算', screenHas(term, '本会话 tokens 1.2k in → 5.7k out · ≈¥'))
check('hover 显示刷新 chip', screenHas(term, '点击刷新'))
check('hover 显示关闭 chip', screenHas(term, '×'))
check('hover 显示口径说明', screenHas(term, '余额查询免费'))

// ── 3. 点击 × 关闭报告（在 hover 状态新鲜时进行） ───────────────────────
{
  const closePos = findText(term, '×')
  check('关闭 chip 在视口内', closePos !== null)
  if (closePos !== null) {
    const cell = cellOf(term, closePos)
    clickCell(cell.col + 1, cell.row + 1)
  }
  await settle(() => !screenHas(term, 'DeepSeek 余额'))
  check('点击 × 关闭报告', !screenHas(term, 'DeepSeek 余额'))
}

// ── 4. 重新触发后点击摘要行：重新查询 ───────────────────────────────────
stdin.write('/balance')
await settle(() => screenText(term).includes('/balance'))
stdin.write('\r')
await settle(() => screenHas(term, 'DeepSeek 余额 ¥110.00'))
check('重新触发后摘要恢复', screenHas(term, 'DeepSeek 余额 ¥110.00'))
check('累计两次 balanceInfo', channel.balanceCalls === 2, String(channel.balanceCalls))
{
  const refreshPos = findText(term, 'DeepSeek 余额 ¥110.00')
  if (refreshPos !== null) {
    const cell = cellOf(term, refreshPos)
    hover(cell.col + 1, cell.row + 1)
    await settle(() => screenHas(term, '点击刷新'))
    clickCell(cell.col + 1, cell.row + 1)
  }
}
await settle(() => channel.balanceCalls >= 3)
check('点击摘要行重新查询', channel.balanceCalls === 3, String(channel.balanceCalls))
await settle(() => screenHas(term, 'DeepSeek 余额 ¥110.00'))
check('刷新后摘要仍在', screenHas(term, 'DeepSeek 余额 ¥110.00'))

// ── 5. 失败态：认证失败摘要与 hover 原因（复用主实例） ──────────────────
{
  balanceResult = { ok: false, reason: 'unauthorized', status: 401 }
  stdin.write('/balance')
  await settle(() => screenText(term).includes('/balance'))
  stdin.write('\r')
  await settle(() => screenHas(term, '查询失败'))
  check('失败态摘要', screenHas(term, 'DeepSeek 余额 · 查询失败'))
  const failPos = findText(term, 'DeepSeek 余额 · 查询失败')
  if (failPos !== null) {
    const cell = cellOf(term, failPos)
    // stale-hover 抑制：鼠标停在同一位置时新状态不触发 onMouseEnter，
    // 先移开再移回（verify-auto-recap 同款解药）。
    hover(1, 1)
    await sleep(100) // 固定窗:pacing 移开与移回两次 hover 事件之间的步间等待
    hover(cell.col + 1, cell.row + 1)
    await settle(() => screenHas(term, '认证失败'))
    check('失败态 hover 显示原因', screenHas(term, '认证失败'))
    check('失败态 hover 显示重试', screenHas(term, '点击重试'))
  } else {
    check('失败态 hover 显示原因', false, '摘要行不在视口')
  }
  // 收尾：鼠标移开，避免残留 hover。
  hover(1, 1)
}

// 收尾：unmount 释放渲染实例，否则事件循环挂着进程不退（曾在 CI 挂起
// 20min+，靠 per-entry timeout 兜底杀——漏 unmount 是根因）。
await instance.unmount()

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('\nAll balance/cost checks passed')
