/**
 * Verification of the plugin UI seams (dsh-tui-extensions): managed dialogs,
 * status line, keyboard shortcuts, custom entry renderers.
 *
 * The store units (FIFO queueing, AbortSignal, timeout, settleAll, keyed
 * text + rich status semantics), the runtime units over a REAL cordis
 * context (input validation warn-never-throw, sanitization, shortcut
 * parse/match/register/dispatch, renderer registration refusals + sticky
 * failure logging), and the decision-guard grant battery are asserted
 * without a mount in verify-extension-units.ts (T0). This file keeps the
 * cordis host wired up and mounts the Chat UI integration (fake channel,
 * REAL stores/runtimes): select / confirm / input dialogs render and
 * settle from the keyboard, FIFO drain, Esc cancel, the status line
 * appears/clears, and a plugin shortcut consumes its keypress through
 * Chat's dispatch chain; rich status views receive only the bounded
 * host-render kit (including local captured drag) and isolate a throwing
 * component.
 *
 * Run: node --import tsx/esm scripts/verify-extension-ui.tsx
 */
process.env.FORCE_COLOR = '3'
// 断言针对中文 i18n 文案（对话框标题/状态行标记），与运行环境的 locale 无关。
process.env.DSH_TUI_LANG = 'zh'

// 家目录隔离（同 verify-extension-events.tsx）：Chat 加载即解析 homedir()。
const { mkdtempSync, mkdirSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join: joinPath } = await import('node:path')
const isolatedHome = mkdtempSync(joinPath(tmpdir(), 'dshtui-ext-ui-home-'))
process.env.HOME = isolatedHome
process.env.USERPROFILE = isolatedHome
mkdirSync(joinPath(isolatedHome, '.dsh-tui'), { recursive: true })

const [
  { PassThrough, Writable },
  React,
  { Context },
  { render },
  { Chat },
  { QuestionStore },
  { TuiDialogRuntime, getHostDialogStore, INPUT_CELLS },
  { TuiStatusRuntime, getHostStatusStore },
  { TuiShortcutRuntime, getHostShortcuts },
  { TuiRendererRuntime, getHostRenderers },
  { stringWidth },
  { KNOWN_SESSION_EVENT_TYPES },
  { keySleep, settle, settled, sleep },
] = await Promise.all([
  import('node:stream'),
  import('react'),
  import('@deepseek-ai/cordis'),
  import('../src/ui.js'),
  import('../src/screens/Chat.js'),
  import('../src/dsh-adapter/questions.js'),
  import('../src/dsh-adapter/dialogs.js'),
  import('../src/dsh-adapter/status.js'),
  import('../src/dsh-adapter/shortcuts.js'),
  import('../src/dsh-adapter/renderers.js'),
  import('../src/ink/stringWidth.js'),
  import('@deepseek-ai/dsh-session'),
  import('./lib/term-test.mjs'),
])

class FakeStdout extends Writable {
  columns = 100
  rows = 28
  isTTY = true
  frames: string[] = []
  _write(chunk: unknown, _encoding: BufferEncoding, callback: () => void) {
    this.frames.push(String(chunk))
    callback()
  }
}

class FakeStderr extends Writable {
  isTTY = true
  _write(_chunk: unknown, _encoding: BufferEncoding, callback: () => void) {
    callback()
  }
}

class FakeStdin extends PassThrough {
  isTTY = true
  setRawMode() { return this }
  ref() { return this }
  unref() { return this }
}

const plainText = (frames: string[]) => frames
  .join('')
  .replace(/\x1b\[(\d+)C/g, (_, n) => ' '.repeat(Number(n)))
  .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
  .replace(/\x1b\]9;[^\x07]*\x07/g, '')
  .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')

