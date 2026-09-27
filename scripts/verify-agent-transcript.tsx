/**
 * verify-agent-transcript — unit checks for foldAgentTranscript: raw child
 * session events → renderable rows (the task-center detail scene's data
 * path). Run: node --import tsx/esm scripts/verify-agent-transcript.tsx
 */
import { foldAgentTranscript } from '../src/dsh-adapter/agentTranscript.js'

let failed = 0
function check(name: string, ok: boolean, extra?: string): void {
  if (ok) console.log(`  ✓ ${name}`)
  else { failed++; console.error(`  ✗ ${name}${extra === undefined ? '' : ` — ${extra}`}`) }
}

const events = [
  { type: 'session/title', data: { title: 'noise' } },
  { type: 'user/message', data: { id: 'm1', source: { kind: 'user' }, content: [{ type: 'text', text: '统计文件数' }] } },
  { type: 'user/message', data: { id: 'm2', source: { kind: 'plugin' }, content: [{ type: 'text', text: 'injected' }] } },
  { type: 'assistant/chunk', data: { chunk: { type: 'reasoning-delta', text: '先想 ' } } },
  { type: 'assistant/chunk', data: { chunk: { type: 'reasoning-delta', text: '一下' } } },
  { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: '开始 ' } } },
  { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: '统计' } } },
  { type: 'tool/call', data: { callId: 'c1', name: 'Bash', arguments: '{"command":"ls"}' } },
  { type: 'tool/result', data: { message: { source: { callId: 'c1' }, content: [{ type: 'text', text: '122 files' }] } } },
  { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '共 122 个文件' }] } } },
  { type: 'tool/call', data: { callId: 'c2', name: 'Read', arguments: '{"path":"x"}' } },
  { type: 'tool/result', data: { error: 'ENOENT', message: { source: { callId: 'c2' }, content: [] } } },
]

const rows = foldAgentTranscript(events)
console.log('— foldAgentTranscript —')
check('U1 user 行保留（人类 source）', rows.some(r => r.kind === 'user' && r.text === '统计文件数'))
check('U2 注入 source 不生成 user 行', !rows.some(r => r.kind === 'user' && r.text === 'injected'))
const reasoning = rows.find(r => r.kind === 'reasoning')
check('U3 reasoning-delta 合并成一行', reasoning?.text === '先想 一下', reasoning?.text)
check('U4 text-delta 合并且 assistant/message 定稿',
  rows.some(r => r.kind === 'assistant' && r.text === '共 122 个文件' && !r.streaming),
  JSON.stringify(rows.filter(r => r.kind === 'assistant')))
const bash = rows.find(r => r.tool?.callId === 'c1')
check('U5 tool ok 结果落到 resultText 且不再 streaming',
  bash?.tool?.status === 'ok' && bash?.tool?.resultText === '122 files' && bash?.streaming === false)
const read = rows.find(r => r.tool?.callId === 'c2')
check('U6 tool error 落到 errorText', read?.tool?.status === 'error' && read?.tool?.errorText === 'ENOENT')
check('U7 未知事件类型被忽略', !rows.some(r => r.text.includes('noise')))
check('U8 行序：user → reasoning → assistant → tool → assistant',
  rows.map(r => r.kind).join(',') === 'user,reasoning,assistant,tool,assistant,tool',
  rows.map(r => r.kind).join(','))

const empty = foldAgentTranscript([{ type: 'nope' }, null, 42])
check('U9 全未知/脏输入 → 空行集', empty.length === 0)

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
