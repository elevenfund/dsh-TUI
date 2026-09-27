/**
 * verify-selection-narration — ⏵ narration 渲染回归（自
 * verify-transcript-selection.tsx 按场景拆分；断言与注释逐字搬移）：
 *
 *   T37 回合级 narration：⏵ 契约行渲染为该回合的 dim 步骤标题
 *   T38 步骤级 narration：每个工具调用前的 ⏵ 行与工具卡交错
 *
 * 场景：T37/T38 各自整体重赋 channel.rows（原文件即如此），与前置
 * 场景无状态耦合。
 *
 * 运行：node --import tsx/esm scripts/verify-selection-narration.tsx
 */
export {} // 模块边界：避免顶层 await/全局名与其他 verify 脚本冲突

import { bootSelectionScene, sleep, settled } from './lib/transcript-scene.mjs'

const scene = await bootSelectionScene()
const { stdin, channel, bump, check, finish, screenHas, findText } = scene

// T37: a reply carrying the working-activity `⏵` narration contract line
// renders it as the turn's dim step title above the body.
channel.rows = [
  { id: 1, kind: 'user', text: 'do it' },
  { id: 2, kind: 'assistant', text: '⏵ fixing the login page styles\n\nBody paragraph here.' },
]
bump()
check('T37a narration 首行渲染为步骤标题',
  await settled(() => screenHas('⏵ fixing the login page styles') && screenHas('Body paragraph here.')))
// T38: step-level narration — a fresh ⏵ line before every tool call
// interleaves step titles with tool cards (subagent-transcript granularity).
channel.rows = [
  { id: 1, kind: 'user', text: 'multi-step task' },
  { id: 2, kind: 'assistant', text: '⏵ count the log files\n' },
  {
    id: 3,
    kind: 'tool',
    text: '',
    tool: {
      callId: 'c38a',
      name: 'bash',
      argsText: '{"command":"ls /tmp | wc -l"}',
      callView: { card: 'terminal', title: 'ls /tmp | wc -l' },
      status: 'ok',
      resultText: '3',
      startedAt: Date.now() - 10_000,
      durationMs: 90,
    },
  },
  { id: 4, kind: 'assistant', text: '⏵ inspect the largest one\nSecond body note.' },
  {
    id: 5,
    kind: 'tool',
    text: '',
    tool: {
      callId: 'c38b',
      name: 'bash',
      argsText: '{"command":"wc -l big.log"}',
      callView: { card: 'terminal', title: 'wc -l big.log' },
      status: 'ok',
      resultText: '49',
      startedAt: Date.now() - 9_000,
      durationMs: 80,
    },
  },
  { id: 6, kind: 'assistant', text: '⏵ summarize the findings' },
]
bump()
check('T38a 多段 ⏵ 步骤行全部渲染', await settled(() =>
  screenHas('⏵ count the log files') && screenHas('⏵ inspect the largest one') && screenHas('⏵ summarize the findings')))
{
  const step1 = findText('⏵ count the log files')
  const card1 = findText('Bash(ls /tmp')
  const step2 = findText('⏵ inspect the largest one')
  const card2 = findText('Bash(wc -l')
  const step3 = findText('⏵ summarize the findings')
  check('T38b 步骤行与工具卡交错（步骤→卡→步骤→卡→步骤）',
    step1 !== null && card1 !== null && step2 !== null && card2 !== null && step3 !== null
    && step1.row < card1.row && card1.row < step2.row && step2.row < card2.row && card2.row < step3.row,
    `rows: s1=${step1?.row} c1=${card1?.row} s2=${step2?.row} c2=${card2?.row} s3=${step3?.row}`)
}
stdin.write('\x1b') // Esc 退出选择模式
await sleep(300) // 固定窗:pacing 等退出
channel.working = false
channel.rows = []
bump()
await sleep(300) // 固定窗:pacing 等清理

finish('verify-selection-narration')
