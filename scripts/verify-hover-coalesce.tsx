/**
 * verify-hover-coalesce — hover 事件性能与健壮性回归（兴趣边界完整 +
 * 无兴趣矩形快路径）。
 *
 * 单元层已拆至 verify-hover-coalesce-units.ts（T0）：无兴趣 rect 快路、
 *      容器子树/重叠 sibling/多 root 缓存安全、帧边界失效、兴趣 probe
 *      ——合成 DOM 树直调 dispatchHover，无渲染。
 *
 * 集成层（headless xterm + 逐字节 SGR 写 stdin，真实 Ink 管线）：
 *   I1 同一 chunk 内 A→B→C、A→outside→A 保留全部 enter/leave 边界；
 *   I2 有 handler 路径逐 chunk motion 与基线事件序列一致；
 *   I3 拖拽 motion 批内不合并：dragstart/dragmove 逐事件到达；
 *   I4 按键混批前后的 hover 边界顺序不变；
 *   I5 无兴趣矩形：无 handler 区域 3 次 motion 只 1 次全树 hit-test，
 *      重渲染挂上 handler（缓存失效）后 motion 正常 enter/leave。
 *
 * 运行：node --import tsx/esm scripts/verify-hover-coalesce.tsx
 */
process.env.FORCE_COLOR = '3'
process.env.DSH_TUI_THEME = 'dark'
process.env.DSH_TUI_LANG = 'zh'

const [
  { PassThrough, Writable },
  React,
  { Terminal: XTerm },
  { render, AlternateScreen, useInput },
  BoxMod,
  TextMod,
  { invalidateNoInterestRect, getHitTestWithOverlaysCount, resetHitTestWithOverlaysCount },
  { settle, settled, sleep, screenHas, findText },
] = await Promise.all([
  import('node:stream'),
  import('react'),
  import('@xterm/headless'),
  import('../src/ui.js'),
  import('../src/ink/components/Box.js'),
  import('../src/ink/components/Text.js'),
  import('../src/ink/hit-test.js'),
  import('./lib/term-test.mjs'),
])

const Box = BoxMod.default
const Text = TextMod.default

