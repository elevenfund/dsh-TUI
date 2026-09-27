/**
 * 悬停浮层第二批回归：「浮层只给屏幕上看不到、悬停马上想知道的信息」
 * 在另外三处的落地——
 *
 *  F. @ 文件补全面板：名称列固定 20 列 + 行宽截断，悬停被截断的长路径行
 *     弹出完整路径 + 类型；完整可见的短路径行不弹。
 *  G. 会话列表行：标题截断时悬停弹【完整标题 + 绝对时间 + cwd】；标题
 *     未截断时浮层不重复标题（只带时间 + cwd）。
 *  H. 状态栏 model/git 字段：悬停 model 弹 provider + ctx 窗口明细；
 *     悬停 git 弹完整分支名（原地明细行契约，与 tps/cost 同款）。
 *  I. ctx 内联量表：grok 式短条（1/8 格填充 + 轨道）带读数、压力随档
 *     转色；悬停字段弹【全部内容类型 + free】的数字明细。
 *
 * Run: `node --import tsx/esm scripts/verify-hover-details.tsx`
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataDir = mkdtempSync(join(tmpdir(), 'verify-hover-details-data-'))
process.env.HOME = dataDir
process.env.USERPROFILE = dataDir
process.env.DSH_TUI_LANG = 'zh'
// 组 I 断言量表填充的前景色（压力分档是量表的唯一用色表达），必须开色。
process.env.FORCE_COLOR = '3'

const [{ PassThrough, Writable }, React, { Terminal: XTerm }, ui, tooltip, termTest, metrics] = await Promise.all([
  import('node:stream'),
  import('react'),
  import('@xterm/headless'),
  import('../src/ui.js'),
  import('../src/components/Tooltip.js'),
  import('./lib/term-test.mjs'),
  import('../src/screens/StatusMetrics.js'),
])

const { sleep, settled, screenHas, findText } = termTest
const { render, AlternateScreen, Box } = ui

let failed = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failed++
}

function KeySink(): React.ReactNode {
  ui.useInput(() => {})
  return null
}

function makeRig(cols: number, rows: number) {
  const term = new XTerm({ cols, rows, scrollback: 50, allowProposedApi: true })
  class FakeStdout extends Writable {
    columns = cols
    rows = rows
    isTTY = true
    _write(chunk: unknown, _e: BufferEncoding, cb: () => void) { term.write(String(chunk), cb) }
  }
  class FakeStdin extends PassThrough {
    isTTY = true
    setRawMode() { return this }
    ref() { return this }
    unref() { return this }
  }
  return { term, stdout: new FakeStdout(), stdin: new FakeStdin() }
}

/** SGR mode-1003 motion with no buttons → dispatchHover. Coords 1-indexed. */
const hover = (stdin: PassThrough, col: number, row: number) =>
  stdin.write(`\x1b[<35;${col};${row}M`)

function hoverText(stdin: PassThrough, term: XTerm, needle: string): void {
  const at = findText(term, needle)
  if (at === null) throw new Error(`hover target not found: ${needle}`)
  hover(stdin, at.col + 1, at.row + 1)
}

/** Foreground of a horizontal run of block chars (the ctx inline gauge's
 *  fill). Block glyphs occupy two cells under ambiguous-width handling, so
 *  cell coordinates cannot be derived from string indexes — scan instead.
 *  Returns the 256-color index, -1 for default fg, -2 when no run found. */
const blockRunFg = (term: XTerm, runLen: number): number => {
  for (let row = 0; row < term.rows; row++) {
    const line = term.buffer.active.getLine(row)
    if (line === undefined) continue
    for (let col = 0; col + runLen - 1 < term.cols; col++) {
      let all = true
      for (let i = 0; i < runLen; i++) {
        if (line.getCell(col + i)?.getChars() !== '█') { all = false; break }
      }
      if (!all) continue
      const cell = line.getCell(col)!
      return cell.isFgDefault() ? -1 : cell.getFgColor() & 0xffffff
    }
  }
  return -2
}

const { FileSuggestions } = await import('../src/components/FileSuggestions.js')
const { SessionListRow } = await import('../src/components/sessions/SessionListRow.js')
const { StatusLine } = await import('../src/screens/StatusLine.js')
const { formatAbsolute } = await import('../src/sessions/format.js')

