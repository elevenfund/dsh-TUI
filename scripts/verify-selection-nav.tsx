/**
 * verify-selection-nav — 消息选择模式的进入/退出与光标导航回归（自
 * verify-transcript-selection.tsx 按场景拆分；断言与注释逐字搬移）：
 *
 *   T1  空闲 Tab 进入选择模式（PromptInput 挂起：打字不落地）
 *   T2  进入即选中最后一个可选行（enterSelection 直接从 channel.rows 种子）
 *   T3  ↑/↓ 移动选中高亮（背景色在行间转移）
 *   T4  Enter 已改浮窗（T13），折叠展开归 l——l 展开并 pin 行首
 *   T5  Tab / T6 Esc 退出后打字恢复
 *   T9  选择模式里 Ctrl+O 随时生效并覆盖单行展开状态
 *   T10/T10f vim l/h 定向折叠；全局展开态独占折叠（Ctrl+O 契约）
 *   T12 nearest 光标滚动——视口内移动只动光标、页面纹丝不动
 *   T30 l/h 在无折叠语义的行上 no-op
 *   T14 鼠标点击输入簇退出选择模式
 *
 * 场景依赖：T2 依赖 T1 的进入态、T3 依赖 T2 的选中态……T12 依赖 T10f
 * 留下的 tool 行选中态，因此 T12 随本文件（而非 scroll 组）——拆分时的
 * 场景归属微调之一。T30/T14 之间的 assistant 行由 push 重建（原链路里
 * 由 T27 留下，overlay 组覆盖）。
 *
 * 运行：node --import tsx/esm scripts/verify-selection-nav.tsx
 */
export {} // 模块边界：避免顶层 await/全局名与其他 verify 脚本冲突

import { bootSelectionScene, markdownTurnRow, sleep, settled, FakeStdout, keySleep } from './lib/transcript-scene.mjs'

const scene = await bootSelectionScene()
const { stdin, channel, bump, check, finish, screenHas, findText, bgKey, fgKey, topOf, dimFg, defaultBg, plainFg, drained  } = scene

// T1: 空闲 Tab 进入选择模式；PromptInput 挂起，打字不落地。
stdin.write('\t')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
stdin.write('zz')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check('T1 Tab 进入后打字失效',  await settled(() => !screenHas('zz')) )

// T2: 进入即选中最后一个可选行——assistant 正文也可达（导航要能到最
// 底部的输出）；视觉是 ● 点亮，不刷整行蓝底。
const asstA = findText('●')
const bashA = findText('Bash(')
check(
  'T2 进入即选中末行 assistant 行（● 点亮、无整行背景）',
  asstA !== null && fgKey(asstA.col, asstA.row) !== plainFg && bgKey(asstA.col, asstA.row) === defaultBg,
)
check('T2b tool 行保持无高亮', bashA !== null && bgKey(bashA.col, bashA.row) === defaultBg)

// T3: ↑ 一次到 tool 行、再 ↑ 到 reasoning 行。
stdin.write('\x1b[A')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
const bash1 = findText('Bash(')
check(
  'T3a ↑ 后 tool 行高亮且点亮（bg+fg）',
  bash1 !== null && bgKey(bash1.col, bash1.row) !== defaultBg && fgKey(bash1.col, bash1.row) !== dimFg,
)
stdin.write('\x1b[A')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
const thought1 = findText('Thought')
const bash2 = findText('Bash(')
check(
  'T3a2 ↑↑ 后 reasoning 行高亮、tool 行释放',
  thought1 !== null && bash2 !== null && bgKey(thought1.col, thought1.row) !== defaultBg && bgKey(bash2.col, bash2.row) === defaultBg,
)
// T4: ↓ 回到 tool 行，l 展开折叠正文。
stdin.write('\x1b[B')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
stdin.write('l')
// 60 行正文 > 40 行视口：展开后视口必须 pin 在被展开行的顶部——首行
// 可见、末行被推出视口（pin 末行方向的回归即在此暴露）。
// （Enter 已改为 grok 的 "Enter details" 浮窗，展开折叠归 l/h——T13。）
check(
  'T4 l 展开后视口 pin 首行',
  await settled(() => screenHas('result-line-0') && !screenHas('result-line-59')),
  `line0=${screenHas('result-line-0')} line59=${screenHas('result-line-59')}`,
)

