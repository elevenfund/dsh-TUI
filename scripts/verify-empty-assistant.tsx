/**
 * verify-empty-assistant — PR #383 的重复圆点 bug 回归：
 * 模型直接调工具（不产文本）时 assistant/message 产生空文本行，渲染为
 * 工具卡上方的孤立 `●`。过滤发生在 visibleRows 管线（虚拟化之前）。
 *
 * 断言：
 *  1. 空 settled assistant 行被过滤——不出现孤立 ● 行（● 后无内容）；
 *  2. 前后的工具卡与真实正文不受影响；
 *  3. 空文本但 streaming 的 assistant 行保留（占位防跳动）但无 live dot
 *     （grok 式：无内容即不可见，回答活动由底部状态行承载）；
 *  4. 落定翻转（streaming true→false 原地写、rows 身份不变）后过滤生效；
 *  5. 用户/通知等其他空文本行不受影响（kind 限定 assistant）。
 *
 * 运行：node --import tsx/esm scripts/verify-empty-assistant.tsx
 */
process.env.FORCE_COLOR = '3'
process.env.DSH_TUI_THEME = 'dark'
process.env.DSH_TUI_LANG = 'zh'

const [{ PassThrough, Writable }, React, { Terminal: XTerm }, { render, AlternateScreen }, { Chat }, { QuestionStore }, { LOCAL_COMMANDS, completeCommands }, { settled, sleep }] = await Promise.all([
  import('node:stream'),
  import('react'),
  import('@xterm/headless'),
  import('../src/ui.js'),
  import('../src/screens/Chat.js'),
  import('../src/dsh-adapter/questions.js'),
  import('../src/commands.js'),
  import('./lib/term-test.mjs'),
])

const COLS = 100, ROWS = 40
let failed = 0
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failed += 1
}

const term = new XTerm({ cols: COLS, rows: ROWS, scrollback: 0, allowProposedApi: true })
class FakeStdout extends Writable {
  columns = COLS; rows = ROWS; isTTY = true
  _write(chunk: unknown, _e: BufferEncoding, cb: () => void) { term.write(String(chunk), cb) }
}
class FakeStderr extends Writable { isTTY = true; _write(_c: unknown, _e: BufferEncoding, cb: () => void) { cb() } }
class FakeStdin extends PassThrough {
  isTTY = true
  setRawMode() { return this }
  ref() { return this }
  unref() { return this }
}
const stdin = new FakeStdin(), stdout = new FakeStdout(), stderr = new FakeStderr()

function screenLines(): string[] {
  const buf = term.buffer.active
  return Array.from({ length: ROWS }, (_, y) => buf.getLine(buf.baseY + y)?.translateToString(true) ?? '')
}
/** 孤立 ● 行：以 ● 开头、后面只有空白。 */
function loneDotLines(lines: string[]): string[] {
  return lines.filter(l => /^●\s*$/.test(l))
}

const rows: any[] = [
  { id: 0, kind: 'user', text: '帮我跑一下测试' },
  // 空文本 settled assistant（PR #383 的 bug 形状：模型直接调工具）
  { id: 1, kind: 'assistant', text: '', streaming: false },
  // 叙述-only settled assistant（narrate 契约：⏵ 行 + 直接调工具）。
  // 原文非空但渲染层 stripNarration 剥成空——旧过滤器测原文漏放行，
  // 渲染成工具卡上方的孤立 ●（用户实测报告的形状）。
  { id: 6, kind: 'assistant', text: '⏵ 正在跑测试', streaming: false },
  { id: 2, kind: 'tool', text: '', tool: { callId: 't1', name: 'Bash', argsText: '{"command": "npm test"}', argsFull: '{}', status: 'ok', startedAt: 0, durationMs: 42, resultText: 'all 12 tests passed' } },
  // ⏵ 行 + 正文：叙述被剥但正文必须完整保留（不能误过滤）
  { id: 7, kind: 'assistant', text: '⏵ 正在分析结果\n\n工具结果看起来全部通过 REALBODY2-END', streaming: false },
  { id: 3, kind: 'assistant', text: '测试全部通过，共 12 项。REALBODY-END', streaming: false },
  // 空文本但 streaming：必须保留（live dot）
  { id: 4, kind: 'assistant', text: '', streaming: true },
]

