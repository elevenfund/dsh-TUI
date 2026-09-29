/**
 * verify-tool-block-render — 工具调用块渲染回归（挂载级，真实 MessageList）：
 *
 *  1. verb-group 折叠行：连续 read 聚成一行，绑定的 `⏵` narration 并入
 *     组行标题（`⏵ …  ·  Read 2 files`），不再作为独立漂浮行出现；
 *  2. narration 并入单块标题（bash 卡 header 显示意图句）；
 *  3. 块化单行折叠：bash 卡的 result body 不渲染（grok-style one-line）；
 *  4. 错误块仍在消息流（input 兜底标题可见）；
 *  5. 完成态耗时显示；
 *  6. 点击组行展开 → 成员逐块渲染、组行消失（fold 状态真实翻转）；
 *  7. running 组：进行时 label（Reading 2 files）+ live 计时。
 *
 * 运行：node --import tsx/esm scripts/verify-tool-block-render.tsx
 */
process.env.FORCE_COLOR = '3'
process.env.DSH_TUI_THEME = 'dark'
// The bucket labels under test are localized now (toolgroup-* keys); the
// assertions pin the English spelling.
process.env.DSH_TUI_LANG = 'en'

const [{ PassThrough, Writable }, React, { Terminal: XTerm }, { render, useInput, AlternateScreen }, { MessageList }, { settled, sleep }] = await Promise.all([
  import('node:stream'),
  import('react'),
  import('@xterm/headless'),
  import('../src/ui.js'),
  import('../src/components/MessageList.js'),
  import('./lib/term-test.mjs'),
])

const COLS = 100, ROWS = 36
let failed = 0
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failed += 1
}

function makeRig() {
  const term = new XTerm({ cols: COLS, rows: ROWS, scrollback: 0, allowProposedApi: true })
  class FakeStdout extends Writable {
    columns = COLS; rows = ROWS; isTTY = true
    _write(chunk: unknown, _e: BufferEncoding, cb: () => void): void { term.write(String(chunk), cb) }
  }
  class FakeStderr extends Writable { isTTY = true; _write(_c: unknown, _e: BufferEncoding, cb: () => void): void { cb() } }
  class FakeStdin extends PassThrough {
    isTTY = true
    setRawMode(): this { return this }
    ref(): this { return this }
    unref(): this { return this }
  }
  return { term, stdout: new FakeStdout(), stderr: new FakeStderr(), stdin: new FakeStdin() }
}

async function withMessageList(
  make: () => React.ReactElement,
  run: (rig: { lines: () => string[]; term: XTerm; stdin: PassThrough }) => Promise<void>,
): Promise<void> {
  const rig = makeRig()
  const instance = await render(make(), {
    stdout: rig.stdout as unknown as NodeJS.WriteStream,
    stderr: rig.stderr as unknown as NodeJS.WriteStream,
    stdin: rig.stdin as unknown as NodeJS.ReadStream,
    exitOnCtrlC: false,
    patchConsole: false,
  })
  const lines = (): string[] =>
    Array.from({ length: ROWS }, (_, y) => rig.term.buffer.active.getLine(y)?.translateToString(true) ?? '')
  try {
    await sleep(250)
    await run({ lines, term: rig.term, stdin: rig.stdin })
  } finally {
    await instance.unmount()
    rig.term.dispose()
  }
}

/** SGR 左键 press + release（1 起坐标）→ 派发一次 click。 */
function click(stdin: PassThrough, col: number, row: number): void {
  stdin.write(`\x1b[<0;${col};${row}M`)
  stdin.write(`\x1b[<0;${col};${row}m`)
}

type Row = Parameters<typeof MessageList>[0]['rows'][number]

/** Keeps the alternate screen's input plumbing alive (same as the fold rig). */
function KeySink(): React.ReactNode {
  useInput(() => {})
  return null
}

/** MessageList with the production row-expansion semantics wired up (Chat's
 *  toggleRowExpanded): the mouse toggle has to actually change state. */
function BlockList({ rows }: { rows: Row[] }): React.ReactElement {
  const [expandedRows, setExpandedRows] = React.useState<ReadonlySet<number>>(new Set<number>())
  return (
    <MessageList
      rows={rows}
      expanded={false}
      expandedRows={expandedRows}
      selectedId={null}
      onToggleRow={(rowId: number) => setExpandedRows((previous) => {
        const next = new Set(previous)
        if (next.has(rowId)) next.delete(rowId)
        else next.add(rowId)
        return next
      })}
      model="deepseek-chat"
      showAll
      onToggleAll={() => {}}
    />
  )
}