// T5: Tab 退出选择模式，打字恢复。
stdin.write('\t')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
stdin.write('zz')
check('T5 Tab 退出后打字恢复', await settled(() => screenHas('zz')))

// T6: 再进一次，Esc 也能退出并恢复打字。
stdin.write('\t')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
stdin.write('\x1b')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
stdin.write('qq')
check('T6 Esc 退出后打字恢复', await settled(() => screenHas('qq')))

// T9: 选择模式里 Ctrl+O 随时生效并覆盖单行展开状态。断言用 reasoning
// 行的 verbose 差异（展开=全文可见；收起=单行 Thought，正文不可见）。
for (let i = 0; i < 8; i++) stdin.write('\x1b[5~')
await drained() // 等输入批次与渲染帧排空
stdin.write('\t')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check('T9-pre 选择模式已激活', await settled(() => screenHas('esc to return to input')))
// 进入选择模式的光标现在落在末行 assistant（nearest 底对齐，页面回底）；
// 先 g 跳回顶部，reasoning/tool 回到屏内，Ctrl+O 的展开才可见。
stdin.write('g')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
stdin.write('\x0f') // Ctrl+O → transcript mode on
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check(
  'T9a 选择模式里 Ctrl+O 全局展开（reasoning 全文可见）',
  await settled(() => screenHas('reasoning body marker xyz')),
)
stdin.write('\x0f') // Ctrl+O → off，单行 expandedRows 一并清除
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check(
  'T9b Ctrl+O 收起覆盖单行展开（reasoning 回折叠）',
  await settled(() => !screenHas('reasoning body marker xyz') && !screenHas('result-line-59')),
)
stdin.write('\x1b')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）

// T10: vim l/h 定向折叠——l 只展开（并 pin 行首），h 只收起，幂等。
stdin.write('\t')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check('T10-pre 选择模式已激活', await settled(() => screenHas('esc to return to input')))
stdin.write('g')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
const user10 = findText('user line alpha')
check('T10a g 跳首行并高亮', user10 !== null && bgKey(user10.col, user10.row) !== defaultBg)
stdin.write('j')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
stdin.write('j')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
const bash10 = findText('Bash(')
check('T10b j j 选中 tool 行', bash10 !== null && bgKey(bash10.col, bash10.row) !== defaultBg)
stdin.write('l')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check(
  'T10c l 展开并 pin 首行',
  await settled(() => screenHas('result-line-0') && !screenHas('result-line-59')),
)
stdin.write('h')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check('T10d h 收起', await settled(() => !screenHas('result-line-0') && !screenHas('result-line-59')))
stdin.write('h') // 已收起：幂等无操作
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
const bash10b = findText('Bash(')
check('T10e h 幂等（仍收起、仍选中）', bash10b !== null && bgKey(bash10b.col, bash10b.row) !== defaultBg)

// T10f: 全局展开态独占折叠（Ctrl+O 契约）——l 在已全局展开的行上
// 不登记行级展开、不触发 pin 跳页；关回折叠全局态后该行保持折叠
// （旧行为会白登记一条，收起后展开残留）。
stdin.write('\x0f') // Ctrl+O → transcript mode on（tool 行随之展开）
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
const top10f = topOf()
stdin.write('l')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check(
  'T10f1 全局展开态 l 不跳页（视口顶不动）',  await settled(() => topOf() === top10f) )
stdin.write('\x0f') // Ctrl+O → off：无行级登记 → tool 行回折叠
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check(
  'T10f2 全局展开态 l 无行级登记（收起后无展开残留）',
  await settled(() => !screenHas('result-line-0') && !screenHas('result-line-59')),
)

