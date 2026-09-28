/**
 * Whale startup-intro render smoke: the three randomized opening sequences —
 * classic (blink + spout + tail wag), heart, sleep. Frame-table integrity,
 * sequence validity, and the random pick API are asserted synchronously in
 * verify-whale-frames.mjs (T0); this file mounts LogoV2 and proves each new
 * palette color (pink heart, gray sleep-Z) actually paints during its intro
 * and disappears once the header settles.
 *
 * Run: node --import tsx/esm scripts/verify-whale-intro.mjs
 */
process.env.FORCE_COLOR = '3'
process.env.DSH_TUI_LANG = 'en'

const [
  { strict: assert },
  { PassThrough, Writable },
  React,
  { render, ThemeProvider },
  { LogoV2 },
  { settle, settled },
] = await Promise.all([
  import('node:assert'),
  import('node:stream'),
  import('react'),
  import('../src/ui.js'),
  import('../src/components/LogoV2.js'),
  import('./lib/term-test.mjs'),
])

let checks = 0
function check(name, test) {
  try {
    test()
    checks += 1
    console.log(`PASS: ${name}`)
  } catch (error) {
    console.error(`FAIL: ${name}`)
    throw error
  }
}

// --- Parts 1-3 live in verify-whale-frames.mjs (T0, synchronous) ------

// ── 4. Render smoke: heart / sleep actually paint, then settle ───────────
const PINK = '\x1b[38;2;204;51;153m' // #cc3399 heart
const GRAY = '\x1b[38;2;128;128;128m' // #808080 sleep-Z

class FakeStdin extends PassThrough {
  isTTY = true
  setRawMode() { return this }
  ref() { return this }
  unref() { return this }
}

class FakeOutput extends Writable {
  constructor() {
    super()
    this.columns = 100
  }
  rows = 30
  isTTY = true
  writes = []
  _write(chunk, _encoding, callback) {
    this.writes.push(String(chunk))
    callback()
  }
}

async function renderLogo(intro) {
  const stdout = new FakeOutput()
  const instance = await render(
    React.createElement(
      ThemeProvider,
      { theme: 'dark' },
      React.createElement(LogoV2, { model: 'whale-intro-probe', cwd: '/whale/cwd', intro }),
    ),
    {
      stdout,
      stdin: new FakeStdin(),
      stderr: new FakeOutput(),
      exitOnCtrlC: false,
      patchConsole: false,
    },
  )
  return { stdout, instance }
}

{
  const { stdout, instance } = await renderLogo('heart')
  const sawPink = await settled(() => stdout.writes.join('').includes(PINK))
  check('heart intro paints the pink heart SGR', () => assert.ok(sawPink, 'pink heart never painted'))
  // heart total dwell = 2750ms; wait past it, the settled frame must be plain.
  await new Promise(resolve => setTimeout(resolve, 2750 + 900))
  const last = stdout.writes.slice(-3).join('')
  const all = stdout.writes.join('')
  check('heart intro settles back to the standard pose (no pink)', () => {
    assert.ok(!last.includes(PINK), 'pink leaked into the settled frame')
    assert.ok(all.includes('\x1b[38;2;20;38;96m'), 'whale outline never painted')
  })
  await instance.unmount()
}

{
  const { stdout, instance } = await renderLogo('sleep')
  const sawGray = await settled(() => stdout.writes.join('').includes(GRAY))
  check('sleep intro paints the gray Z SGR', () => assert.ok(sawGray, 'gray Z never painted'))
  // sleep total dwell = 3100ms; wait past it, the settled frame must be plain.
  await new Promise(resolve => setTimeout(resolve, 3100 + 900))
  const last = stdout.writes.slice(-3).join('')
  const all = stdout.writes.join('')
  check('sleep intro settles back to the standard pose (no Z)', () => {
    assert.ok(!last.includes(GRAY), 'gray leaked into the settled frame')
    assert.ok(all.includes('\x1b[38;2;20;38;96m'), 'whale outline never painted')
  })
  await instance.unmount()
}

console.log(`\nAll ${checks} whale-intro checks passed.`)
