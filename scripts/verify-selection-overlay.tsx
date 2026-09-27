/**
 * verify-selection-overlay — row-detail 浮窗回归（自
 * verify-transcript-selection.tsx 按场景拆分；断言与注释逐字搬移）：
 *
 *   T13 Enter 打开 row-detail 浮窗（grok "Enter details" 语义）
 *   T16 浮窗标题分支（user → User message；reasoning → Thinking）
 *   T18 浮窗区域预算（输入簇增高时标题不被裁）
 *   T27 assistant 行浮窗（Reply 标题 + markdown 渲染 + 流式跟随）
 *
 * 场景：基础 4 行 + 60 filler + c2 尾行 + fresh turn 行（原 T7/T17 push
 * 的内容直接构造）。原链路顺序 T16→T18→T13 保留（T18 结尾的 g 跳首正是
 * T13 的前提）；T17（scroll 组）在本文件重建进入态后由 fresh turn 行
 * 承担其光标角色。
 *
 * 运行：node --import tsx/esm scripts/verify-selection-overlay.tsx
 */
export {} // 模块边界：避免顶层 await/全局名与其他 verify 脚本冲突

import { bootSelectionScene, baseRows, longTailRows, markdownTurnRow, sleep, settled } from './lib/transcript-scene.mjs'

const scene = await bootSelectionScene([
  ...baseRows(),
  ...longTailRows(),
  { id: 200, kind: 'user', text: 'fresh turn line' },
])
const { stdin, channel, bump, check, finish, screenHas, viewportLines, lineHighlighted } = scene

// Scene bridge: T16 opens from the selection cursor on the first user row
// (the state T15 left in the original chain — the scroll battery covers it).
// Enter seeds findLast on the trailing fresh turn row, g jumps to the head.
stdin.write('\t')
await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
stdin.write('g')
await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空

// T16: 浮窗标题分支——user 行 → User message + 原文；reasoning 行 →
// Thinking + 时长（T13 只测了 tool 行）。
stdin.write('\r')
await sleep(450) // 固定窗:pacing 等输入批次与渲染帧排空
check(
  'T16a user 行浮窗（User message 标题 + 原文）',
  await settled(() => screenHas('User message') && screenHas('user line alpha')),
)
stdin.write('\x1b')
await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
stdin.write('j') // user → reasoning（user 是首个可选行，k 不动）
await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
stdin.write('\r')
await sleep(450) // 固定窗:pacing 等输入批次与渲染帧排空
check(
  'T16b reasoning 行浮窗（Thinking 标题）',
  await settled(() => screenHas('Thinking · 0.8s')),
)
stdin.write('\x1b')
await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空

// Scene bridge: T18 opens from the cursor on the fresh turn row (the state
// T17 left in the original chain). G jumps to the trailing selectable row.
stdin.write('G')
await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空

// T18: 浮窗区域预算——输入簇增高（背景 agent 提示行 +1）时卡片顶部
// 不被 transcript 区域边缘裁掉（标题仍可见）。
;(channel as Record<string, unknown>).backgroundAgentsNeedingInput = 1
bump()
await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
stdin.write('\r')
await sleep(500) // 固定窗:pacing 等输入批次与渲染帧排空
check(
  'T18 输入簇增高时浮窗标题不被裁（maxRows=viewport 预算）',
  await settled(() => screenHas('User message')),
)
stdin.write('\x1b')
await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
;(channel as Record<string, unknown>).backgroundAgentsNeedingInput = undefined
bump()
await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
// 复原 T13 的前提：光标回首个可选行（T13a 从 user jj 到 tool）。
stdin.write('g')
await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空

