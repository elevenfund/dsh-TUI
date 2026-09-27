/**
 * verify-selection-subagents — 子代理管理面回归（自
 * verify-transcript-selection.tsx 按场景拆分；断言与注释逐字搬移）：
 *
 *   T31 status chip / settle toast / Ctrl+A dashboard 的追问投递
 *   T32 任务中心（Ctrl+G）/ 常驻浮层 / 转录详情场景
 *   T33 return-context split（strip vs 面板入口）/ 已结算行移除 / 表格宽度
 *   T34 working 行 thinking 尾行（liveThinkingTail 纯函数）
 *
 * 场景：基础 4 行 + 60 filler + c2 尾行（T31g 断言 filler 可见，视口在
 * 底部）。T31 前的主界面态即挂载初始态。
 *
 * 运行：node --import tsx/esm scripts/verify-selection-subagents.tsx
 */
export {} // 模块边界：避免顶层 await/全局名与其他 verify 脚本冲突

import { bootSelectionScene, baseRows, longTailRows, sleep, settled } from './lib/transcript-scene.mjs'

const scene = await bootSelectionScene([...baseRows(), ...longTailRows()])
const { stdin, channel, bump, check, finish, screenHas, viewportLines, findText, followUpCalls, notifyCalls, killCalls, removeCalls } = scene

// T31: subagent management surfaces — status chip, settlement toast, and
// the Ctrl+A dashboard's follow-up composer (send_message seam). The mock
// channel re-assigns channel.subagents (a fresh array reference per bump,
// matching the real projection's syncNow snapshot) so Chat's settlement
// effect observes the transition.
const saRunning = { agentId: 'sa-1', runId: 'sa-1', description: 'research task', provider: 'subagent', model: 'm', status: 'running', startedAt: Date.now() - 5000, output: [], outputEvents: [], toolCalls: [] }
channel.subagents = [saRunning, { ...saRunning, agentId: 'sa-2', runId: 'sa-2', description: 'old one-shot', status: 'completed', completedAt: Date.now() - 1000 }]
bump()
check('T31a running 子代理出现在状态行 chip（⑂ 1）', await settled(() => screenHas('⑂ 1')))
channel.subagents = [{ ...saRunning, status: 'completed', completedAt: Date.now() }]
bump()
await sleep(500) // 固定窗:pacing 等 settle effect 派发 toast
check('T31b 面板关闭时 settle 触发 toast',
  notifyCalls.some(text => text.includes('subagent done: research task')),
  JSON.stringify(notifyCalls))
channel.subagents = [saRunning]
bump()
await settled(() => screenHas('⑂ 1'))
stdin.write('\x01') // Ctrl+A → dashboard
await sleep(500) // 固定窗:pacing 等面板挂载帧
check('T31c Ctrl+A 打开子代理面板', screenHas('Subagent Dashboard') && screenHas('research task'))
check('T31d continuable 焦点行提示追问键', screenHas('m follow up'))
stdin.write('m')
await sleep(300) // 固定窗:pacing 等输入行挂载
check('T31e m 打开追问输入行', screenHas('type a follow-up'))
stdin.write('dig deeper')
await sleep(300) // 固定窗:pacing 等输入批次
stdin.write('\r')
await sleep(500) // 固定窗:pacing 等投递与 toast
check('T31f 追问经 send_message 投递并回执',
  followUpCalls.length === 1 && followUpCalls[0]![0] === 'sa-1' && followUpCalls[0]![1] === 'dig deeper'
  && notifyCalls.some(text => text.includes('follow-up delivered')),
  `calls=${JSON.stringify(followUpCalls)} notify=${JSON.stringify(notifyCalls)}`)
stdin.write('\x1b') // 关闭面板回主界面
await sleep(400) // 固定窗:pacing 等卸载帧
// The viewport keeps its pre-dashboard scroll position (mid-transcript
// filler rows), so assert the dashboard is gone and the transcript is back.
check('T31g Esc 关闭面板', !screenHas('Subagent Dashboard') && screenHas('filler line'))
channel.subagents = []
bump()
await sleep(300) // 固定窗:pacing 等重渲染（chip 消失，不影响后续）

