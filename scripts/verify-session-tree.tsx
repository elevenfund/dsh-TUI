/**
 * verify-session-tree — /tree 与 /fork 特性回归：
 *
 *  [模型层/读取层] 已拆至 verify-session-tree-units.ts（T0）：条目提取、
 *           回退/分叉边界、家族拼接、扁平化/过滤、compat 预算读取器。
 *  [屏幕层] SessionTree 无头组装：树渲染（标题/连接线/分支徽标）、
 *           Enter 打开操作菜单、字母直达执行分叉（经 channel 记录）、
 *           Esc 退出。
 *
 * 运行：node --import tsx/esm scripts/verify-session-tree.tsx
 */
process.env.FORCE_COLOR = '3'
process.env.DSH_TUI_THEME = 'dark'
process.env.DSH_TUI_LANG = 'zh'

const tree = await import('../src/dsh-adapter/sessionTree.js')

let failed = 0
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failed += 1
}

// ── 合成事件（scripts 不进 tsc，宽塑形即可） ─────────────────────────────
type Ev = { type: string; seq: number; time: number; data: any }
const ev = (type: string, seq: number, data: unknown): Ev =>
  ({ type, seq, time: 1000 + seq, data }) as Ev
const turnStart = (seq: number, turn: number) => ev('turn/start', seq, { turn })
const turnEnd = (seq: number, turn: number, reason: unknown) => ev('turn/end', seq, { turn, reason })
const stepEnd = (seq: number) => ev('step/end', seq, {})
const userMsg = (seq: number, text: string) =>
  ev('user/message', seq, { source: { kind: 'user' }, content: [{ type: 'text', text }] })
const assistantMsg = (seq: number, turn: number, step: number, text: string) =>
  ev('assistant/message', seq, { turn, step, message: { role: 'assistant', content: [{ type: 'text', text }] } })
const toolCall = (seq: number, callId: string, name: string, args: string) =>
  ev('tool/call', seq, { callId, name, arguments: args })
const toolResult = (seq: number, callId: string, error?: unknown) =>
  ev('tool/result', seq, { message: { source: { callId } }, ...(error === undefined ? {} : { error }) })
const title = (seq: number, text: string) => ev('session/title', seq, { title: text })

/**
 * 根会话 R 的日志：两轮完整 + 轮间标题。
 *   0 turn/start t0 · 1 user u0 · 2 step/start · 3 tool/call · 4 tool/result
 *   5 step/end · 6 assistant a0 · 7 turn/end t0
 *   8 turn/start t1 · 9 user u1 · 10 assistant a1 · 11 turn/end t1
 *   12 session/title
 */
function rootLog(): Ev[] {
  return [
    turnStart(0, 0),
    userMsg(1, 'u0-问根'),
    ev('step/start', 2, {}),
    toolCall(3, 'c1', 'bash', '{"command":"ls"}'),
    toolResult(4, 'c1'),
    stepEnd(5),
    assistantMsg(6, 0, 1, 'a0-答根'),
    turnEnd(7, 0, { kind: 'completed' }),
    turnStart(8, 1),
    userMsg(9, 'u1-第二问'),
    assistantMsg(10, 1, 0, 'a1-第二答'),
    turnEnd(11, 1, { kind: 'completed' }),
    title(12, '根会话标题'),
  ]
}

// ── 模型层：家族拼接 + 扁平化/过滤 ──────────────────────────────────────
/**
 * 家族：R（根，两轮）→ F1（seedLength 8：turn0 之后分叉，live）、
 * F2（seedLength 12：两轮之后分叉，仅一轮自有内容）。
 */
function family() {
  const f1Own: Ev[] = [
    turnStart(8, 1), userMsg(9, 'f1-新方向'), assistantMsg(10, 1, 0, 'f1-回答'), turnEnd(11, 1, { kind: 'completed' }),
  ]
  // F1 的日志 = 继承前缀(R[0..7]) + 自有
  const f1Log = [...rootLog().slice(0, 8), ...f1Own]
  const f2Own: Ev[] = [
    title(12, 'F2 分支'), turnStart(13, 2), userMsg(14, 'f2-再试'), turnEnd(15, 2, { kind: 'aborted', reason: { kind: 'user' } }),
  ]
  const f2Log = [...rootLog(), ...f2Own]
  return tree.buildSessionTree(
    [
      { id: 'R', createdAt: 1, events: rootLog(), live: false, tailComplete: true },
      { id: 'F1', createdAt: 2, parentSession: 'R', seedLength: 8, events: f1Log, live: true, tailComplete: true },
      { id: 'F2', createdAt: 3, parentSession: 'R', seedLength: 12, events: f2Log, live: false, tailComplete: true },
    ] as any,
    'F1',
  )
}