const listeners = new Set<() => void>()
const channel: any = {
  // 探针确定性：鲸鱼欢迎期闲置动画（默认开）不进本探针的测量窗口。
  whaleIdle: false,
  version: 0, rows, status: 'idle', sessionTitle: 'probe', agentId: 'probe',
  model: 'deepseek-v4-flash', provider: 'deepseek', reasoningEffort: 'max', effortLevels: [],
  tokens: { input: 0, output: 0 }, cwd: '/tmp/demo', displayCwd: '/tmp/demo', gitBranch: 'main',
  working: true, spinnerMode: 'requesting', responseChars: 0, activeToolCount: 1, turnStart: Date.now(),
  pending: [], commandList: LOCAL_COMMANDS, notifications: [], mode: { plan: false, sandbox: undefined },
  activityFrames: 'moon8', agentPreset: undefined, subagents: [], lastUserText: '帮我跑一下测试',
  scrollGutter: 'timeline', whale: true,
  subscribe(cb: () => void) { listeners.add(cb); return () => listeners.delete(cb) },
  emit() { channel.version++; for (const cb of listeners) cb() },
  submit: () => {}, cancel: () => {}, clear: () => {}, notify: () => {},
  listModels: () => Promise.resolve([]), listSessions: () => Promise.resolve([]),
  deleteSession: () => Promise.resolve(true), renameSessionTo: () => Promise.resolve(true),
  setResumeTarget: () => {}, loadOlder: () => {}, mcpStatus: () => [], pushLocal: () => {},
  commandCompletions: (input: string) => completeCommands(input),
}

const inst = await render(
  <AlternateScreen><Chat channel={channel} questionStore={new QuestionStore()} fullscreen /></AlternateScreen>,
  { stdout: stdout as any, stdin: stdin as any, stderr: stderr as any, exitOnCtrlC: false, patchConsole: false },
)
{
  // 正向条件各自 settled；负向（孤立 ●/⏵ 不出现）在正向全部落定后的
  // 同帧同步判定——对空帧轮询「不存在」会立即真、等于没测。
  check('工具卡正常渲染（narration 意图标题，grok 式无裸工具名）', await settled(() => screenLines().some(l => l.includes('正在跑测试'))), '')
  check('真实正文正常渲染', await settled(() => screenLines().join('\n').includes('REALBODY-END')), '')
  check('⏵ 行 + 正文混合行保留正文', await settled(() => screenLines().join('\n').includes('REALBODY2-END')), '')
  check('空文本 streaming 行无 live dot（grok 式：无内容即不可见，正文到达才渲染）', await settled(() => {
    const ls = screenLines()
    return loneDotLines(ls).length === 0 && ls.join('\n').includes('REALBODY-END')
  }), '')
  const lines = screenLines()
  const screen = lines.join('\n')
  // bug 形状：工具卡【上方】的孤立 ●（空 settled assistant）。assistant
  // 行已无行首符号（grok 式），该形状在源头消失——保留防线断言。
  const toolRow = lines.findIndex(l => l.includes('正在跑测试'))
  const dotAboveTool = toolRow >= 0 && lines.slice(0, toolRow).some(l => /^●\s*$/.test(l))
  check('空 settled assistant 行被过滤（工具块上方无孤立 ●）', !dotAboveTool,
    `toolRow=${toolRow}`)
  // ⏵ 叙述行的归宿（tool-blocks 落地后）：绑定进其后第一个工具块的
  // 标题行渲染（grok 式意图句，无裸工具名、无 ⏵ 前缀），assistant 行本身
  // 渲染空、被空行过滤收走——断言语义为「叙述文字出现在工具块行
  // （◆ 前缀）且不带 ⏵」。
  const toolBlockLine = lines.find(l => l.includes('正在跑测试'))
  const narrationInBlockTitle = toolBlockLine !== undefined && toolBlockLine.includes('◆') && !toolBlockLine.includes('⏵')
  check('叙述-only 行并入工具块标题（◆ 块行内无 ⏵ 前缀，上方无孤立 ●）', narrationInBlockTitle && !dotAboveTool,
    `blockLine=${toolBlockLine ?? 'none'}`)
}

// 落定翻转：streaming true → false 原地写（rows 身份/长度不变）。
// 按 id 定位流式行——数组顺序在该脚本演化过，索引翻转曾错翻到别的行。
const streamRow = rows.find(r => r.id === 4)!
streamRow.streaming = false
channel.emit()
{
  check('落定翻转后空 assistant 行被过滤（缓存流位指纹生效）', await settled(() => loneDotLines(screenLines()).length === 0),
    `lone dots=${loneDotLines(screenLines()).length}`)
  check('翻转后真实正文仍在', screenLines().join('\n').includes('REALBODY-END'), '')
}
// 用户空文本行不受影响（kind 限定）：一个空 user 行仍渲染其气泡形状
rows.push({ id: 5, kind: 'user', text: '' })
channel.emit()
// 固定窗:探针 断言界面仍存活；❯ 在 emit 前就在屏上，轮询会立即返回，
// 测不到「没有崩掉」——留一个观察窗让潜在崩溃显形。
await sleep(400)
check('空 user 行不受 assistant 过滤影响（无崩溃、界面存活）', screenLines().some(l => l.includes('❯')))

await inst.unmount()
console.log(failed === 0 ? '\nALL PASS' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
