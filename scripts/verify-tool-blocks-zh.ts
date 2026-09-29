/**
 * zh counterpart of verify-tool-blocks' group-label assertions: bucket
 * labels are i18n'd (an English label in a Chinese transcript reads as a
 * leak), and the en battery only pinned the English copy. Language is
 * pinned at process start, so set the env BEFORE importing src (that is
 * why the imports are dynamic here).
 * Run: node --import tsx/esm scripts/verify-tool-blocks-zh.ts
 */
process.env.DSH_TUI_LANG = 'zh'

// Type-only: erased at compile time, so it does not load src (and pin the
// language) before the env line above has run.
import type { ChatRow, ToolRow } from '../src/adapter/ports/channel-view.js'

const { reduceToolBlocks } = await import('../src/components/messages/tool-blocks.js')

let failures = 0
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail === '' ? '' : ` (${detail})`}`)
  if (!ok) failures++
}

let nextId = 1
function toolRow(tool: Partial<ToolRow> & { callId: string; name: string }): ChatRow {
  return {
    id: nextId++,
    kind: 'tool',
    text: '',
    tool: { argsText: '', status: 'ok', startedAt: 0, ...tool } as ToolRow,
  }
}

// Settled group: the label carries the Chinese verb + count + noun.
{
  const result = reduceToolBlocks([
    toolRow({ callId: 'r1', name: 'read', argsText: '{"file_path":"a.ts"}' }),
    toolRow({ callId: 'r2', name: 'read', argsText: '{"file_path":"b.ts"}' }),
    toolRow({ callId: 'r3', name: 'read', argsText: '{"file_path":"c.ts"}' }),
  ])
  check('zh: 三连 read 组标签', result.groups[0]?.label === '读取 3 个文件', `got ${result.groups[0]?.label}`)
}

// Running group: present-tense verb.
{
  const result = reduceToolBlocks([
    toolRow({ callId: 'r1', name: 'read', argsText: '{"file_path":"a.ts"}', status: 'running' }),
    toolRow({ callId: 'r2', name: 'read', argsText: '{"file_path":"b.ts"}', status: 'running' }),
  ])
  check('zh: 运行中组标签（现在进行）', result.groups[0]?.label === '读取中 2 个文件', `got ${result.groups[0]?.label}`)
}

// Mixed buckets aggregate per verb with the zh separator.
{
  const result = reduceToolBlocks([
    toolRow({ callId: 'r1', name: 'read', argsText: '{"file_path":"a.ts"}' }),
    toolRow({ callId: 'g1', name: 'glob', argsText: '{"pattern":"*.ts"}' }),
    toolRow({ callId: 'r2', name: 'read', argsText: '{"file_path":"b.ts"}' }),
  ])
  check('zh: 混合桶按动词聚合', result.groups[0]?.label === '读取 2 个文件 · 搜索 1 个模式', `got ${result.groups[0]?.label}`)
}

if (failures > 0) process.exit(1)
console.log('\nALL PASS')
