/**
 * C-6.7 / C-6.6 selection regression battery (from the recheck review):
 *  - rewind must drop the selection cursor (the forked transcript replaces
 *    every row; a kept cursor would "restore" onto a same-numbered row
 *    with different content);
 *  - the selection cursor inside a folded verb-group must keep the group
 *    row highlighted (folded members render nothing of their own) and `l`
 *    on ANY member must unfold the group.
 * Mount path shared with the verify-selection-* batteries: fake channel +
 * headless xterm; the rewind plumbing (promptRewind "no opinion" → plain
 * confirm, rewindTo success) is patched onto the channel fixture.
 * Run: node --import tsx/esm scripts/verify-selection-rewind-fold.tsx
 */
import { bootSelectionScene, keySleep, settled } from './lib/transcript-scene.mjs'

let failures = 0
function report(name: string, ok: boolean, extra = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}

// ── Part 1 (C-6.7): a successful rewind clears the selection cursor ──
{
  const scene = await bootSelectionScene()
  const { stdin, channel, check, screenHas, lineHighlighted } = scene
  // "no opinion" lands on the plain confirm pane; a non-null text means
  // the fork succeeded (the restore lands back in the prompt).
  ;(channel as Record<string, unknown>).promptRewind = async () => undefined
  ;(channel as Record<string, unknown>).rewindTo = async () => 'restored message text'

  stdin.write('\t')
  await keySleep(100)
  stdin.write('g')
  await keySleep(100)
  stdin.write('j')
  await keySleep(100)
  stdin.write('j')
  await keySleep(100)
  check('P1 光标走上 tool 行（前置）', await settled(() => lineHighlighted('Bash(')))

  // Leaving selection mode KEEPS the cursor (restore on re-entry) — the
  // state the rewind below must consume.
  stdin.write('\x1b')
  await keySleep(100)
  stdin.write('\t')
  await keySleep(100)
  check('P1 重进选择模式光标恢复（前置）', await settled(() => lineHighlighted('Bash(')))

  stdin.write('\x1b')
  await keySleep(200)
  // Double-tap Esc on the empty input opens the rewind picker directly
  // (the slash route needs a populated channel.commandList). The first Esc
  // of the pair only arms the double-tap — the fake channel's notify is a
  // recorder, so assert the prompt through notifyCalls.
  const { notifyCalls } = scene
  stdin.write('\x1b')
  check('P1 双 Esc 提示出现', await settled(() => notifyCalls.some(text => text.includes('Press Esc again to rewind'))))
  await keySleep(100)
  stdin.write('\x1b')
  check('P1 rewind picker 打开', await settled(() => screenHas('Pick a message to rewind')))
  await keySleep(150)
  stdin.write('\r')
  check('P1 rewind 确认面板打开', await settled(() => screenHas('Rewind conversation')))
  await keySleep(150)
  stdin.write('\r')
  check('P1 rewind 执行（恢复文本回输入框）', await settled(() => screenHas('restored message text')))

  // The cursor must be gone: re-entering selection mode must NOT restore
  // onto the pre-rewind row (the fork replaced every row).
  stdin.write('\t')
  await keySleep(100)
  const stillHighlighted = await settled(() => lineHighlighted('Bash('))
  report('P1 rewind 后光标不再恢复到旧行', !stillHighlighted)

  scene.finish('selection-rewind')
}

// ── Part 2 (C-6.6): the cursor inside a folded verb-group ──
{
  // The S0 smoke checks and the highlight baseline ride the harness's
  // fixed literals ('user line alpha' / 'Bash(' / 'assistant reply omega'),
  // so the scene reuses them; the trailing bash row sits AFTER the read
  // run (verb clustering needs the three reads consecutive).
  const scene = await bootSelectionScene([
    { id: 100, kind: 'user', text: 'user line alpha' },
    { id: 101, kind: 'tool', text: '', tool: { callId: 'r1', name: 'read', argsText: '{"file_path":"note1.txt"}', status: 'ok', startedAt: 0, durationMs: 5 } },
    { id: 102, kind: 'tool', text: '', tool: { callId: 'r2', name: 'read', argsText: '{"file_path":"note2.txt"}', status: 'ok', startedAt: 0, durationMs: 5 } },
    { id: 103, kind: 'tool', text: '', tool: { callId: 'r3', name: 'read', argsText: '{"file_path":"note3.txt"}', status: 'ok', startedAt: 0, durationMs: 5 } },
    { id: 105, kind: 'tool', text: '', tool: { callId: 'b1', name: 'bash', argsText: '{"command":"ls"}', status: 'ok', startedAt: 0, durationMs: 3 } },
    { id: 104, kind: 'assistant', text: 'assistant reply omega' },
  ])
  const { stdin, check, screenHas, lineHighlighted, viewportLines } = scene

  check('P2 三连 read 折叠成组行', await settled(() => screenHas('Read 3 files')))

  stdin.write('\t')
  await keySleep(100)
  stdin.write('g')
  await keySleep(100)
  stdin.write('j')
  await keySleep(100)
  // Cursor on the group's first member: the group row (its only visible
  // stand-in) must highlight.
  check('P2 光标在首成员：组行高亮', await settled(() => lineHighlighted('Read 3 files')))

  // Folded members render null; j/k must STEP PAST them in one press —
  // the pre-fix cursor landed on a hidden member, pinned the highlight to
  // the group row, and read as "j did nothing" until the next press.
  stdin.write('j')
  await keySleep(100)
  check('P2 j 一步跨过隐藏成员到 bash 行', await settled(() => lineHighlighted('Bash(')))
  stdin.write('k')
  await keySleep(100)
  check('P2 k 回到组行（不落隐藏成员）', await settled(() => lineHighlighted('Read 3 files')))

  // `l` on the group row (first member) unfolds the group; the unfold
  // predicate honors ANY member's id, so a rewind-restored hidden member
  // opens it too (P1's restore path above).
  stdin.write('l')
  await keySleep(100)
  const readRows = () => viewportLines().filter(line => line.includes('Read(')).length
  check('P2 组行上 l 解组：成员行可见', await settled(() => readRows() >= 3), `${readRows()}`)

  scene.finish('selection-fold')
}

if (failures > 0) process.exit(1)
console.log('\nALL PASS')