try {
  const COLS = 50
  const ROWS = 30
  const rig = makeRig(COLS, ROWS)
  const { term, stdin } = rig

  // --- F. @ 文件补全面板：长路径截断 → 悬停弹全路径 ----------------------
  // 路径宽 43：行内截断（5+43 > usable=46 边界内）且浮层单行放得下
  // （内宽 44），屏幕断言与浮层内容一一对应。
  const LONG_PATH = 'src/components/messages/DeepLongFileName.tsx'
  const files = [
    { id: 'f1', path: LONG_PATH, displayPath: LONG_PATH, name: 'DeepLongFileName.tsx', kind: 'file' as const, score: 1 },
    { id: 'f2', path: 'README.md', displayPath: 'README.md', name: 'README.md', kind: 'file' as const, score: 1 },
  ]
  const instance = await render(
    <AlternateScreen>
      <Box flexDirection="column">
        <KeySink />
        <FileSuggestions files={files} selectedIndex={0} columns={COLS} />
        <tooltip.TooltipLayer />
      </Box>
    </AlternateScreen>,
    { stdout: rig.stdout, stdin: rig.stdin, exitOnCtrlC: false, patchConsole: false },
  )
  await sleep(600) // 固定窗:pacing 等首帧上屏，无单一可轮询锚点
  check('场景 F 就绪：长路径行已截断（尾段不在屏）', await settled(() => !screenHas(term, 'DeepLongFileName.tsx')))
  hoverText(stdin, term, 'src/components/messages')
  check('F 截断路径悬停后弹出完整路径', await settled(() => screenHas(term, 'DeepLongFileName.tsx')))
  // 浮层盖住下方行：先移开再找短路径行的悬停目标。
  hover(stdin, 1, 1)
  check('F 移开后长路径浮层消失', await settled(() => !screenHas(term, 'DeepLongFileName.tsx')))
  // 短路径行：名字完整可见 → 悬停不弹浮层（直查 tooltip store，排除
  // 「卡片内容恰好与可见文本同字」的歧义）。
  hoverText(stdin, term, 'README.md')
  await sleep(900) // 固定窗:探针 完整可见路径不得弹浮层；条件本就成立，轮询立即返回等于没测
  check('F 完整可见路径悬停不弹浮层', tooltip.getTooltipSnapshot() === null,
    `snapshot=${JSON.stringify(tooltip.getTooltipSnapshot()?.content ?? null)}`)

  // --- G. 会话列表行：标题截断 → 悬停弹完整标题+绝对时间+cwd ------------
  const NOW = Date.now()
  const session = {
    id: 'sess-1',
    kind: { kind: 'root' as const },
    title: { text: '修复一个非常长非常长需要被截断才能看到结尾标记END-OF-TITLE的标题', source: 'auto' as const },
    cwd: 'D:\\work\\dsh-tui',
    createdAt: NOW - 86_400_000,
    updatedAt: NOW - 3_600_000,
    bytes: 2048,
    hasPrompt: true,
    agentPreset: undefined,
    model: 'deepseek-chat',
    label: undefined,
    branch: 'main',
    childCount: 0,
  }
  const sessionTree = (width: number) => (
    <AlternateScreen>
      <Box flexDirection="column">
        <KeySink />
        <SessionListRow session={session} width={width} depth={0} focused={false} pinned={false} now={NOW} />
        <tooltip.TooltipLayer />
      </Box>
    </AlternateScreen>
  )
  instance.rerender(sessionTree(60))
  // 负值就绪探针会立即在旧帧上返回（term-test 的系统性坑）：先用正值
  // 等新树真正上屏，再断言截断。
  check('场景 G 就绪：会话行已渲染', await settled(() => screenHas(term, '修复')))
  check('场景 G 就绪：长标题已截断（结尾标记不在屏）', !screenHas(term, 'END-OF-TITLE'))
  hoverText(stdin, term, '修复')
  check('G 截断标题悬停后弹出完整标题', await settled(() => screenHas(term, 'END-OF-TITLE')))
  const absolute = formatAbsolute(session.updatedAt)
  check('G 浮层带绝对时间戳', await settled(() => screenHas(term, absolute)), `abs=${absolute}`)
  check('G 浮层带 cwd', await settled(() => screenHas(term, 'D:\\work\\dsh-tui')))
  hover(stdin, 1, 1)
  check('G 移开即隐藏工具提示', await settled(() => !screenHas(term, 'END-OF-TITLE')))

  // G2：标题完整可见（宽行）→ 浮层不重复标题，只带时间 + cwd。
  instance.rerender(sessionTree(120))
  check('场景 G2 就绪：宽行标题完整在屏', await settled(() => screenHas(term, 'END-OF-TITLE')))
  hoverText(stdin, term, '修复')
  check('G2 完整标题悬停弹浮层（时间+cwd）', await settled(() => tooltip.getTooltipSnapshot() !== null))
  {
    const content = tooltip.getTooltipSnapshot()?.content ?? ''
    check('G2 浮层不重复完整标题', !content.includes('END-OF-TITLE'), `content=${JSON.stringify(content)}`)
    check('G2 浮层仍带绝对时间与 cwd', content.includes(absolute) && content.includes('dsh-tui'))
  }
  hover(stdin, 1, 1)

  // --- H. 状态栏字段：model/git 悬停明细 ---------------------------------
  const channelStub = {
    minimal: false,
    statusBar: { gitBranch: true },
    model: 'TM',
    provider: 'test-provider',
    contextWindow: 64_000,
    gitBranch: 'test-branch-long',
    displayCwd: 'D:\\work\\dsh-tui',
    cwd: 'D:\\work\\dsh-tui',
    mode: { plan: false, sandbox: 'workspace-write', approval: 'on-request' },
    modeIndex: 0,
    tokens: { input: 0, output: 0 },
    tpsSamples: [],
    backgroundJobs: [],
    contextSegments: {},
    working: false,
    activityFrames: [],
    goal: undefined,
    sessionTitle: undefined,
    agentId: 'abcdef0123456789',
    reasoningEffort: undefined,
    tps: undefined,
    lastUsage: undefined,
    contextBarEnabled: false,
  }
  instance.rerender(
    <AlternateScreen>
      <Box flexDirection="column">
        <KeySink />
        <StatusLine channel={channelStub as never} />
        <tooltip.TooltipLayer />
      </Box>
    </AlternateScreen>,
  )
  check('场景 H 就绪：状态栏 model/git 字段在屏',
    await settled(() => screenHas(term, 'TM') && screenHas(term, 'test-branch-long')))
  check('H 未悬停时无明细行', !screenHas(term, 'provider test-provider'))
  hoverText(stdin, term, 'TM')
  check('H 悬停 model 字段弹 provider/ctx 明细',
    await settled(() => screenHas(term, 'provider test-provider') && screenHas(term, 'ctx 64k')))
  hoverText(stdin, term, 'test-branch-long')
  check('H 悬停 git 字段弹完整分支明细',
    await settled(() => screenHas(term, 'git test-branch-long')))
  check('H 明细随悬停目标切换（model 明细已离开）',
    await settled(() => !screenHas(term, 'provider test-provider')))
  hover(stdin, 1, 1)

  // --- I. 上下文进度条：无标签 + 整条悬停给全量明细 ----------------------
  // I0：纯函数层。ANSI 路径是 ContextBarView 的字符串孪生（同一套列分配与
  // 读出阶梯），先在这里钉死「条上没有类型名」、读出阶梯、压力分档与明细的
  // 宽度阶梯。
  const SEGMENTS = { system: 1200, prompt: 300, assistant: 4000, thinking: 5000, tools: 2000 }
  const USED = 12_500 // input 12000 + cacheRead 500
  {
    // 内联量表的单元格源：整格填充 + 可见 ░ 轨道（grok 式 20 格表）。
    const cells = metrics.contextBarCells(USED, 64_000) // 19.5% → 4 full cells
    check('I0 内联量表形状：4 格实填 + 16 格轨道 + success 档',
      cells.fill === '████' && cells.track === '░'.repeat(16) && cells.pressure === 'success',
      JSON.stringify(cells))
    check('I0 压力分档：84.4% 进 warning',
      metrics.contextBarCells(54_000, 64_000).pressure === 'warning')
    check('I0 满格封顶不溢出',
      metrics.contextBarCells(64_000, 64_000).fill === '█'.repeat(20)
      && metrics.contextBarCells(64_000, 64_000).track === '')
    check('I0 压力分档 80/95 与读数一致',
      metrics.contextPressureStep(79.9) === undefined
      && metrics.contextPressureStep(80) === 'warning'
      && metrics.contextPressureStep(94.9) === 'warning'
      && metrics.contextPressureStep(95) === 'error',
      [79.9, 80, 94.9, 95].map(p => `${p}:${metrics.contextPressureStep(p) ?? 'none'}`).join(' '))
    const wide = metrics.contextBarBreakdown(SEGMENTS, USED, 64_000, 120)
    check('I0 宽终端明细用可读名 + 圆点分隔',
      wide.entries.map(e => e.label).join(wide.separator)
        === 'system 1.2k · prompt 300 · assistant 4.0k · thinking 5.0k · tools 2.0k · free 52k',
      `got=${JSON.stringify(wide.entries.map(e => e.label).join(wide.separator))}`)
    const narrow = metrics.contextBarBreakdown(SEGMENTS, USED, 64_000, 50)
    check('I0 窄终端明细退化到短名（仍逐项给数）',
      narrow.entries.map(e => e.label).join(narrow.separator)
        === 'sys 1.2k pr 300 ast 4.0k th 5.0k tl 2.0k free 52k',
      `got=${JSON.stringify(narrow.entries.map(e => e.label).join(narrow.separator))}`)
    const empty = metrics.contextBarBreakdown(
      { system: 0, prompt: 0, assistant: 0, thinking: 0, tools: 0 }, 0, 64_000, 120)
    check('I0 零占用段不进明细（与量表不给列数一致）',
      empty.entries.length === 1 && empty.entries[0]?.label === 'free 64k',
      `got=${JSON.stringify(empty.entries.map(e => e.label))}`)
  }

  // I：真机渲染 + 鼠标。120 列让宽终端阶梯成立（可读名），12 行够放下
  // 状态行+明细行。
  //
  // 先卸载 F～H 的实例再起第二个：同进程里两个 AlternateScreen 实例并存
  // 时，后者的首帧会漏字段行（实测可复现，与本改动无关；卸载先行即可
  // 稳定）。
  instance.unmount()
  await sleep(150) // 固定窗:pacing 等第一个实例完全卸载，第二个实例首帧才完整
  const barRig = makeRig(120, 12)
  const barStub = {
    ...channelStub,
    contextSegments: SEGMENTS,
    lastUsage: { input: 12_000, output: 0, cacheRead: 500, cacheWrite: 0 },
  }
  const barInstance = await render(
    <AlternateScreen>
      <Box flexDirection="column">
        <KeySink />
        <StatusLine channel={barStub as never} />
        <tooltip.TooltipLayer />
      </Box>
    </AlternateScreen>,
    { stdout: barRig.stdout, stdin: barRig.stdin, exitOnCtrlC: false, patchConsole: false },
  )
  const barTerm = barRig.term
  const barStdin = barRig.stdin
  check('场景 I 就绪：ctx 读数在屏', await settled(() => screenHas(barTerm, '20%')))
  {
    // 状态行一排读到底（grok 式）：model · 条+% · counts · …，无两端分裂。
    const barRow = findText(barTerm, '20%')?.row ?? -1
    const line = (barRow < 0 ? '' : barTerm.buffer.active.getLine(barRow)?.translateToString(true) ?? '')
    check('I ctx 字段 = 量表 + 百分比，counts 独立字段（████░░… 20% · 13k/64k）',
      /████░░░░░░░░░░░░░░░░ 20%.*· 13k\/64k/.test(line), `line=${JSON.stringify(line)}`)
    // 正常占用的量表填充走 success 色（着色即非默认前景）。
    check('I 正常占用量表填充着色（success）', blockRunFg(barTerm, 4) > 0,
      `fg=${blockRunFg(barTerm, 4)}`)
  }
  // 悬停 ctx 字段：明细是「全部内容类型」，不只是 free。
  hoverText(barStdin, barTerm, '20%')
  check('I 悬停 ctx 弹全量明细（含 sys 与 th）',
    await settled(() => screenHas(barTerm, 'sys 1.2k') && screenHas(barTerm, 'th 5k')))
  check('I 明细同一行带 free 项', screenHas(barTerm, 'free 51.5k'))
  hover(barStdin, 1, 1)
  check('I 移开即撤下明细', await settled(() => !screenHas(barTerm, 'th 5k')))

  // 压力染色上屏：同一实例改用 84% 占用重渲染，量表填充应转成主题 warning。
  const { ThemeProvider } = ui
  barInstance.rerender(
    <AlternateScreen>
      <Box flexDirection="column">
        <KeySink />
        <ThemeProvider theme="dark">
          <StatusLine
            channel={{ ...barStub, lastUsage: { input: 54_000, output: 0, cacheRead: 0, cacheWrite: 0 } } as never}
          />
        </ThemeProvider>
      </Box>
    </AlternateScreen>,
  )
  check('I 高压占用读数在屏（84%）', await settled(() => screenHas(barTerm, '84%')))
  {
    // 84.375% → 17 格实填；填充随压力转琥珀（#D8B270 的 256 色近似 180）。
    check('I 高压量表填充转琥珀（warning 256=180）', blockRunFg(barTerm, 17) === 180,
      `fg=${blockRunFg(barTerm, 17)}`)
  }
  barInstance.unmount()
  await sleep(100) // 固定窗:pacing unmount 收尾输出 flush，无可观测完成条件

  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILURES`)
  process.exit(failed === 0 ? 0 : 1)
} catch (err) {
  console.error(err)
  process.exit(1)
}