// T13: Enter 打开 row-detail 浮窗（grok "Enter details" 语义）——全文在
// 卡片内滚动阅读；折叠展开归 l/h；Esc/Enter 关闭回选择模式且光标不动。
stdin.write('j')
await sleep(200) // 固定窗:pacing 等输入批次与渲染帧排空
stdin.write('j')
await sleep(250) // 固定窗:pacing 等输入批次与渲染帧排空
check('T13a jj 光标到 tool 行', lineHighlighted('Bash('))
stdin.write('\r')
await sleep(500) // 固定窗:pacing 等输入批次与渲染帧排空
const okTitle = await settled(() => screenHas('Bash(seq 1 30)'))
const okArgs = screenHas('$ {"command"')
const okHead = screenHas('result-line-0')
const okHint = screenHas('j/k scroll')
check(
  'T13b Enter 打开浮窗（标题+参数+输出头部+hint）',
  okTitle && okArgs && okHead && okHint,
  `title=${okTitle} args=${okArgs} head=${okHead} hint=${okHint} top=${JSON.stringify((viewportLines().find(l => l.trim() !== '') ?? '').slice(0, 70))}`,
)
check('T13c 60 行输出尾部初始在浮窗外', !screenHas('result-line-59'))
check(
  'T13c2 浮窗内源换行保真（一行独占一个 result-line-N，非软折行连排）',
  await settled(() => {
    // 行形态 `│ result-line-N   │`：卡片边框与内容同视觉行，底层 dim 文字
    // 可能从背板透出（◆/● 前缀）——按边框+文本匹配，不要求整行相等。
    const lines = viewportLines()
    return lines.some(l => l.includes('│ result-line-3')) && lines.some(l => l.includes('│ result-line-4'))
  }),
)
stdin.write('G')
await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
check('T13d 浮窗内 G 滚到输出尾部', await settled(() => screenHas('result-line-59') && !screenHas('result-line-0')))
stdin.write('\x1b')
await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
check(
  'T13e Esc 关闭浮窗、光标仍在 tool 行',
  !screenHas('j/k scroll') && screenHas('esc to return to input') && lineHighlighted('Bash('),
)
stdin.write('\r')
await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
stdin.write('\r')
await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空
check('T13f Enter 关闭浮窗', !screenHas('j/k scroll') && screenHas('esc to return to input'))

// Scene bridge: T27 opens from the composer with the view at the bottom
// (the state T26 left in the original chain — the scroll battery covers it).
// Esc leaves selection mode, the push mirrors T27's own, and Tab re-enters.
stdin.write('\x1b')
await sleep(250) // 固定窗:pacing 等输入批次与渲染帧排空

// T27: assistant 行 Enter 浮窗——标题 Reply、正文 markdown 渲染（grok 的
// 详情卡保留格式：code fence 与 ** 加粗标记被剥除，不按原文显示），且
// 浮窗开着时流式追加的内容跟随出现（流式行上读详情不被冻结）。
;(channel.rows as Array<Record<string, unknown>>).push(markdownTurnRow())
bump()
stdin.write('\t') // 重进选择模式（findLast 跟随新末行 id 310）
await sleep(400) // 固定窗:pacing 等输入批次与渲染帧排空
check('T27a 光标跟到新 assistant 行', await settled(() => lineHighlighted('bm') || screenHas('bm')))
stdin.write('\r') // Enter → 浮窗
await sleep(500) // 固定窗:pacing 等输入批次与渲染帧排空
check(
  'T27b assistant 浮窗 markdown（加粗标记剥除、标题 Reply）',
  await settled(() => screenHas('Reply') && screenHas('const value = 1') && !screenHas('**bm**') && screenHas('bm')),
  `screen=${JSON.stringify(viewportLines().filter(l => l.trim() !== '').map(l => l.trim().slice(0, 50)).slice(-8))}`,
)
;(channel.rows as Array<Record<string, unknown>>).find(r => r.id === 310)!.text =
  '**bm** prose\n\n```ts\nconst value = 1\n```\nstreaming tail marker\n'
bump()
check('T27c 浮窗跟随流式追加（无冻结）', await settled(() => screenHas('streaming tail marker')))
stdin.write('\x1b')
await sleep(300) // 固定窗:pacing 等输入批次与渲染帧排空

finish('verify-selection-overlay')