let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === '' ? '' : ` — ${detail}`}`)
}

/** Real cordis context + captured warnings (runtime refusals warn, never throw). */
const ctx = new Context()
const warnings: string[] = []
ctx.logger.warn = (format: unknown, ...params: unknown[]) => {
  warnings.push([format, ...params].map(String).join(' '))
}
const warnCount = (fragment: string) => warnings.filter(line => line.includes(fragment)).length

// --- Parts A/B/B2 live in verify-extension-units.ts (T0, no mount) ----
// --- The cordis host setup below feeds the mounted sections. ----------
// ── B. runtime units over real cordis ────────────────────────────────────
ctx.plugin(TuiDialogRuntime)
ctx.plugin(TuiStatusRuntime)
ctx.plugin(TuiShortcutRuntime)
ctx.plugin(TuiRendererRuntime)
await settle(() => ctx.get('tuiDialogs') !== undefined && ctx.get('tuiStatus') !== undefined
  && ctx.get('tuiShortcuts') !== undefined && ctx.get('tuiRenderers') !== undefined)

// Plugin-facing extension calls must originate from a live child activation.
// Calling these services through the composition root would bind effects to
// the host lifetime and is intentionally rejected by the runtime.
let pluginCtx: Context | undefined
const pluginFiber = ctx.plugin({
  name: 'ui-extension-probe',
  inject: ['tuiDialogs', 'tuiStatus', 'tuiShortcuts', 'tuiRenderers'],
  apply: (candidate: Context) => {
    pluginCtx = candidate
  },
})
await settle(() => pluginCtx !== undefined)
if (pluginCtx === undefined) {
  await Promise.resolve(pluginFiber.dispose())
  throw new Error('UI extension probe did not start')
}

const dialogStore = getHostDialogStore(ctx.tuiDialogs)
const statusStore = getHostStatusStore(ctx.tuiStatus)
const shortcutHost = getHostShortcuts(ctx.tuiShortcuts)
const rendererHost = getHostRenderers(ctx.tuiRenderers)
if (dialogStore === undefined || statusStore === undefined || shortcutHost === undefined || rendererHost === undefined) {
  throw new Error('extension host accessors were not initialized')
}

const plugin = pluginCtx

// The closing lifecycle check observes this renderer: the type must be
// in the live event-type set at registration time (the denylist is a
// module-load snapshot); the registration assertions live in
// verify-extension-units.ts.
KNOWN_SESSION_EVENT_TYPES.add('my-plugin/persisted')
plugin.tuiRenderers.register('my-plugin/persisted', () => ({ lines: ['已登记'] }))
KNOWN_SESSION_EVENT_TYPES.delete('my-plugin/persisted')

// ── C. Chat UI integration ───────────────────────────────────────────────
const LOCAL_COMMANDS: never[] = []
function makeChannel() {
  return {
    version: 0,
    rows: [],
    status: 'idle' as const,
    sessionTitle: 'probe',
    agentId: 'probe',
    model: 'model-00',
    provider: 'fake-provider',
    tokens: { input: 0, output: 0 },
    cwd: '/tmp/demo',
    displayCwd: '/tmp/demo',
    gitBranch: 'main',
    working: false,
    spinnerMode: 'requesting' as const,
    responseChars: 0,
    activeToolCount: 0,
    mode: { id: 'default', plan: false },
    modeIndex: 0,
    cycleMode() {},
    turnStart: 0,
    lastUserText: '',
    pending: [],
    commandList: LOCAL_COMMANDS,
    notifications: [],
    contextSegments: { system: 0, prompt: 0, assistant: 0, thinking: 0, tools: 0 },
    subscribe: () => () => {},
    submitCalls: [] as string[],
    submit(text: string) { this.submitCalls.push(text) },
    steer() {},
    cancel() {},
    clear() {},
    notify() {},
    listModels: () => Promise.resolve([]),
    listSessions: () => [],
    setResumeTarget: () => {},
  }
}

const channel = makeChannel()
const stdout = new FakeStdout()
const stdin = new FakeStdin()
const instance = await render(
  <Chat
    channel={channel as never}
    questionStore={new QuestionStore()}
    onExit={() => {}}
    extensionDialogs={dialogStore}
    extensionStatus={statusStore}
    extensionShortcuts={shortcutHost}
  />,
  { stdout, stdin, stderr: new FakeStderr(), exitOnCtrlC: false, patchConsole: false },
)
// 首帧挂载不再固定等待：第一个键盘交互（↓）之前，下方 select 断言的
// settled 已等到对话框标题+选项上屏——对话框组件挂载即其输入监听挂接。
const screen = (back = 30) => plainText(stdout.frames.slice(-back))

// Select: ↓ + Enter picks the second option.
{
  const pending = plugin.tuiDialogs.select({
    title: '挑一个',
    options: [
      { id: 'first', label: '第一项' },
      { id: 'second', label: '第二项', description: '带描述' },
    ],
  })
  check('ui: select dialog renders title + options',
    await settled(() => screen().includes('挑一个') && screen().includes('第二项')), screen().slice(-200))
  stdin.write('\x1b[B')
  // 键间：等上一键的选中态 commit 再发下一键（选中高亮是颜色，ANSI 洗净后
  // 无可观测条件；keySleep 免 PACE 压缩以保每键一 commit 的 latch）。
  await keySleep(150)
  stdin.write('\r')
  check('ui: select ↓+Enter resolves the second id', (await pending) === 'second')
  check('ui: dialog closed after settle', await settled(() => dialogStore.getSnapshot() === null))
}

// FIFO: the second dialog waits for the first to settle. Confirm: Enter = yes.
{
  const first = plugin.tuiDialogs.confirm({ title: '确认一下', message: '要做吗' })
  const second = plugin.tuiDialogs.select({ title: '排队的选择', options: [{ id: 'only', label: '唯一' }] })
  check('ui: confirm renders with message + localized defaults',
    await settled(() => screen().includes('确认一下') && screen().includes('要做吗')), screen().slice(-200))
  check('ui: FIFO — second dialog still queued', dialogStore.getSnapshot()?.kind === 'confirm')
  stdin.write('\r') // Enter on 是 → true
  check('ui: confirm Enter resolves true', (await first) === true)
  check('ui: queued select now active',
    await settled(() => screen().includes('排队的选择')), screen().slice(-200))
  stdin.write('\x1b') // Esc cancels the select
  check('ui: Esc cancels → undefined', (await second) === undefined)
}

// Input: placeholder shown when empty; typed text resolves.
{
  const pending = plugin.tuiDialogs.input({ title: '说点什么', placeholder: '占位提示', initial: '' })
  check('ui: input dialog renders placeholder', await settled(() => screen().includes('占位提示')), screen().slice(-200))
  // 固定窗:pacing 逐字符按键间（同上，无可观测条件）。
  for (const ch of '你好') { stdin.write(ch); await sleep(60) }
  stdin.write('\r')
  check('ui: input Enter resolves the typed text', (await pending) === '你好')
}

// Input with initial: pre-filled, edited, submitted.
{
  const pending = plugin.tuiDialogs.input({ title: '改改', initial: '原文' })
  await settle(() => screen().includes('原文'))
  stdin.write('\x7f') // backspace removes 文
  // 键间（同上）。
  await keySleep(150)
  stdin.write('\r')
  check('ui: input initial pre-fills and edits', (await pending) === '原')
}

// Bracketed paste: a chunk that is all line breaks is TEXT, not an Enter
// press (the parsed key carries isPasted; modal confirms must survive it) —
// the confirm must not fire on its default Yes focus.
{
  const pending = plugin.tuiDialogs.confirm({ title: '粘贴确认' })
  await settle(() => screen().includes('粘贴确认'))
  stdin.write('\x1b[200~\r\n\r\n\x1b[201~')
  // 固定窗:探针 对话框不得被粘贴确认掉：条件在粘贴前就成立，轮询会
  // 立即返回，测不到「没被误触」。
  await sleep(250)
  check('ui: pure-newline paste does NOT confirm the dialog',
    dialogStore.getSnapshot()?.kind === 'confirm')
  stdin.write('\x1b') // cleanup: Esc cancels it
  const resolvedPasteConfirm = await pending
  check('ui: paste-surviving dialog cancels normally', resolvedPasteConfirm === false, JSON.stringify(resolvedPasteConfirm))
}

// Bracketed paste into the single-line input: newlines/control chars are
// flattened, and the whole value is capped at INPUT_CELLS cells so the
// resolved answer keeps the documented ≤500-cell bound.
{
  const pending = plugin.tuiDialogs.input({ title: '粘贴输入', initial: '' })
  // 固定窗:pacing 排序等待：增量渲染只重绘变化单元格（标题与上一面板共享 '粘贴' 两格），
  // 帧窗里凑不出完整标题可供 settle。
  await sleep(300)
  const chunk = '多行\n粘贴\x07' + '长'.repeat(600)
  stdin.write(`\x1b[200~${chunk}\x1b[201~`)
  // 键间：等整段粘贴落入输入值再发 Enter（同上，无可观测条件）。
  await keySleep(250)
  stdin.write('\r')
  const resolved = await pending
  // eslint-disable-next-line no-control-regex -- asserting the absence of control chars
  check('ui: paste flattened to one line (no control chars survive)',
    resolved !== undefined && !/[\x00-\x1f\x7f-\x9f]/u.test(resolved), JSON.stringify(resolved?.slice(0, 30)))
  check('ui: paste capped at INPUT_CELLS cells',
    resolved !== undefined && stringWidth(resolved) <= INPUT_CELLS, String(resolved?.length))
}

// A typed keystroke past the cap is ignored (the panel never grows beyond
// INPUT_CELLS even without paste).
{
  const nearCap = '字'.repeat(250) // 500 cells exactly (wide chars)
  const pending = plugin.tuiDialogs.input({ title: '顶格输入', initial: nearCap })
  // 固定窗:pacing 排序等待：同上，增量重绘下标题片段化，无可靠的屏幕观察点。
  await sleep(300)
  stdin.write('x')
  // 固定窗:探针 超上限按键必须被忽略：值不得变化，轮询等于没测——
  // 观察窗让误收的 x 有时间落地。
  await sleep(150)
  stdin.write('\r')
  check('ui: typing past the cell cap is ignored',
    (await pending) === nearCap)
}

// Batched keys in ONE stdin chunk: a terminal delivers a chunk as several
// key events inside a single React batch, so state queued by the first
// event is invisible to the second. The handlers must act on synchronously
// updated state (refs): ↓+Enter settles the NEW focus, not the stale one.
{
  const pending = plugin.tuiDialogs.select({
    title: '同批选择',
    options: [
      { id: 'first', label: '第一项' },
      { id: 'second', label: '第二项' },
    ],
  })
  await settle(() => screen().includes('同批选择'))
  stdin.write('\x1b[B\r') // Down + Enter in one chunk
  check('ui: batched ↓+Enter settles the NEW focus, not the stale one',
    (await pending) === 'second')
  // 固定窗:pacing 面板收起重绘：下一面板标题在增量重绘下会片段化，无可靠观察点。
  await sleep(200)
}
{
  const pending = plugin.tuiDialogs.confirm({ title: '同批确认' })
  await settle(() => screen().includes('同批确认'))
  stdin.write('\x1b[C\r') // Right + Enter in one chunk → focus 否 → false
  check('ui: batched →+Enter settles the moved focus', (await pending) === false)
  // 固定窗:pacing 面板收起重绘（同上）。
  await sleep(200)
}
// Two Backspaces in one chunk must BOTH delete (each seeing the other's
// result), not compute from the same stale base.
{
  const pending = plugin.tuiDialogs.input({ title: '同批退格', initial: 'abcd' })
  await settle(() => screen().includes('同批退格'))
  stdin.write('\x7f\x7f')
  // 键间（同上）。
  await keySleep(150)
  stdin.write('\r')
  check('ui: batched Backspace×2 deletes both characters', (await pending) === 'ab')
}

// Code-point editing: an emoji is ONE step — Backspace removes the whole
// surrogate pair (never a lone half), and arrow keys never land the cursor
// inside a pair.
{
  const pending = plugin.tuiDialogs.input({ title: '表情退格', initial: 'a😊b' })
  // 固定窗:pacing 排序等待：同上，增量重绘下标题片段化，无可靠的屏幕观察点。
  await sleep(300)
  stdin.write('\x1b[D') // left: cursor between 😊 and b
  await keySleep(120) // 键间（同上）
  stdin.write('\x7f') // backspace deletes the whole emoji
  await keySleep(120) // 键间（同上）
  stdin.write('\r')
  check('ui: Backspace deletes a whole emoji (no lone surrogate)',
    (await pending) === 'ab')
}
{
  const pending = plugin.tuiDialogs.input({ title: '表情清空', initial: '😊' })
  // 固定窗:pacing 排序等待：同上，增量重绘下标题片段化，无可靠的屏幕观察点。
  await sleep(300)
  stdin.write('\x7f') // single backspace at end of the sole emoji
  await keySleep(150) // 键间（同上）
  stdin.write('\r')
  check('ui: Backspace on the sole emoji empties the value', (await pending) === '')
}
{
  const pending = plugin.tuiDialogs.input({ title: '表情步进', initial: '😊x' })
  // 固定窗:pacing 排序等待：同上，增量重绘下标题片段化，无可靠的屏幕观察点。
  await sleep(300)
  // Left ×2 from the end: code-point steps land BEFORE the emoji (a UTF-16
  // step would park the cursor mid-surrogate and split the pair on insert).
  stdin.write('\x1b[D\x1b[D')
  await keySleep(120) // 键间（同上）
  stdin.write('z')
  await keySleep(120) // 键间（同上）
  stdin.write('\r')
  check('ui: arrow keys step by code point (insert never splits a pair)',
    (await pending) === 'z😊x')
}

// Status line: appears on set, disappears on clear.
{
  plugin.tuiStatus.set('demo-plugin', '构建中 42%')
  check('ui: status line renders the contribution',
    await settled(() => screen().includes('构建中 42%')), screen().slice(-300))
  // The incremental renderer only writes diffs: after the clear, assert on
  // frames written FROM the clear on — earlier frames legitimately still
  // contain the set text.
  const mark = stdout.frames.length
  plugin.tuiStatus.set('demo-plugin', undefined)
  // 固定窗:探针 清除后的重绘不得再含该文案：mark 之后暂无新帧时条件
  // 空洞成立，轮询会立即返回，需要一个观察窗等重绘发生。
  await sleep(300)
  check('ui: status line clears', !plainText(stdout.frames.slice(mark)).includes('构建中'))
}

// Rich status view: host React + a deliberately restricted render kit,
// external-store updates, host height clipping, disposer cleanup.
{
  let value = '播放中 · 第一首'
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  const getSnapshot = () => value
  let receivedKit = ''
  let leakedKeyEvents = 0
  const RichStatus = ({ React: HostReact, ui }: import('../src/dsh-adapter/status.js').TuiStatusViewProps) => {
    receivedKit = Object.keys(ui).sort().join(',')
    const current = HostReact.useSyncExternalStore(subscribe, getSnapshot)
    const { columns } = ui.useTerminalSize()
    return HostReact.createElement(
      ui.Box,
      {
        flexDirection: 'column',
        onClick: () => {},
        onDragStart: () => {},
        onDragMove: () => {},
        onDragEnd: () => {},
        onMouseEnter: () => {},
        onMouseLeave: () => {},
        // Untyped plugins can still send unsupported props. The host wrapper
        // must discard them at runtime, not rely on the public type alone.
        autoFocus: true,
        tabIndex: 0,
        onKeyDown: () => { leakedKeyEvents += 1 },
      } as never,
      HostReact.createElement(ui.Text, { key: 'title', color: 'rgb(80,180,255)' }, current),
      HostReact.createElement(ui.Text, { key: 'progress' }, `━━━━━━ 01:23 / 03:45 · ${columns} cols`),
      HostReact.createElement(ui.Text, { key: 'artist', dimColor: true }, '歌手 · 专辑'),
      HostReact.createElement(ui.Text, { key: 'overflow' }, 'THIS-ROW-MUST-BE-CLIPPED'),
    )
  }
  const disposeRich = plugin.tuiStatus.registerView({
    key: 'demo-plugin:rich',
    maxRows: 3,
    component: RichStatus,
  })
  const richMark = stdout.frames.length
  check('ui: rich status view renders above the prompt',
    await settled(() => {
      const output = plainText(stdout.frames.slice(richMark))
      return output.includes('播放中 · 第一首') && output.includes('歌手 · 专辑')
    }), plainText(stdout.frames.slice(richMark)).slice(-500))
  check('ui: rich status view receives only Box/Image/Text/useTerminalSize',
    receivedKit === 'Box,Image,Text,useTerminalSize', receivedKit)
  check('ui: rich status view is clipped to its declared maxRows',
    !plainText(stdout.frames.slice(richMark)).includes('THIS-ROW-MUST-BE-CLIPPED'),
    plainText(stdout.frames.slice(richMark)).slice(-500))

  stdin.write('x')
  // 固定窗:探针 negative stability probe: waiting for leakedKeyEvents === 0 would pass
  // immediately and never exercise the input dispatch.
  await sleep(200)
  check('ui: rich status Box strips focus and keyboard props at runtime',
    leakedKeyEvents === 0, String(leakedKeyEvents))
  stdin.write('\x7f')

  const updateMark = stdout.frames.length
  value = '暂停 · 第二首'
  for (const listener of listeners) listener()
  check('ui: rich status view updates through the plugin external store',
    await settled(() => plainText(stdout.frames.slice(updateMark)).includes('暂停 · 第二首')),
    plainText(stdout.frames.slice(updateMark)).slice(-500))

  disposeRich?.()
  check('ui: rich status disposer removes the registered view',
    await settled(() => statusStore.getViewSnapshot().length === 0))
}

// A third-party render crash is contained to that view. Prove Chat is still
// live by rendering a normal status contribution after the boundary fires.
{
  const before = warnCount('status view "demo-plugin:crash" crashed and was hidden')
  const disposeCrash = plugin.tuiStatus.registerView({
    key: 'demo-plugin:crash',
    component: () => {
      throw new Error('intentional rich status crash')
    },
  })
  check('ui: rich status render failure is reported once',
    await settled(() => warnCount('status view "demo-plugin:crash" crashed and was hidden') === before + 1))
  plugin.tuiStatus.set('after-rich-crash', '主界面仍然存活')
  check('ui: one crashing rich view does not take down Chat',
    await settled(() => screen().includes('主界面仍然存活')), screen().slice(-500))
  plugin.tuiStatus.set('after-rich-crash', undefined)
  disposeCrash?.()
}

// Shortcut through Chat: the keypress is consumed, the handler runs; the
// editor never sees it (no submit, no text). alt+p: not reserved, not used
// by an earlier section (a duplicate registration would be refused).
{
  let fired = 0
  plugin.tuiShortcuts.register('alt+p', { description: 'ui fire', handler: () => { fired += 1 } })
  await settle(() => plugin.tuiShortcuts.list().some(entry => entry.combo === 'alt+p'))
  stdin.write('\x1bp') // alt+p
  check('ui: plugin shortcut handler fired through Chat', await settled(() => fired >= 1), String(fired))
  check('ui: shortcut keypress never reached submit', channel.submitCalls.length === 0)
}

// A plugin dialog owns the keyboard while open: shortcuts do NOT fire.
// (Probe with alt+b — a letter combo the confirm dialog itself ignores;
// ctrl+j would arrive as \n and read as Enter.)
{
  let fired = 0
  plugin.tuiShortcuts.register('alt+b', { description: 'blocked', handler: () => { fired += 1 } })
  const pending = plugin.tuiDialogs.confirm({ title: '占键盘中' })
  await settle(() => screen().includes('占键盘中'))
  stdin.write('\x1bb') // alt+b — must not reach shortcuts while the dialog is open
  // 固定窗:探针 快捷键不得触发：fired 本就为 0，轮询会立即返回，
  // 测不到「没被触发」。
  await sleep(200)
  check('ui: open dialog gates plugin shortcuts', fired === 0)
  stdin.write('\x1b')
  check('ui: dialog Esc-cancelled after the gate check', (await pending) === false)
}

await instance.unmount()
await pluginFiber.dispose()
check('lifecycle: plugin activation dispose leaves no status contribution', statusStore.getSnapshot().length === 0)
check('lifecycle: plugin activation dispose leaves no shortcut', shortcutHost.dispatch('alt+p', { alt: true, meta: true, name: 'p' }) === false)
check('lifecycle: plugin activation dispose leaves no renderer', rendererHost.render('my-plugin/persisted', {}) === undefined)

if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}
console.log('extension UI seams verified')
process.exit(0)