// T32: task center — unified panel (Ctrl+G), agent strip, and the
// transcript detail scene.
const saT32 = { agentId: 'sa-1', runId: 'sa-1', description: 'research task', provider: 'subagent', model: 'glm', status: 'running', startedAt: Date.now() - 3000, output: ['scanning docs'], outputEvents: [], toolCalls: [{ name: 'Grep' }] }
channel.subagents = [saT32]
bump()
check('T32a 常驻浮层出现（◍ 描述 + 实时尾行 + ⌃G 提示）',
  await settled(() => screenHas('◍') && screenHas('research task') && screenHas('⌃G')))
stdin.write('\x07') // Ctrl+G → task center
await sleep(500) // 固定窗:pacing 等面板挂载
check('T32b Ctrl+G 打开任务中心（两区分区标题）',
  screenHas('Task Center') && screenHas('Tasks (0)') && screenHas('Subagents (1)'))
check('T32c 焦点行统计与追问提示', screenHas('research task') && screenHas('m follow up'))
stdin.write('\r') // Enter → transcript detail scene
await sleep(500) // 固定窗:pacing 等 events 读取与折叠
check('T32d 详情=完整对话转录（user prompt + 定稿 assistant + 工具卡）',
  screenHas('count tsx files under src') && screenHas('Found') && screenHas('122') && screenHas('Bash'),
  viewportLines().slice(0, 8).join(' | '))
stdin.write('m')
await sleep(300) // 固定窗:pacing 等输入行
stdin.write('go deeper')
await sleep(300) // 固定窗:pacing 等输入批次
stdin.write('\r')
await sleep(500) // 固定窗:pacing 等投递
check('T32e 转录场景内追问投递', followUpCalls.some(([id, text]) => id === 'sa-1' && text === 'go deeper'),
  JSON.stringify(followUpCalls))
stdin.write('\x1b') // 回面板
await sleep(300) // 固定窗:pacing 等返回
// Focus a running job row: seed one, reopen, kill with k.
channel.backgroundJobs = [{ id: 'j-9', kind: 'bash', label: 'watch logs', status: 'running', startedAt: Date.now() - 2000, outputLines: ['line-1'] }]
channel.subagents = [saT32]
bump()
await sleep(400) // 固定窗:pacing 等面板重渲染
check('T32f 面板含后台任务区行', screenHas('j-9') && screenHas('watch logs'))
// Move focus up into the tasks section then stop with x.
stdin.write('\x1b[A') // ↑ from subagents row (index 1) to job row (index 0)
await sleep(200) // 固定窗:pacing 等焦点移动
stdin.write('x')
await sleep(300) // 固定窗:pacing 等 kill 派发
check('T32g x 终止焦点后台任务', killCalls.length === 1 && killCalls[0] === 'j-9', JSON.stringify(killCalls))
stdin.write('\x1b') // 关闭面板
await sleep(300) // 固定窗:pacing 等卸载
check('T32h Esc 关闭任务中心回主界面', !screenHas('Task Center') && screenHas('◍'))
channel.subagents = []
channel.backgroundJobs = []
bump()
await sleep(300) // 固定窗:pacing 等清理重渲染

