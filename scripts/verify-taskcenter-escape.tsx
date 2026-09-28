#!/usr/bin/env node
/**
 * Regression (Esc in the task center, 2026-09-29): while a turn is running,
 * Esc over the Ctrl+G task center must CLOSE the panel, not interrupt the
 * turn. The panel renders as an early return that replaces the whole tree,
 * so its own useInput registers AFTER Chat's; Chat's interrupt arm
 * (`key.escape && channel.working`) must yield first via inputGuardAction
 * (`taskCenterSurfaces`) or the panel never sees the key. The regression
 * also pins the two neighbours so the fix cannot overshoot: Ctrl+C over the
 * panel closes it the same way (the panel's own arm), and once the panel is
 * closed a bare Esc still interrupts the running turn.
 *
 * Drives the REAL `Chat` through fake stdin and a headless xterm (same
 * harness as verify-composer-draft-screen-switch). Run from the checkout
 * root:
 *   node --import tsx/esm scripts/verify-taskcenter-escape.tsx
 */
process.env.FORCE_COLOR = '3'
process.env.DSH_TUI_THEME = 'dark'
process.env.DSH_TUI_LANG = 'zh'

const { mkdtempSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')
// Isolate HOME before importing the app: i18n / preferences resolve at import.
const home = mkdtempSync(join(tmpdir(), 'dsh-tui-taskcenter-esc-'))
process.env.HOME = home
process.env.USERPROFILE = home
process.env.DSH_TUI_DISABLE_TERMINAL_IMAGES = '1'

const [
  { PassThrough, Writable },
  { default: React },
  { Terminal: XTerm },
  { render },
  { Chat },
  { QuestionStore },
  { LOCAL_COMMANDS, completeCommands },
  { settled, viewportLines },
] = await Promise.all([
  import('node:stream'),
  import('react'),
  import('@xterm/headless'),
  import('../src/ui.js'),
  import('../src/screens/Chat.js'),
  import('../src/dsh-adapter/questions.js'),
  import('../src/commands.js'),
  import('./lib/term-test.mjs'),
])

const COLS = 100
const ROWS = 36
const ESC = '\x1b'
const CTRL_C = '\x03'
const CTRL_G = '\x07'

class VerifyFailure extends Error {
  constructor(scenario: string, detail: string) {
    super(`${scenario}: ${detail}`)
    this.name = 'VerifyFailure'
  }
}

function assertTrue(scenario: string, detail: string, actual: unknown): void {
  if (actual !== true) throw new VerifyFailure(scenario, detail)
}

async function waitFor(scenario: string, what: string, pred: () => boolean): Promise<void> {
  const ok = await settled(pred, { timeoutMs: 5000 })
  if (!ok) throw new VerifyFailure(scenario, `timeout waiting for ${what}`)
}

/** Stable references: a fresh `[]`/callback per render would make Chat's
 *  `useSyncExternalStore` loop on unchanged snapshots. */
const EMPTY_LIST: readonly never[] = Object.freeze([])
const noopUnsubscribe = (): (() => void) => () => {}

/** Stub channel: the seams the Chat tree needs to mount, with the turn
 *  parked in `working` from the first frame and `cancel` counting calls —
 *  the interrupt arm is the behaviour under test, so its calls must be
 *  observable. */
function makeChannel() {
  const listeners = new Set<() => void>()
  const state = { cancelCalls: 0 }
  const channel = {
    whaleIdle: false,
    version: 0,
    rows: [{ id: 1, kind: 'user' as const, text: 'hi' }],
    status: 'idle' as const,
    sessionTitle: 'probe',
    agentId: 'probe',
    model: 'deepseek-v4-flash',
    provider: 'deepseek',
    reasoningEffort: 'max',
    effortLevels: [] as string[],
    tokens: { input: 0, output: 0 },
    cwd: '/tmp/demo',
    displayCwd: '/tmp/demo',
    gitBranch: 'main',
    working: true,
    spinnerMode: 'requesting',
    responseChars: 0,
    activeToolCount: 0,
    turnStart: 0,
    pending: [] as unknown[],
    commandList: LOCAL_COMMANDS,
    notifications: [] as unknown[],
    mode: { plan: false, sandbox: undefined },
    activityFrames: 'moon8',
    agentPreset: undefined,
    lastUserText: '',
    scrollGutter: 'timeline',
    state,
    subagents: EMPTY_LIST,
    backgroundJobs: EMPTY_LIST,
    subscribe(cb: () => void) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    bump() {
      channel.version += 1
      for (const cb of listeners) cb()
    },
    submit: () => {},
    cancel: () => {
      state.cancelCalls += 1
    },
    clear: () => {},
    notify: () => {},
    listModels: () => Promise.resolve([]),
    listSessions: () => Promise.resolve([]),
    deleteSession: () => Promise.resolve(true),
    renameSessionTo: () => Promise.resolve(true),
    setResumeTarget: () => {},
    loadOlder: () => {},
    mcpStatus: () => EMPTY_LIST,
    pushLocal: () => {},
    commandCompletions: (input: string) => completeCommands(input),
    stagedImageGeneration: () => 0,
    stagedImage: () => undefined,
    hasStagedImage: () => false,
    discardStagedImage: () => {},
    stagedImageLimits: () => ({
      maxImageBytes: 1_000_000,
      maxImagesPerMessage: 8,
      maxImageDimension: 8192,
      maxImagePixels: 64_000_000,
    }),
    stageComposerImage: async () => ({ stageId: 'stage-1' }),
    previewImages: () => EMPTY_LIST,
    subagentControl: { interrupt: () => {} },
    backgroundCurrent: async () => ({ ok: true, backgroundedSessionId: 'probe' }),
    agentViewRows: () => EMPTY_LIST,
    subscribeAgentView: noopUnsubscribe,
    settingsHost: () => undefined,
    settingsSections: () => EMPTY_LIST,
    subscribeSettingsSections: noopUnsubscribe,
    buildSessionTree: () => new Promise<null>(() => {}),
    openPluginScene: () => {},
    closePluginScene: () => {},
  }
  return channel
}

async function mountChat(): Promise<{
  term: InstanceType<typeof XTerm>
  stdin: PassThrough
  channel: ReturnType<typeof makeChannel>
  unmount: () => void
}> {
  const term = new XTerm({ cols: COLS, rows: ROWS, scrollback: 0, allowProposedApi: true })
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
    _write(_chunk: unknown, _encoding: BufferEncoding, callback: () => void) {
      callback()
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
  const channel = makeChannel()
  const chatNode = React.createElement(Chat, {
    channel,
    questionStore: new QuestionStore(),
    fullscreen: true,
  })
  const instance = await render(chatNode, {
    stdout: new FakeStdout() as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    stderr: new FakeStderr() as unknown as NodeJS.WriteStream,
    exitOnCtrlC: false,
    patchConsole: false,
  })
  let unmounted = false
  return {
    term,
    stdin,
    channel,
    unmount: () => {
      if (unmounted) return
      unmounted = true
      instance.unmount()
    },
  }
}

function screenHas(app: { term: InstanceType<typeof XTerm> }, text: string): boolean {
  return viewportLines(app.term, ROWS).some(row => row.includes(text))
}

let checks = 0
function check(name: string, ok: boolean): void {
  checks += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`)
  if (!ok) throw new VerifyFailure(name, 'assertion failed')
}

// ── Scenario: Esc/Ctrl+C over the task center while working ─────────────
const app = await mountChat()
try {
  // The working turn is up: the composer is on screen before any panel.
  await waitFor('boot', 'composer visible', () => screenHas(app, '╭'))

  // Ctrl+G opens the task center; the early-return tree replaces the
  // composer (its ╭ border is the discriminator).
  app.stdin.write(CTRL_G)
  await waitFor('open', 'task center title', () => screenHas(app, '任务中心'))
  await waitFor('open', 'task center empty tasks', () => screenHas(app, '暂无后台任务'))
  assertTrue('open', 'panel replaced the composer', !screenHas(app, '╭'))

  // Esc closes the panel and leaves the running turn alone.
  app.stdin.write(ESC)
  await waitFor('esc', 'panel closed (title gone)', () => !screenHas(app, '任务中心'))
  await waitFor('esc', 'composer back', () => screenHas(app, '╭'))
  check('Esc 关面板且不打断 working turn', app.channel.state.cancelCalls === 0)

  // Ctrl+C over the panel closes it too (the panel's own arm), same rule.
  app.stdin.write(CTRL_G)
  await waitFor('reopen', 'task center title', () => screenHas(app, '任务中心'))
  app.stdin.write(CTRL_C)
  await waitFor('ctrl-c', 'panel closed (title gone)', () => !screenHas(app, '任务中心'))
  await waitFor('ctrl-c', 'composer back', () => screenHas(app, '╭'))
  check('Ctrl+C 关面板且不打断 working turn', app.channel.state.cancelCalls === 0)

  // With the panel closed, a bare Esc still interrupts (the pre-existing
  // semantics the guard must not eat).
  app.stdin.write(ESC)
  await waitFor('interrupt', 'cancel observed', () => app.channel.state.cancelCalls > 0)
  check('面板关闭后 Esc 仍打断', app.channel.state.cancelCalls === 1)
} finally {
  app.unmount()
}

console.log(`verify-taskcenter-escape: all ${checks} checks passed`)
