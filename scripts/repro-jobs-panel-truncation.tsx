/**
 * 复现：/jobs 面板任务行 id/kind/status 列在窄终端下被 Yoga 按比例压缩截断
 * （真机观测：bash-102→bash-10、bash→bas、running→runnin，会被误读成不同任务）。
 * 逐宽度渲染 JobsPanel 并打印数据行，找截断阈值。
 * 运行：node --import tsx/esm scripts/repro-jobs-panel-truncation.tsx
 */
process.env.DSH_TUI_LANG = 'en'
process.env.FORCE_COLOR = '3'

const { mkdtempSync, mkdirSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join: joinPath } = await import('node:path')
const isolatedHome = mkdtempSync(joinPath(tmpdir(), 'dshtui-jobs-trunc-'))
process.env.HOME = isolatedHome
process.env.USERPROFILE = isolatedHome
mkdirSync(joinPath(isolatedHome, '.dsh-tui'), { recursive: true })

const [{ JobsPanel }, React, { render }] = await Promise.all([
  import('../src/components/JobsPanel.js'),
  import('react'),
  import('../src/ui.js'),
])
const { Writable, PassThrough } = await import('node:stream')
const { Terminal: XTerm } = (await import('@xterm/headless')) as unknown as {
  Terminal: typeof import('@xterm/headless').Terminal
}

const JOB = {
  id: 'bash-102',
  kind: 'bash',
  label: 'for i in $(seq 1 36); do printf stress-a line...',
  status: 'running' as const,
  startedAt: Date.now() - 75_000,
  outputLines: ['stress-a line 25/36 01:56:44'],
}

for (const cols of [80, 72, 70, 66, 62, 58, 54, 50]) {
  const rows = 24
  class FakeStdout extends Writable {
    columns = cols
    rows = rows
    isTTY = true
    constructor(private term: InstanceType<typeof XTerm>) { super() }
    _write(chunk: unknown, _e: BufferEncoding, cb: () => void): void { this.term.write(String(chunk), cb) }
  }
  class Input extends PassThrough {
    isTTY = true
    setRawMode(): this { return this }
    ref(): this { return this }
    unref(): this { return this }
  }
  const term = new XTerm({ cols, rows, scrollback: 0, allowProposedApi: true })
  const stdout = new FakeStdout(term) as unknown as NodeJS.WriteStream
  const stdin = new Input()
  const instance = await render(
    React.createElement(JobsPanel, { jobs: [JOB], onClose: () => {}, onKill: () => {} }),
    { stdout, stdin: stdin as unknown as NodeJS.ReadStream, exitOnCtrlC: false, patchConsole: false },
  )
  await new Promise(r => setTimeout(r, 120))
  const screen = Array.from({ length: rows }, (_, y) =>
    term.buffer.active.getLine(y)?.translateToString(true) ?? '').join('\n')
  const dataRow = screen.split('\n').find(l => l.includes('bash')) ?? '(no row)'
  // Fixed columns must survive intact at every width: id ("bash-102"),
  // kind (" · bash ·" — bare 'bash' would substring-match the id), duration
  // ("1m15s"), status ("running"). Only the label may clip.
  const intact = dataRow.includes('bash-102') && dataRow.includes(' · bash ·') &&
    dataRow.includes('1m15s') && dataRow.includes('running')
  console.log(`${cols.toString().padStart(3)} cols  ${intact ? 'OK  ' : 'TRUNC'}  |${dataRow}|`)
  await instance.unmount()
  term.dispose()
}
