/**
 * verify-selection-scroll — 选择模式的滚动/跳转/恢复回归（自
 * verify-transcript-selection.tsx 按场景拆分；断言与注释逐字搬移）：
 *
 *   T7/T7b 追加大量行后进入即 seek 末行；一路 ↑ 到顶也要滚入视口
 *   T11    G/g 跳尾行/首行（gg 第二按幂等）
 *   T15    Tab 退出再进入（中间无输入）恢复光标与视口
 *   T17    快照过期：退出后有新行，重进跟末行而非恢复旧光标
 *   T21    Ctrl+B / Ctrl+F vim 翻页，selectedId 保留
 *   T25    G 重粘 sticky（T25c 真机项以注释保留）
 *   T26    提交新 prompt 自动回底
 *
 * 场景：基础 4 行 + 60 filler + c2 尾行（原 T7 push 的内容直接构造），
 * 加 T17/T25 各自 push 的新行。原链路里夹在本组 case 之间的 T16/T18/
 * T13/T19/T20（overlay/interrupt 组）与 T22–T24（interrupt 组）在各自
 * 文件里重建前置，不改变本组断言的可观察条件。
 *
 * 运行：node --import tsx/esm scripts/verify-selection-scroll.tsx
 */
export {} // 模块边界：避免顶层 await/全局名与其他 verify 脚本冲突

import { bootSelectionScene, baseRows, longTailRows, imageTurnRow, sleep, settled, keySleep } from './lib/transcript-scene.mjs'

const scene = await bootSelectionScene([...baseRows(), ...longTailRows()])
const { stdin, channel, bump, check, finish, screenHas, viewportLines, lineHighlighted, drained } = scene

// T7: 滚动跟随——追加大量行后，Tab 进入选择模式会 findLast 末行并
// seekRow 滚入；随后一路 ↑ 到顶，顶行也要滚入视口。
stdin.write('\t')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check('T7a Tab 进入即 seek 到末行', await settled(() => screenHas('tail-check')))
// 一路 ↑ 走到第一个可选行（user，在 60 行 filler 之上、视口之外）。
// 单键间隔 100ms（人手速度）：同帧连发时 moveSelection 闭包里的
// selectedId 是旧值，光标走不动——真实按键每键之间有一次 commit。
for (let i = 0; i < 70; i++) {
  stdin.write('\x1b[A')
  await keySleep(100) // 单键间隔（每键一次 latch commit，人手节奏；PACE 免疫）
}
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check(
  'T7b ↑ 走到顶行时 seekRow 滚入视口',
  await settled(() => screenHas('user line alpha')),
  `uservis=${screenHas('user line alpha')} top=${JSON.stringify((viewportLines().find(l => l.trim() !== '') ?? '').slice(0, 50))} asstvis=${screenHas('assistant reply omega')}`,
)
// T7b 最后一个 forceMount 的清除宏任务（setTimeout 0）此刻可能尚未排空：
// 窗口还带着旧扩窗、末行 el 仍挂载；紧按 G 会让 scrollToElement 的 anchor
// 在清除触发的收窄 re-render 里随行一起卸载，anchorTop 读不到、seek 静默
// 丢失（HEAD 既有竞态，与被测行为无关；真实按键间隔远大于该宏任务）。
await sleep(150) // 固定窗:pacing 等待 forceMount 清除宏任务排空，无可观测锚点

// T11: G/g 跳尾行/首行（G 是 vim 习惯，单按 g 兼容 less；gg 第二按幂等）。
// 跳首行后 isSticky=false，屏顶会叠出 PinnedTurnHeader（同文本、无高亮），
// 所以断言必须找"文本匹配且该行带选中背景"的那一行。
stdin.write('G')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
const tail11 = scene.findText('tail-check')
check(
  'T11a G 跳末行并滚入（高亮）',
  tail11 !== null && scene.bgKey(tail11.col, tail11.row) !== scene.defaultBg,
)
stdin.write('g')
const ok11b = await settled(() => lineHighlighted('user line alpha'))
check(
  'T11b g 跳首行并滚入（高亮）',
  ok11b,
  `visible=${screenHas('user line alpha')}`,
)
stdin.write('g')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check(
  'T11c gg 第二按幂等（仍首行仍高亮）',  await settled(() => lineHighlighted('user line alpha')) )

// T15: Tab 退出再进入（中间无输入）恢复光标与视口——旧行为重进时
// findLast 种末行 + 滚底；只有 rows 变化（提交新消息）才应跟随底部。
stdin.write('\t') // 退出（Chat 分支消费）
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
stdin.write('\t') // 重进（PromptInput 的空闲 Tab）
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check(
  'T15a Tab 往返后光标恢复（仍 user 行、视口未跳底）',  await settled(() => screenHas('esc to return to input') && lineHighlighted('user line alpha') && screenHas('user line alpha')) )