let failures = 0
function check(name: string, ok: boolean, extra = ''): void {
  const mark = ok ? 'ok  ' : 'FAIL'
  console.log(`${mark} ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}

// ── 集成层：真实 Ink 管线 + headless xterm + SGR 逐字节 stdin ─────
const COLS = 100
const ROWS = 30
const term = new XTerm({ cols: COLS, rows: ROWS, scrollback: 0, allowProposedApi: true })
class FakeStdout extends Writable {
  columns = COLS
  rows = ROWS
  isTTY = true
  _write(chunk: unknown, _e: BufferEncoding, cb: () => void) {
    term.write(String(chunk), cb)
  }
}
class FakeStderr extends Writable {
  isTTY = true
  _write(_c: unknown, _e: BufferEncoding, cb: () => void) {
    cb()
  }
}
class FakeStdin extends PassThrough {
  isTTY = true
  setRawMode() {
    return this
  }
  ref() {
    return this
  }
  unref() {
    return this
  }
}
const stdin = new FakeStdin()
const stdout = new FakeStdout()
const stderr = new FakeStderr()

const hoverLog: string[] = []
type DragRecord = { type: string; col: number; row: number }
const dragEvents: DragRecord[] = []

function recordDrag(e: { type: string; col: number; row: number }) {
  dragEvents.push({ type: e.type, col: e.col, row: e.row })
}

function HoverCell({ id, label }: { id: string; label: string }) {
  return (
    <Box
      width={12}
      height={1}
      onMouseEnter={() => hoverLog.push(`enter:${id}`)}
      onMouseLeave={() => hoverLog.push(`leave:${id}`)}
    >
      <Text>{label}</Text>
    </Box>
  )
}

function Scene() {
  const [armed, setArmed] = React.useState(false)
  // 常驻 raw-mode 持有者（SGR 走 handleMouseEvent，键走 useInput）
  useInput((input: string) => {
    if (input === 't') setArmed((a) => !a)
  })
  return (
    <AlternateScreen>
      <Box flexDirection="column">
        <Box flexDirection="row">
          <HoverCell id="A" label="CELL-A-x" />
          <HoverCell id="B" label="CELL-B-x" />
          <HoverCell id="C" label="CELL-C-x" />
        </Box>
        <Box
          height={1}
          {...(armed
            ? {
                onMouseEnter: () => hoverLog.push('enter:inert'),
                onMouseLeave: () => hoverLog.push('leave:inert'),
              }
            : {})}
        >
          <Text>{armed ? 'ARMEDMARKER-abcdefghijklmnopqrst' : 'INERTMARKER-abcdefghijklmnopqrst'}</Text>
        </Box>
        <Box height={1}>
          <Text>OUTMARKER</Text>
        </Box>
        <Box width={30} height={1} onDragStart={recordDrag} onDragMove={recordDrag} onDragEnd={recordDrag}>
          <Text>SLIDERMARKER-xxxxxxxxxx</Text>
        </Box>
      </Box>
    </AlternateScreen>
  )
}

const inst = await render(<Scene />, {
  stdout: stdout as never,
  stdin: stdin as never,
  stderr: stderr as never,
  exitOnCtrlC: false,
  patchConsole: false,
})

// SGR：坐标 1-indexed。motion = 无键 motion（button 35 = 0x20|3）；
// dragMotion = 左键按住 motion（button 32 = 0x20|0）
const motionSeq = (c: number, r: number) => `\x1b[<35;${c + 1};${r + 1}M`
const dragSeq = (c: number, r: number) => `\x1b[<32;${c + 1};${r + 1}M`
const pressSeq = (c: number, r: number) => `\x1b[<0;${c + 1};${r + 1}M`
const releaseSeq = (c: number, r: number) => `\x1b[<0;${c + 1};${r + 1}m`
const motion = (c: number, r: number) => stdin.write(motionSeq(c, r))
const dragMotion = (c: number, r: number) => stdin.write(dragSeq(c, r))
const press = (c: number, r: number) => stdin.write(pressSeq(c, r))
const release = (c: number, r: number) => stdin.write(releaseSeq(c, r))

function locate(marker: string) {
  return findText(term, marker)
}
const pos: Record<'A' | 'B' | 'C' | 'inert' | 'out' | 'slider', { col: number; row: number } | null> = {
  A: null,
  B: null,
  C: null,
  inert: null,
  out: null,
  slider: null,
}
await settle(() => {
  pos.A = locate('CELL-A')
  pos.B = locate('CELL-B')
  pos.C = locate('CELL-C')
  pos.inert = locate('INERTMARKER')
  pos.out = locate('OUTMARKER')
  pos.slider = locate('SLIDERMARKER')
  return Object.values(pos).every((p) => p !== null)
})
check('场景渲染：六个标记定位', Object.values(pos).every((p) => p !== null))
if (pos.A === null || pos.B === null || pos.C === null || pos.inert === null || pos.out === null || pos.slider === null) {
  console.error('\nverify-hover-coalesce: marker location failed — aborting')
  inst.unmount()
  process.exit(1)
}
const cellA = pos.A
const cellB = pos.B
const cellC = pos.C
const inert = pos.inert
const out = pos.out
const slider = pos.slider

{
  // I2（④）：有 handler 路径逐 chunk motion 与基线事件序列一致。
  // 注意本 harness 里同一 tick 的多次 write 会被 stream 合并成一个
  // chunk，所以这里每次 write 后 settle 等处理完再写下一个。
  hoverLog.length = 0
  motion(cellA.col + 2, cellA.row)
  await settle(() => hoverLog.length === 1)
  motion(cellB.col + 2, cellB.row)
  await settle(() => hoverLog.length === 3)
  motion(cellC.col + 2, cellC.row)
  check(
    'I2 handler 路径基线序列 enter/leave 逐对',
    await settled(() => hoverLog.length === 5) &&
      hoverLog.join(',') === 'enter:A,leave:A,enter:B,leave:B,enter:C',
    hoverLog.join(','),
  )
  // 清理：移出到 OUT 行（leave:C）
  motion(out.col + 1, out.row)
  await settle(() => hoverLog.length === 6)
  hoverLog.length = 0
}

{
  // I1: every interest-boundary crossing in one stdin chunk is preserved.
  // Tooltip dwell depends on leave/re-enter, so rAF-style tail coalescing is
  // not semantically safe for A→outside→A.
  stdin.write(
    motionSeq(cellA.col + 3, cellA.row) +
    motionSeq(cellB.col + 3, cellB.row) +
    motionSeq(cellC.col + 3, cellC.row),
  )
  check(
    'I1 批内 A→B→C 保留全部 hover 边界',
    await settled(() => hoverLog.join(',') === 'enter:A,leave:A,enter:B,leave:B,enter:C'),
    hoverLog.join(','),
  )
  motion(out.col + 1, out.row)
  await settle(() => hoverLog.at(-1) === 'leave:C')
  hoverLog.length = 0

  motion(cellA.col + 2, cellA.row)
  await settle(() => hoverLog.join(',') === 'enter:A')
  hoverLog.length = 0
  stdin.write(
    motionSeq(out.col + 1, out.row) +
    motionSeq(cellA.col + 2, cellA.row),
  )
  check(
    'I1 同批 A→outside→A 会 leave/re-enter（dwell 重新计时）',
    await settled(() => hoverLog.join(',') === 'leave:A,enter:A'),
    hoverLog.join(','),
  )
  motion(out.col + 1, out.row)
  await settle(() => hoverLog.at(-1) === 'leave:A')
  hoverLog.length = 0
}

{
  // I3（②）：拖拽 motion 批内绝不合并 —— dragstart/dragmove 逐事件到达
  // （首个 motion 同时发 dragstart+dragmove，DOM 语义；3 个 motion =
  // dragstart + dragmove×3，坐标逐一对应）
  dragEvents.length = 0
  press(slider.col + 2, slider.row)
  stdin.write(
    dragSeq(slider.col + 3, slider.row) +
    dragSeq(slider.col + 6, slider.row) +
    dragSeq(slider.col + 9, slider.row),
  )
  check(
    'I3 拖拽 motion 批内不合并：dragstart+dragmove×3 逐事件到达',
    await settled(() =>
      dragEvents.length === 4 &&
      dragEvents[0]!.type === 'dragstart' &&
      dragEvents[0]!.col === slider.col + 3 &&
      dragEvents[1]!.type === 'dragmove' &&
      dragEvents[1]!.col === slider.col + 3 &&
      dragEvents[2]!.type === 'dragmove' &&
      dragEvents[2]!.col === slider.col + 6 &&
      dragEvents[3]!.type === 'dragmove' &&
      dragEvents[3]!.col === slider.col + 9,
    ),
    dragEvents.map((e) => `${e.type}@${e.col}`).join(','),
  )
  release(slider.col + 9, slider.row)
  check(
    'I3 release 收尾 dragend',
    await settled(() => dragEvents.length === 5 && dragEvents[4]!.type === 'dragend'),
    dragEvents.map((e) => e.type).join(','),
  )
  dragEvents.length = 0
}

{
  // I4（混批）：按键打断不改变前后 hover 边界顺序。
  stdin.write(
    motionSeq(cellA.col + 2, cellA.row) +
    motionSeq(cellB.col + 2, cellB.row) +
    'x' +
    motionSeq(cellC.col + 2, cellC.row),
  )
  check(
    'I4 混批保留 A→B、按键、B→C 的完整边界',
    await settled(() => hoverLog.join(',') === 'enter:A,leave:A,enter:B,leave:B,enter:C'),
    hoverLog.join(','),
  )
  motion(out.col + 1, out.row)
  await settle(() => hoverLog.length === 6)
  hoverLog.length = 0
}

{
  // I5（③）：无兴趣矩形 —— 无 handler 区域 3 次 motion 只 1 次全树 hit-test
  invalidateNoInterestRect()
  resetHitTestWithOverlaysCount()
  motion(inert.col + 0, inert.row)
  const first = await settled(() => getHitTestWithOverlaysCount() === 1)
  check('I5 首次 motion 全树 hit-test 并缓存', first)
  await sleep(80) // 固定窗:pacing motion 步间
  motion(inert.col + 2, inert.row)
  await sleep(80) // 固定窗:pacing motion 步间
  motion(inert.col + 4, inert.row)
  // 固定窗:探针 后两次 motion 不得再触发全树 hit-test，等一个观察窗再断言计数不变
  await sleep(80)
  check('I5 无 handler 区域 3 次 motion 只 1 次 hit-test（其余跳过）',
    getHitTestWithOverlaysCount() === 1, `count=${getHitTestWithOverlaysCount()}`)
  // 重渲染挂上 handler：'t' 使 region Box 获得 onMouseEnter/onMouseLeave
  stdin.write('t')
  await settle(() => screenHas(term, 'ARMEDMARKER'))
  // 缓存已随 commit/frame 失效：同 rect 内 motion 正常 enter
  motion(inert.col + 1, inert.row)
  check(
    'I5 挂上 handler 后（缓存失效）motion 正常 enter',
    await settled(() => getHitTestWithOverlaysCount() === 2 && hoverLog.includes('enter:inert')),
    `count=${getHitTestWithOverlaysCount()} log=${hoverLog.join(',')}`,
  )
  // 移出 → leave 正常
  motion(out.col + 1, out.row)
  check(
    'I5 移出 region 正常 leave',
    await settled(() => hoverLog.includes('leave:inert')),
    hoverLog.join(','),
  )
}

await inst.unmount()

// I6: an absolute sibling may overlap only part of an otherwise inert rect.
// Starting on the uncovered part must not cache through the floating target.
const overlayHoverLog: string[] = []
function OverlayScene() {
  useInput(() => {})
  return (
    <AlternateScreen>
      <Box width={50} height={6}>
        <Box width={40} height={2}>
          <Text>INERT-BASE-abcdefghijklmnopqrstuv</Text>
        </Box>
        <Box
          position="absolute"
          left={20}
          top={0}
          width={10}
          height={1}
          onMouseEnter={() => overlayHoverLog.push('enter:float')}
          onMouseLeave={() => overlayHoverLog.push('leave:float')}
        >
          <Text>FLOAT-HIT</Text>
        </Box>
      </Box>
    </AlternateScreen>
  )
}
const overlayInst = await render(<OverlayScene />, {
  stdout: stdout as never,
  stdin: stdin as never,
  stderr: stderr as never,
  exitOnCtrlC: false,
  patchConsole: false,
})
await settle(() => screenHas(term, 'FLOAT-HIT'))
const floatPos = findText(term, 'FLOAT-HIT')
invalidateNoInterestRect()
resetHitTestWithOverlaysCount()
if (floatPos !== null) {
  motion(2, floatPos.row)
  await settle(() => getHitTestWithOverlaysCount() === 1)
  motion(floatPos.col + 2, floatPos.row)
}
check(
  'I6 absolute sibling 覆盖 inert rect 时不走错误快路径',
  floatPos !== null &&
    await settled(() => overlayHoverLog.includes('enter:float')) &&
    getHitTestWithOverlaysCount() >= 2,
  `pos=${JSON.stringify(floatPos)} count=${getHitTestWithOverlaysCount()} log=${overlayHoverLog.join(',')}`,
)
await overlayInst.unmount()

if (failures > 0) {
  console.error(`\nverify-hover-coalesce: ${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nverify-hover-coalesce: all checks passed')
