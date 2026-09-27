/**
 * verify-selection-interrupt — Ctrl+C 全局打断契约回归（自
 * verify-transcript-selection.tsx 按场景拆分；断言与注释逐字搬移）：
 *
 *   T19/T20 选择模式内：working 打断且停留；idle 退出选择模式
 *   T22/T23 浮窗内：working 打断且浮窗保持；idle 维持关闭语义
 *   T24     图片预览浮窗内：同一条全局打断契约
 *
 * 场景：基础 4 行 + 60 filler + c2 尾行 + fresh turn 行。原链路里 T19 的
 * 前提（选择模式 + 光标 tool 行）由 T13f 留下、T22 的前提（光标 reasoning
 * 行）由 T21c 留下——本文件用 g+jj / k 重建同一光标态，断言不变。
 *
 * 运行：node --import tsx/esm scripts/verify-selection-interrupt.tsx
 */
export {} // 模块边界：避免顶层 await/全局名与其他 verify 脚本冲突

import { bootSelectionScene, baseRows, longTailRows, imageTurnRow, sleep, settled, FakeStdout, keySleep } from './lib/transcript-scene.mjs'

const scene = await bootSelectionScene([
  ...baseRows(),
  ...longTailRows(),
  { id: 200, kind: 'user', text: 'fresh turn line' },
])
const { stdin, channel, bump, check, finish, screenHas, viewportLines, lineHighlighted, drained  } = scene

// Scene bridge: T19/T20 start from selection mode with the cursor on the
// tool row (the state T13f left in the original chain — the overlay battery
// covers T13). Tab enters, g + j + j walks the cursor onto the tool row.
stdin.write('\t')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
stdin.write('g')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
stdin.write('j')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
stdin.write('j')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）

// T19/T20: 选择模式下的 Ctrl+C（grok 语义：Cancel turn 全局可达）——
// working 时打断且停留在选择模式；idle 时退出选择模式（同 Esc/Tab 的
// 肌肉记忆，绝不清空隐藏输入框草稿）。
let cancelCount = 0
;(channel as Record<string, unknown>).cancel = () => {
  cancelCount++
}
;(channel as Record<string, unknown>).working = true
bump()
await drained() // 等输入批次与渲染帧排空
stdin.write('\x03')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check(
  'T19a 选择模式 working Ctrl+C 打断（cancel 调用、仍在选择模式）',
  cancelCount === 1 && screenHas('esc to return to input') && lineHighlighted('Bash('),
)
;(channel as Record<string, unknown>).working = false
bump()
await drained() // 等输入批次与渲染帧排空
stdin.write('\x03')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check('T20 选择模式 idle Ctrl+C 退出选择模式', !screenHas('esc to return to input'))
stdin.write('\t')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check('T20b 重进选择模式（光标恢复 tool 行）', screenHas('esc to return to input') && lineHighlighted('Bash('))

// Scene bridge: T22 opens the overlay after stepping the cursor up to the
// reasoning row (the state T21c left in the original chain — the scroll
// battery covers T21), so its `j` walks reasoning → tool as before.
stdin.write('k') // tool → reasoning
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）

// T22/T23: 浮窗内 Ctrl+C——working 时打断且浮窗保持（grok: Cancel 全局，
// Esc 才是 close）；idle 时维持关闭语义。
stdin.write('j') // reasoning → tool
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
stdin.write('\r')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check('T22a 浮窗打开', screenHas('Bash(seq 1 30)'))
;(channel as Record<string, unknown>).working = true
bump()
await drained() // 等输入批次与渲染帧排空
stdin.write('\x03')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check(
  'T22b 浮窗内 working Ctrl+C 打断且浮窗保持',
  cancelCount === 2 && screenHas('Bash(seq 1 30)'),
)
;(channel as Record<string, unknown>).working = false
bump()
await drained() // 等输入批次与渲染帧排空
stdin.write('\x03')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check('T23 浮窗内 idle Ctrl+C 关闭浮窗', !screenHas('Bash(seq 1 30)') && screenHas('esc to return to input'))
stdin.write('\x1b')
// 等退出真正生效（exitSelection 同步快照 rows，push 改同一数组引用：
// 快照先于 push 才能让重进 findLast 跟尾而非恢复旧光标）。
await settled(() => !screenHas('esc to return to input'))

// T24: 图片预览浮窗内 Ctrl+C——与 row-detail 同一条全局打断契约：
// working 时打断且浮窗保持（Cancel 全局，Esc 才是 close）；idle 时关闭。
// 浮窗经缩略图点击打开（完整 Chat 键位链，非组件直渲染）。headless
// 终端不应答 alt-screen 探测——同 T14 的 onWrite 应答后 SGR 点击放行。
// push 后走 '\t' 进选择模式：enterSelection 的 findLast + 底对齐 seek
// 把新行 forceMount 滚入视口（mock 原地 push 不触发 sticky 补画）。
;(channel.rows as Array<Record<string, unknown>>).push(imageTurnRow())
bump()
stdin.write('\t') // 退出选择模式后重进：findLast → 新行滚入
await drained() // 数据变更/重进后排空（render-quiet 锚）
check('T24a 缩略图渲染（fallback 文本）', await settled(() => screenHas('[Image · shot.png]')),
  `screen=${JSON.stringify(viewportLines().filter(l => l.trim() !== '').map(l => l.trim().slice(0, 60)))}`)
FakeStdout.onWrite = chunk => {
  if (chunk.includes('[?1049$p')) {
    queueMicrotask(() => stdin.write('\x1b[?1049;2$y'))
  }
}
stdin.write('\x1b[I') // FOCUS_IN → 触发 alt-screen 探测
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
const thumbRow = (() => {
  const lines = viewportLines()
  for (let r = 0; r < lines.length; r++) {
    if (lines[r]!.includes('Image · shot.png')) return r
  }
  return -1
})()
check('T24b 定位缩略图行', thumbRow >= 0, `row=${thumbRow}`)
stdin.write(`\x1b[<0;5;${thumbRow + 1}M`) // press（SGR 坐标 1-based）
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
stdin.write(`\x1b[<0;5;${thumbRow + 1}m`) // release → dispatchClick
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check('T24c 点击缩略图打开图片预览浮窗', screenHas('Open original'))
;(channel as Record<string, unknown>).working = true
bump()
await drained() // 等输入批次与渲染帧排空
stdin.write('\x03')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check(
  'T24d 图片浮窗内 working Ctrl+C 打断且浮窗保持',
  cancelCount === 3 && screenHas('Open original'),
)
;(channel as Record<string, unknown>).working = false
bump()
await drained() // 等输入批次与渲染帧排空
stdin.write('\x03')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check('T24e 图片浮窗内 idle Ctrl+C 关闭浮窗', !screenHas('Open original'))

finish('verify-selection-interrupt')