// T17: 快照过期分支——退出后有新行（模拟提交），重进必须跟末行
// 而不是恢复旧光标（"输入了才滚到底"的另一半）。
stdin.write('\t') // 退出（快照当前 rows）
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
const rowsArr = channel.rows as Array<Record<string, unknown>>
rowsArr.push({ id: 200, kind: 'user', text: 'fresh turn line' })
bump()
await drained() // 数据变更后排空（render-quiet 锚）
stdin.write('\t') // 重进：rows 已变 → 跟末行
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check(
  'T17 提交新消息后重进跟随末行（非恢复旧光标）',  await settled(() => screenHas('esc to return to input') && lineHighlighted('fresh turn line')) )

// Scene bridge: T21 starts from the selection cursor on the tool row with the
// viewport parked on it (the state T20b left in the original chain — the
// interrupt battery covers T18/T13/T19/T20 in between). g + j + j rebuilds
// that cursor position without the overlay detour.
stdin.write('g')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
stdin.write('j')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
stdin.write('j')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）

// T21: Ctrl+B / Ctrl+F vim 翻页（同 PgUp/PgDn 页大小）——视口移动、
// selectedId 保留（k/j 把光标行拉回视口，翻页不与选择打架）。
stdin.write('\x02') // Ctrl+B → page up
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check('T21a Ctrl+B 翻到会话顶部', await settled(() => screenHas('user line alpha')))
stdin.write('k') // 光标 tool → reasoning，nearest seek 拉回视口
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check(
  'T21b 翻页后 selectedId 保留（k 拉回高亮）',  await settled(() => lineHighlighted('Thought')) , 
  `hl=${JSON.stringify(viewportLines().filter(l => l.trim() !== '').map(l => l.trim().slice(0, 44)))}`)
// Ctrl+F page-by-page to the bottom（filler 48 行、每页净进 viewport-1 行，
// 循环发送直到 clamp 到底：fresh turn 可见 + pill 消失）。
let pagedToBottom = false
for (let i = 0; i < 12 && !pagedToBottom; i++) {
  stdin.write('\x06')
  await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
  pagedToBottom = screenHas('fresh turn line') && !screenHas('back to bottom')
}
check('T21c Ctrl+F 连续翻页到底部（clamp 后 sticky 恢复、pill 消失）', pagedToBottom)

// Scene bridge: T25 scrolls against the trailing image row. In the original
// chain T24 (interrupt battery) left the composer, pushed the image row, then
// re-entered selection mode so enterSelection's findLast + bottom-aligned
// seek pulled the new row into view (probe-verified: T25 runs INSIDE
// selection mode — Ctrl+B/G are selection keys there).
stdin.write('\x1b') // 退出选择模式回 composer（原文 T23 尾）
// exitSelection 同步快照 rows（maxId/count）后才 setSelectionActive(false)；
// 下方 push 改的是同一数组引用，必须等 Esc 真正分发完（提示行消失的
// 渲染帧）再 push——否则快照把新行记进去，重进误判"未变"恢复旧光标。
// drained 探测不到这个：Esc 未分发时屏幕本来就静止。
await settled(() => !screenHas('esc to return to input'))
;(channel.rows as Array<Record<string, unknown>>).push(imageTurnRow())
bump()
stdin.write('\t') // 进选择模式：findLast → 新行滚入
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）

// T25: G 重粘 sticky——翻上去（自动跟随断开）→ G 跳末行恢复自动滚动 →
// 新行到达无需任何按键即滚入视口（grok 语义：跳到尾 = 重新跟随尾巴）。
stdin.write('\x02') // Ctrl+B 翻页离开底部
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check('T25a Ctrl+B 已离开底部',  await settled(() => !screenHas('image turn line')) )
stdin.write('G')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check('T25b G 跳末行（末行滚入）', await settled(() => screenHas('image turn line')))
// T25c（真机项，headless 不可测）：G 重粘 sticky 后，流式新行应自动
// 滚入。mock 原地 push 不换 rows 引用，挂载窗口与 scrollHeight 互相
// 锁死（sticky=true 也不挂尾），headless 复现不了真实 emitStream 的
// 跟随链——该语义由真机 tmux 场景验证（见 DEV.md）。

// T26: 提交新 prompt 自动回底——浏览历史时提交，视图回到对话尾
// （新问题的回答在尾部，grok 提交即回底）。
stdin.write('\x02') // Ctrl+B 翻上去（断开跟随）
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check('T26a 已离开底部',  await settled(() => !screenHas('image turn line')) )
stdin.write('\x1b') // 退出选择模式回 composer
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
stdin.write('followme')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
stdin.write('\r') // Enter 提交（mock submit 空函数，不落行）
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check(
  'T26b 提交后自动回底（尾部可见）',
  await settled(() => screenHas('image turn line')),
  `screen=${JSON.stringify(viewportLines().filter(l => l.trim() !== '').map(l => l.trim().slice(0, 50)).slice(-6))}`,
)

finish('verify-selection-scroll')