function baseRows(): Row[] {
  return [
    { id: 1, kind: 'user', text: '帮我看这两个配置然后跑构建' },
    { id: 2, kind: 'assistant', text: '⏵ 并行读取两个配置', streaming: false },
    { id: 3, kind: 'tool', text: '', tool: {
      callId: 'r1', name: 'read', argsText: '{"file_path":"cfg1.json"}', status: 'ok',
      startedAt: Date.now() - 5_000, durationMs: 1_200, resultText: '{"a":1}',
    } },
    { id: 4, kind: 'tool', text: '', tool: {
      callId: 'r2', name: 'read', argsText: '{"file_path":"cfg2.json"}', status: 'ok',
      startedAt: Date.now() - 4_000, durationMs: 900, resultText: '{"b":2}',
    } },
    { id: 5, kind: 'assistant', text: '⏵ 跑一下构建', streaming: false },
    { id: 6, kind: 'tool', text: '', tool: {
      callId: 'b1', name: 'bash', argsText: '{"command":"npm run build"}', status: 'ok',
      callView: { card: 'terminal', title: 'npm run build' },
      startedAt: Date.now() - 3_000, durationMs: 4_200,
      resultText: 'BUILD-OUTPUT-LINE-1\nBUILD-OUTPUT-LINE-2\nBUILD-OUTPUT-LINE-3',
    } },
    { id: 7, kind: 'tool', text: '', tool: {
      callId: 'r3', name: 'read', argsText: '{"file_path":"broken.json"}', status: 'error',
      startedAt: Date.now() - 2_000, durationMs: 30, errorText: 'ENOENT: no such file',
    } },
    { id: 8, kind: 'assistant', text: '汇总完成。TOOLBLOCK-END', streaming: false },
  ]
}

console.log('--- Part A: fold row, narration binding, single-line, error, timing ---')
{
  const rows = baseRows()
  await withMessageList(() => <BlockList rows={rows} />, async ({ lines }) => {
    const ls = lines()
    const groupLine = ls.find(l => l.includes('Read 2 files'))
    check('A1 verb-group 折叠行渲染（Read 2 files）', groupLine !== undefined)
    check('A2 ⏵ narration 并入组行标题（同一行，不漂浮）',
      groupLine !== undefined && groupLine.includes('⏵ 并行读取两个配置'), groupLine ?? 'no group line')
    check('A3 组成员不再逐块渲染（cfg1.json 不在折叠屏上）',
      !ls.some(l => l.includes('cfg1.json')))
    const bashLine = ls.find(l => l.includes('跑一下构建'))
    check('A4 bash 块单行渲染（narration 意图标题在屏，grok 式无裸工具名）', bashLine !== undefined, bashLine ?? 'no bash line')
    check('A5 narration 并入 bash 块标题（跑一下构建 同行）',
      bashLine !== undefined && bashLine.includes('跑一下构建'), bashLine ?? '')
    check('A6 块化单行折叠：bash result body 不渲染',
      !ls.some(l => l.includes('BUILD-OUTPUT-LINE-1')))
    check('A7 错误块 input 兜底标题在屏（broken.json）',
      ls.some(l => l.includes('broken.json')))
    check('A8 完成态耗时显示（· 4.2s 或 · 4s）',
      ls.some(l => /· ?4(\.2)?s/.test(l)), ls.find(l => /· ?\d/.test(l)) ?? 'no timing line')
    check('A9 ⏵ 全部并入块标题（⏵ 只出现在块行内，无独立漂浮行）',
      ls.filter(l => l.includes('⏵')).every(l => l.includes('◆')),
      `lines=${JSON.stringify(ls.filter(l => l.includes('⏵')))}`)
  })
}

console.log('--- Part B: click unfolds the group member-by-member ---')
{
  const rows = baseRows()
  // 鼠标事件只在 alternate screen 激活时派发（Ink.dispatchClick 的闸门），
  // 所以这一组必须挂进 AlternateScreen——与真实全屏模式同构。
  await withMessageList(
    () => <AlternateScreen><KeySink /><BlockList rows={rows} /></AlternateScreen>,
    async ({ lines, stdin }) => {
    const before = lines()
    const groupIdx = before.findIndex(l => l.includes('Read 2 files'))
    check('B1 展开前组行存在', groupIdx >= 0, `idx=${groupIdx}`)
    if (groupIdx < 0) return
    click(stdin, 5, groupIdx + 1)
    const unfolded = await settled(() => {
      const ls = lines()
      return ls.some(l => l.includes('cfg1.json')) && ls.some(l => l.includes('cfg2.json'))
    })
    check('B2 点击后成员逐块渲染（cfg1/cfg2 都在屏）', unfolded)
    check('B3 组行消失', !lines().some(l => l.includes('Read 2 files')))
  })
}

console.log('--- Part C: running group — present tense + live timer ---')
{
  const rows = baseRows()
  // Flip the two reads to running (in-place, channel-style mutation).
  for (const id of [3, 4]) {
    const row = rows.find(r => r.id === id)!
    row.tool!.status = 'running'
    row.tool!.durationMs = undefined
  }
  rows.find(r => r.id === 6)!.tool!.status = 'running'
  rows.find(r => r.id === 6)!.tool!.durationMs = undefined
  await withMessageList(() => <BlockList rows={rows} />, async ({ lines }) => {
    check('C1 running 组进行时 label（Reading 2 files）',
      await settled(() => lines().some(l => l.includes('Reading 2 files'))))
    check('C2 running 组 live 计时（数字s 在组行）',
      await settled(() => lines().some(l => l.includes('Reading 2 files') && /\d+(\.\d+)?s/.test(l))),
      lines().find(l => l.includes('Reading')) ?? '')
    check('C3 running bash 块 live 计时在 header',
      await settled(() => {
        const bash = lines().find(l => l.includes('跑一下构建'))
        return bash !== undefined && /· ?\d+(\.\d+)?s/.test(bash)
      }), '')
  })
}

if (failed > 0) {
  console.error(`tool-block-render: ${failed} check(s) failed`)
  process.exit(1)
}
console.log('tool-block-render: all checks passed')