// ── 屏幕层：无头组装 ─────────────────────────────────────────────────────
{
  const [{ PassThrough, Writable }, React, { Terminal: XTerm }, { render, AlternateScreen }, { SessionTree }, { settle, settled, sleep }] = await Promise.all([
    import('node:stream'),
    import('react'),
    import('@xterm/headless'),
    import('../src/ui.js'),
    import('../src/screens/SessionTree.js'),
    import('./lib/term-test.mjs'),
  ])

  const COLS = 120, ROWS = 32
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
  const screen = (): string[] => {
    const buf = term.buffer.active
    return Array.from({ length: ROWS }, (_, y) => buf.getLine(buf.baseY + y)?.translateToString(true) ?? '')
  }
  const text = (): string => screen().join('\n')

  const data = family()
  const calls: Array<{ sessionId: string; seq: number; mode?: string }> = []
  let closed = false
  const channel: any = {
    agentId: 'F1',
    buildSessionTree: () => Promise.resolve(data),
    rewindToNode: (sessionId: string, seq: number, mode?: string) => {
      calls.push({ sessionId, seq, mode })
      return Promise.resolve(mode === 'fork' ? '' : 'f1-新方向')
    },
    notify: () => {},
  }

  const inst = await render(
    <AlternateScreen>
      <SessionTree
        channel={channel}
        currentSessionId="F1"
        onClose={() => { closed = true }}
        onRestoreText={() => {}}
      />
    </AlternateScreen>,
    { stdout: stdout as any, stdin: stdin as any, stderr: stderr as any, exitOnCtrlC: false, patchConsole: false },
  )
  check('screen: 标题渲染', await settled(() => text().includes('会话树')))
  check('screen: 树行渲染（根问句）', await settled(() => text().includes('u0-问根')))
  check('screen: fork 分支渲染（新方向）', await settled(() => text().includes('f1-新方向')))
  check('screen: 连接线渲染', await settled(() => text().includes('├─') || text().includes('└─')))
  check('screen: 预览面板渲染', await settled(() => text().includes('预览')))

  // 鼠标滚轮：SGR wheel-down 打在树区域 = 光标下移一行（光标居中窗口，
  // 滚动即跟随），wheel-up 回去——与真实全屏终端投递同构。
  {
    const wheelRow = screen().findIndex(line => line.includes('❯')) + 1 // SGR 1-indexed
    stdin.write(`\x1b[<65;10;${wheelRow}M`)
    check('screen: 鼠标滚轮下移光标一行', await settled(() => screen().findIndex(line => line.includes('❯')) === wheelRow), screen().filter(line => line.includes('❯')).join('|'))
    stdin.write(`\x1b[<64;10;${wheelRow}M`)
    check('screen: 鼠标滚轮上移回去', await settled(() => screen().findIndex(line => line.includes('❯')) === wheelRow - 1), screen().filter(line => line.includes('❯')).join('|'))
  }

  // vim 键：query 为空时 j/k 与 ↓/↑ 同步移动光标一行（h/l 与 ←/→ 走同一条
  // step 半页路径，不单独断言）。
  {
    const vimRow = screen().findIndex(line => line.includes('❯'))
    stdin.write('j')
    check('screen: j 下移光标一行', await settled(() => screen().findIndex(line => line.includes('❯')) === vimRow + 1), screen().filter(line => line.includes('❯')).join('|'))
    stdin.write('k')
    check('screen: k 上移回去', await settled(() => screen().findIndex(line => line.includes('❯')) === vimRow), screen().filter(line => line.includes('❯')).join('|'))
  }

  // Enter 打开操作菜单（焦点在活动叶 = live 会话，无切换选项）
  stdin.write('\r')
  check('screen: Enter 打开操作菜单', await settled(() => text().includes('回退到这里') && text().includes('从这分叉')))
  check('screen: live 会话不提供切换选项', !text().includes('切换到该分支'))
  // Esc 关菜单，移到死分支（F2:14）再开：切换选项出现
  stdin.write('\x1b')
  await settle(() => !text().includes('回退到这里'))
  stdin.write('\x1b[B\x1b[B\x1b[B')
  // 固定窗:pacing 等三次 ↓ 被处理——焦点移动只改高亮样式，
  // translateToString 读不到，无可观测文本条件。
  await sleep(200)
  stdin.write('\r')
  check('screen: 死分支提供切换选项', await settled(() => text().includes('切换到该分支')))

  // 字母直达：f = 从这分叉（焦点在 F2:14，经 channel 记录并关屏）
  stdin.write('f')
  check(
    'screen: 字母直达执行分叉',
    await settled(() => calls.length === 1 && calls[0]!.sessionId === 'F2' && calls[0]!.mode === 'fork'),
    JSON.stringify(calls),
  )
  check('screen: 执行成功后关屏', await settled(() => closed === true))
  await inst.unmount()

  // 再开一次：Esc 退出（无查询时）
  closed = false
  const inst2 = await render(
    <AlternateScreen>
      <SessionTree
        channel={channel}
        currentSessionId="F1"
        onClose={() => { closed = true }}
        onRestoreText={() => {}}
      />
    </AlternateScreen>,
    { stdout: stdout as any, stdin: stdin as any, stderr: stderr as any, exitOnCtrlC: false, patchConsole: false },
  )
  // 等新实例的界面就绪再发 Esc（前一实例 unmount 已离开 alt-screen，
  // 标题只会出现在新帧里）。
  await settle(() => text().includes('会话树'))
  stdin.write('\x1b')
  check('screen: Esc 直接退出', await settled(() => closed === true))
  await inst2.unmount()
}

console.log(failed === 0 ? '\nverify-session-tree: ALL PASS' : `\nverify-session-tree: ${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
