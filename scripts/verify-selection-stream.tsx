/**
 * verify-selection-stream — 流式跟随回归（自 verify-transcript-selection.tsx
 * 按场景拆分；断言与注释逐字搬移）：
 *
 *   T35 流式中 Shift+G 跳尾并粘住（含高频帧与 settle 后不弹走）
 *   T36 单条消息按真实 token 节奏增长（每帧数十行）尾部不丢
 *
 * 场景：T35/T36 各自整体重赋 channel.rows（原文件即如此），与前置
 * 场景无状态耦合。
 *
 * 运行：node --import tsx/esm scripts/verify-selection-stream.tsx
 */
export {} // 模块边界：避免顶层 await/全局名与其他 verify 脚本冲突

import { bootSelectionScene, sleep, settled } from './lib/transcript-scene.mjs'

const scene = await bootSelectionScene()
const { stdin, channel, bump, check, finish, screenHas, viewportLines } = scene

// T35: Shift+G during a streaming turn — jump to the tail and KEEP
// FOLLOWING while the streaming row keeps growing (user report: the
// streaming rendering after the jump is still broken).
channel.rows = [
  ...Array.from({ length: 60 }, (_, i) => ({ id: 500 + i, kind: 'assistant', text: `filler35 ${i}` })),
  { id: 900, kind: 'assistant', text: 'stream base', streaming: true },
]
channel.working = true
bump()
await settled(() => screenHas('stream base'))
stdin.write('\x1b[1;2A') // Shift+Up → selection mode
await settled(() => screenHas('esc to return to input'))
// Page far away from the bottom (Ctrl+B pages up in selection mode).
for (let i = 0; i < 4; i++) {
  stdin.write('\x02')
  await sleep(150) // 固定窗:pacing 等翻页帧
}
check('T35-pre 已翻离底部', !screenHas('stream base'))
stdin.write('G') // Shift+G → jump to the live tail
check('T35a 流式中 G 跳到尾部', await settled(() => screenHas('stream base')))
// The row keeps streaming: each frame must stay visible (sticky follow).
for (let frame = 0; frame < 3; frame++) {
  channel.rows[channel.rows.length - 1] = { id: 900, kind: 'assistant', text: `stream base\nframe ${frame} tail-marker-${frame}`, streaming: true }
  bump()
  await sleep(200) // 固定窗:pacing 等流式帧渲染
}
check('T35b G 后连续流式帧保持跟随', await settled(() => screenHas('tail-marker-2')))
// Viewport integrity: no blank-band corruption after the jump + growth.
const blankRun = (() => {
  const lines = viewportLines()
  let run = 0
  let worst = 0
  for (const line of lines) {
    run = line.trim() === '' ? run + 1 : 0
    worst = Math.max(worst, run)
  }
  return worst
})()
check('T35c 跳尾增长后无视口空白带', blankRun <= 1, `blankRun=${blankRun}`)
// High-frequency deltas (real token cadence): 20 frames at ~50ms must
// all land without losing the tail or corrupting the viewport.
for (let frame = 0; frame < 20; frame++) {
  channel.rows[channel.rows.length - 1] = { id: 900, kind: 'assistant', text: `stream base\nburst frame ${frame} burst-tail-${frame}`, streaming: true }
  bump()
  await sleep(50) // 固定窗:pacing 模拟真实 token 节奏
}
check('T35d 高频流式帧尾部不丢', await settled(() => screenHas('burst-tail-19')))
// Settle mid-view: the row stops streaming — the viewport must stay at
// the tail, not snap away (height recompute on settle).
channel.rows[channel.rows.length - 1] = { id: 900, kind: 'assistant', text: 'stream base\nburst frame 19 burst-tail-19\nsettled final line', streaming: false, fresh: true }
bump()
check('T35e 流式行定稿后仍在尾部', await settled(() => screenHas('settled final line') && screenHas('burst-tail-19')))
// T36: single-message growth at REAL token cadence — tens of lines per
// frame (field report: the viewport drifts mid-list and loses the tail
// while a single long reply streams; mock's +1 line/frame hides it).
{
  const lines36: string[] = []
  const row36 = { id: 950, kind: 'assistant', text: '', streaming: true }
  channel.rows = [
    ...Array.from({ length: 40 }, (_, i) => ({ id: 540 + i, kind: 'assistant', text: `filler36 ${i}` })),
    row36,
  ]
  bump()
  await settled(() => screenHas('filler36 39'))
  for (let frame = 0; frame < 40; frame++) {
    for (let n = 0; n < 15; n++) lines36.push(`L${frame}-${n}`)
    row36.text = lines36.join('\n')
    bump()
    await sleep(35) // 固定窗:pacing 真实 token 帧率
  }
  const lastVisible = await settled(() => screenHas('L39-14'), { timeout: 4000 })
  check('T36a 高速率单条流式尾部不丢', lastVisible)
}

finish('verify-selection-stream')