// T12: nearest 光标滚动——视口内移动只动光标、页面纹丝不动（旧
// top-align 行为会把光标行钉到屏幕顶，页面每次跳变）。
const before12 = topOf()
stdin.write('k') // reasoning 行在屏内：光标上移，页面不动
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
const thought12 = findText('Thought')
check(
  'T12a 视口内 k 光标上移、页面不动',
  thought12 !== null && bgKey(thought12.col, thought12.row) !== defaultBg && topOf() === before12,
)
stdin.write('j') // 回 tool 行，同样在屏内
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
const bash12 = findText('Bash(')
check(
  'T12b 视口内 j 光标下移、页面不动',
  bash12 !== null && bgKey(bash12.col, bash12.row) !== defaultBg && topOf() === before12,
)
stdin.write('\x1b')
// 等退出真正生效（exitSelection 同步快照 rows，push 改同一数组引用：
// 快照先于 push 才能让重进 findLast 跟尾而非恢复旧光标）。
await settled(() => !screenHas('esc to return to input'))

// Scene bridge: T30 needs the selection cursor on the trailing assistant
// row (id 310). In the original chain T27 left it there; this battery pushes
// the same row and re-enters selection mode the way T27 did (findLast seeds
// the cursor on the new tail).
;(channel.rows as Array<Record<string, unknown>>).push(markdownTurnRow())
bump()
stdin.write('\t')
await drained() // 数据变更/重进后排空（render-quiet 锚）

// T30: l/h 在无折叠语义的行上 no-op——assistant/user 行按 l 不登记展开、
// 不触发 pin 跳页（grok 的行级展开只作用于 thought/tool 卡）。
const top30 = topOf()
stdin.write('l') // 光标在 assistant 行（id 310）
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check('T30a assistant 行 l 不跳页',  await settled(() => topOf() === top30) )
stdin.write('g') // 到首个可选行（user）
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
const top30b = topOf()
stdin.write('l') // user 行
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check('T30b user 行 l 不跳页',  await settled(() => topOf() === top30b) )
stdin.write('\x1b') // 退出选择模式（恢复 T14 的 '\t' 进入前提）
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）

// T14: 鼠标点击输入簇退出选择模式（Tab-back 的鼠标等价）。headless 终端
// 不应答 alt-screen 探测——onWrite 收到 ?1049$p 时回 DECRPM set，
// dispatchClick 的 altScreenActive 守卫随即放行 SGR 点击（真实终端自己
// 走完这条握手，链路同 drag-protocol I9b）。
FakeStdout.onWrite = chunk => {
  if (chunk.includes('[?1049$p')) {
    queueMicrotask(() => stdin.write('\x1b[?1049;2$y'))
  }
}
stdin.write('\t')
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check('T14a 重进选择模式',  await settled(() => screenHas('esc to return to input')) )
stdin.write('\x1b[I') // FOCUS_IN → 触发 alt-screen 探测
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
const inputRow = (() => {
  const lines = scene.viewportLines()
  for (let r = lines.length - 1; r >= 0; r--) {
    if (lines[r]!.includes('❯')) return r
  }
  return -1
})()
check('T14b 定位输入行', inputRow >= 0, `row=${inputRow}`)
stdin.write(`\x1b[<0;5;${inputRow + 1}M`) // press（SGR 坐标 1-based）
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
stdin.write(`\x1b[<0;5;${inputRow + 1}m`) // release → dispatchClick
await keySleep(100) // 键间节奏（每键一次 commit；PACE 免疫）
check('T14c 点击输入行退出选择模式',  await settled(() => !screenHas('esc to return to input')) )
stdin.write('mm')
check('T14d 退出后打字恢复', await settled(() => screenHas('mm')))
FakeStdout.onWrite = null

finish('verify-selection-nav')