// T33: return-context split (strip vs panel entry), settled-row removal,
// and the detail scene's table-width fix. The strip lists RUNNING rows
// only, so the strip door is exercised on the live child.
const saRun33 = { agentId: 'sa-7', runId: 'sa-7', description: 'live worker', provider: 'subagent', model: 'glm', status: 'running', startedAt: Date.now() - 4000, output: ['working'], outputEvents: [], toolCalls: [] }
const saDone33 = { agentId: 'sa-9', runId: 'sa-9', description: 'settled worker', provider: 'subagent', model: 'glm', status: 'completed', startedAt: Date.now() - 9000, completedAt: Date.now() - 1000, output: [], outputEvents: [], toolCalls: [] }
channel.subagents = [saRun33, saDone33]
bump()
await settled(() => screenHas('◍') && screenHas('live worker'))
// Strip click opens the live child's detail (SGR mouse: press+release).
const stripPos = findText('live worker')
if (stripPos !== null) {
  stdin.write(`\x1b[<0;${stripPos.col + 3};${stripPos.row + 1}M`)
  await sleep(150) // 固定窗:pacing 让 press 先进 gesture latch
  stdin.write(`\x1b[<0;${stripPos.col + 3};${stripPos.row + 1}m`)
}
await settled(() => screenHas('count tsx files under src'))
check('T33a strip 点击打开详情（转录内容出现）', screenHas('count tsx files under src'))
stdin.write('\x1b') // Esc: strip entry returns to the MAIN session
await sleep(400) // 固定窗:pacing 等返回
check('T33b strip 进入的详情 Esc 回主界面（不回面板）',
  !screenHas('count tsx files under src') && !screenHas('Task Center') && screenHas('live worker'))
// Panel entry: Ctrl+G, j moves focus to the settled row, d removes it.
stdin.write('\x07') // Ctrl+G → task center
await sleep(500) // 固定窗:pacing 等面板挂载
check('T33c Ctrl+G 面板含已结算行', screenHas('Task Center') && screenHas('settled worker'))
stdin.write('j')
await sleep(200) // 固定窗:pacing 等焦点移动
check('T33d vim j 下移焦点到已结算行（d 提示出现）', screenHas('d remove'))
stdin.write('d') // d only fires on a settled subagent row
await sleep(300) // 固定窗:pacing 等删除派发
check('T33e d 移除已结算子代理（running 行不响应）',
  removeCalls.length === 1 && removeCalls[0] === 'sa-9'
  && notifyCalls.some(text => text.includes('subagent removed from the list')),
  `remove=${JSON.stringify(removeCalls)}`)
stdin.write('\r') // Enter → the settled child's detail (table markdown)
// Table borders must fit the content column (COLS 100 − 6 inset): without
// the width override the 95-cell top border re-wraps mid-row.
await settled(() => screenHas('completed') && viewportLines().some(line => line.includes('┌')))
const tableTop = viewportLines().find(line => line.includes('┌')) ?? ''
check('T33f 表格按内容列宽度收缩（顶边框 ≤94 列）', tableTop.trimEnd().length > 0 && tableTop.trimEnd().length <= 94,
  `len=${tableTop.trimEnd().length}`)
stdin.write('\x1b') // Esc: panel entry returns to the PANEL
await sleep(400) // 固定窗:pacing 等返回
check('T33g 面板进入的详情 Esc 回面板', screenHas('Task Center') && screenHas('Subagents'))
stdin.write('\x1b') // 关闭面板
await sleep(300) // 固定窗:pacing 等卸载
check('T33h Esc 关闭任务中心回主界面', !screenHas('Task Center') && screenHas('◍'))
channel.subagents = []
bump()
await sleep(300) // 固定窗:pacing 等清理重渲染

// T34: the working line's thinking phase shows the live reasoning tail
// (grok-style one-line thinking flow) instead of random phrases.
{
  const { liveThinkingTail } = await import('../src/components/ActivityLine.js')
  check('T34a liveThinkingTail 取流式 reasoning 尾行',
    liveThinkingTail([{ kind: 'reasoning', text: 'first line\n\n  tail of thinking  ', streaming: true }]) === 'tail of thinking')
  check('T34b 段间隙已 settle 的 reasoning 保留尾行',
    liveThinkingTail([{ kind: 'reasoning', text: 'done thinking', streaming: false }]) === 'done thinking')
  check('T34c 本 turn 无 reasoning（user 边界）回退短语',
    liveThinkingTail([{ kind: 'assistant', text: 'old', streaming: false }, { kind: 'user', text: 'new turn', streaming: false }, { kind: 'tool', text: '', streaming: false }]) === undefined)
}

finish('verify-selection-subagents')
