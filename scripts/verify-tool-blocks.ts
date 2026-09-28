#!/usr/bin/env node
/**
 * Tool-block reduction regression (T0, synchronous).
 *
 * Drives the real reduceToolBlocks/synthesizeTitle/groupLabel/classifyVerb
 * from src/components/messages/tool-blocks.ts with representative ChatRow
 * sequences: narration binding (⏵ line becomes the segment's first tool
 * title; unbound lines keep floating), title synthesis fallback chain,
 * lifecycle status passthrough, verb-group folds (consecutive read/search
 * runs, bash/edit breakers, absorbed thinking, running tense, expanded
 * groups). Mount-level rendering is covered by verify-tool-block-render.tsx.
 *
 * Run: node --import tsx/esm scripts/verify-tool-blocks.ts
 */
import {
  classifyVerb,
  groupLabel,
  reduceToolBlocks,
  synthesizeTitle,
  type ToolBlockModel,
} from '../src/components/messages/tool-blocks.js'
import type { ChatRow, ToolRow } from '../src/adapter/ports/channel-view.js'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail === '' ? '' : ` (${detail})`}`)
  if (!ok) failures++
}

let nextId = 1
function textRow(text: string): ChatRow {
  return { id: nextId++, kind: 'assistant', text }
}
function userRow(text = 'go'): ChatRow {
  return { id: nextId++, kind: 'user', text }
}
function thinkingRow(): ChatRow {
  return { id: nextId++, kind: 'reasoning', text: 'thinking…' }
}
function toolRow(tool: Partial<ToolRow> & { callId: string; name: string }): ChatRow {
  const row: ChatRow = {
    id: nextId++,
    kind: 'tool',
    text: '',
    tool: { argsText: '', status: 'ok', startedAt: 0, ...tool } as ToolRow,
  }
  return row
}
function toolsOf(result: ReturnType<typeof reduceToolBlocks>): ToolBlockModel[] {
  return [...result.blocks.values()]
}

// --- classifyVerb ------------------------------------------------------------
check('classifyVerb: dsh core tool ids map to their buckets',
  classifyVerb('read') === 'file'
  && classifyVerb('grep') === 'search' && classifyVerb('glob') === 'search' && classifyVerb('web_search') === 'search'
  && classifyVerb('bash') === 'bash' && classifyVerb('powershell') === 'bash'
  && classifyVerb('edit') === 'edit' && classifyVerb('write') === 'edit'
  && classifyVerb('todo_write') === 'other' && classifyVerb('subagent') === 'other')

// --- synthesizeTitle: the no-model-cooperation fallback chain ---------------
check('title: terminal description wins first',
  synthesizeTitle({ callId: 'a', name: 'bash', argsText: '', status: 'ok', startedAt: 0,
    callView: { card: 'terminal', title: 'git status', description: 'Check git status' } }).title === 'Check git status')
check('title: read resultView path',
  synthesizeTitle({ callId: 'a', name: 'read', argsText: '', status: 'ok', startedAt: 0,
    resultView: { card: 'read', path: 'src/main.ts' } }).title === 'src/main.ts')
check('title: search resultView first path',
  synthesizeTitle({ callId: 'a', name: 'grep', argsText: '', status: 'ok', startedAt: 0,
    resultView: { card: 'search', shape: 'paths', paths: ['a.ts', 'b.ts'], truncated: false, total: 2 } }).title === 'a.ts')
check('title: diff callView first path',
  synthesizeTitle({ callId: 'a', name: 'edit', argsText: '', status: 'ok', startedAt: 0,
    callView: { card: 'diff', diffs: [{ path: 'pkg/x.ts', oldText: null, newText: 'y' }] } }).title === 'pkg/x.ts')
check('title: raw args fallback (command, then file_path/pattern)',
  synthesizeTitle({ callId: 'a', name: 'bash', argsText: '{"command":"wc -l a.txt"}', status: 'ok', startedAt: 0 }).title === 'wc -l a.txt'
  && synthesizeTitle({ callId: 'a', name: 'read', argsText: '{"file_path":"src/ui.ts"}', status: 'ok', startedAt: 0 }).title === 'src/ui.ts'
  && synthesizeTitle({ callId: 'a', name: 'grep', argsText: '{"pattern":"toolBlocks"}', status: 'ok', startedAt: 0 }).title === 'toolBlocks')
check('title: multi-line command keeps its first line',
  synthesizeTitle({ callId: 'a', name: 'bash', argsText: '{"command":"echo hi\\necho bye"}', status: 'ok', startedAt: 0 }).title === 'echo hi')
check('title: last resort is the tool name',
  synthesizeTitle({ callId: 'a', name: 'subagent', argsText: '', status: 'ok', startedAt: 0 }).title === 'subagent')

// --- narration binding --------------------------------------------------------
{
  const result = reduceToolBlocks([
    textRow('⏵ 目录里有 4 个 txt 文件，现在并行读取\n\n正文补充'),
    toolRow({ callId: 'r1', name: 'read', argsText: '{"file_path":"note1.txt"}' }),
    toolRow({ callId: 'r2', name: 'read', argsText: '{"file_path":"note2.txt"}' }),
  ])
  const blocks = toolsOf(result)
  check('narration: binds to the first tool block as its title',
    blocks[0]?.title === '目录里有 4 个 txt 文件，现在并行读取' && blocks[0]?.titleSource === 'narration',
    `got ${blocks[0]?.title}`)
  check('narration: siblings fall back to input titles',
    blocks[1]?.title === 'note2.txt' && blocks[1]?.titleSource === 'input')
  check('narration: the assistant row is marked consumed (no floating row)',
    result.narrationConsumed.size === 1)
}
{
  const result = reduceToolBlocks([textRow('⏵ 我要开始干活了\n\n没有工具的纯聊天')])
  check('narration: unbound ⏵ line keeps its floating rendering',
    result.narrationConsumed.size === 0 && result.blocks.size === 0)
}
{
  const result = reduceToolBlocks([
    textRow('⏵ 读一下配置'),
    userRow(),
    toolRow({ callId: 'r1', name: 'read', argsText: '{"file_path":"cfg.json"}' }),
  ])
  const blocks = toolsOf(result)
  check('narration: a user row breaks the binding',
    blocks[0]?.title === 'cfg.json' && blocks[0]?.titleSource === 'input' && result.narrationConsumed.size === 0)
}
{
  const result = reduceToolBlocks([
    textRow('⏵ 先读后跑'),
    toolRow({ callId: 'r1', name: 'read', argsText: '{"file_path":"a.ts"}' }),
    toolRow({ callId: 'b1', name: 'bash', argsText: '{"command":"npm test"}' }),
    toolRow({ callId: 'r2', name: 'read', argsText: '{"file_path":"b.ts"}' }),
  ])
  const blocks = toolsOf(result)
  check('narration: bash breaks the groupable segment (no inheritance past it)',
    blocks[0]?.title === '先读后跑' && blocks[1]?.title === 'npm test' && blocks[2]?.title === 'b.ts')
}

// --- lifecycle passthrough -----------------------------------------------------
{
  const result = reduceToolBlocks([
    toolRow({ callId: 'a', name: 'read', argsText: '{"file_path":"x.ts"}', status: 'running' }),
    toolRow({ callId: 'b', name: 'bash', argsText: '{"command":"ls"}', status: 'error' }),
    toolRow({ callId: 'c', name: 'read', argsText: '{"file_path":"y.ts"}', status: 'ok', durationMs: 1200 }),
  ])
  const blocks = toolsOf(result)
  check('lifecycle: running/ok/error statuses pass through to blocks',
    blocks[0]?.status === 'running' && blocks[1]?.status === 'error' && blocks[2]?.status === 'ok')
  check('lifecycle: timing stays reachable on the source row',
    blocks[2]?.row.tool?.durationMs === 1200)
}

// --- verb-group folds ----------------------------------------------------------
{
  const rows = [
    textRow('⏵ 并行读取'),
    toolRow({ callId: 'r1', name: 'read', argsText: '{"file_path":"note1.txt"}' }),
    toolRow({ callId: 'r2', name: 'read', argsText: '{"file_path":"note2.txt"}' }),
    toolRow({ callId: 'r3', name: 'glob', argsText: '{"pattern":"*.txt"}' }),
    toolRow({ callId: 'r4', name: 'read', argsText: '{"file_path":"note3.txt"}' }),
  ]
  const result = reduceToolBlocks(rows)
  const group = result.groups[0]
  check('group: 4 consecutive groupable calls fold into one group',
    group !== undefined && group.members.length === 4)
  check('group: mixed buckets label aggregates per verb',
    group?.label === 'Read 3 files · Searched 1 pattern', `got ${group?.label}`)
  check('group: insertion point is the first member row; all members marked grouped',
    result.groupAt.get(rows[1]!.id) === group && result.groupedRows.size === 4)
  check('group: segment narration surfaces on the group model',
    group?.narration === '并行读取')
}
{
  const result = reduceToolBlocks([
    toolRow({ callId: 'r1', name: 'read', argsText: '{"file_path":"a.ts"}' }),
    toolRow({ callId: 'b1', name: 'bash', argsText: '{"command":"ls"}' }),
    toolRow({ callId: 'r2', name: 'read', argsText: '{"file_path":"b.ts"}' }),
  ])
  check('group: a bash call between reads breaks the run (no group of 2+)',
    result.groups.length === 0 && result.groupedRows.size === 0)
}
{
  const result = reduceToolBlocks([
    toolRow({ callId: 'solo', name: 'read', argsText: '{"file_path":"a.ts"}' }),
  ])
  check('group: a single groupable call never folds',
    result.groups.length === 0)
}
{
  const rows = [
    toolRow({ callId: 'r1', name: 'read', argsText: '{"file_path":"a.ts"}' }),
    thinkingRow(),
    toolRow({ callId: 'r2', name: 'read', argsText: '{"file_path":"b.ts"}' }),
  ]
  const result = reduceToolBlocks(rows)
  check('group: a finished thinking row between members is absorbed, not counted',
    result.groups[0]?.members.length === 2 && result.absorbedReasoning.size === 1,
    `members=${result.groups[0]?.members.length} absorbed=${result.absorbedReasoning.size}`)
}
{
  const result = reduceToolBlocks([
    toolRow({ callId: 'r1', name: 'read', argsText: '{"file_path":"a.ts"}', status: 'running' }),
    toolRow({ callId: 'r2', name: 'read', argsText: '{"file_path":"b.ts"}' }),
  ])
  check('group: a running member flips tense and flags the group',
    result.groups[0]?.label === 'Reading 2 files' && result.groups[0]?.running === true)
}
{
  const rows = [
    toolRow({ callId: 'r1', name: 'read', argsText: '{"file_path":"a.ts"}' }),
    toolRow({ callId: 'r2', name: 'read', argsText: '{"file_path":"b.ts"}' }),
  ]
  const result = reduceToolBlocks(rows, { expandedGroups: new Set(['r1']) })
  check('group: an expanded first key keeps members unfolded',
    result.groups.length === 0 && result.groupedRows.size === 0 && result.absorbedReasoning.size === 0)
}
{
  check('groupLabel: single bucket singular/plural',
    groupLabel([
      { kind: 'tool', key: 'a', row: {} as ChatRow, verb: 'file', title: 'a', titleSource: 'input', status: 'ok' },
    ]) === 'Read 1 file')
}

if (failures > 0) {
  console.error(`tool-blocks: ${failures} check(s) failed`)
  process.exit(1)
}
console.log('tool-blocks: all checks passed')
