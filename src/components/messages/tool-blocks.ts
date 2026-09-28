/**
 * Transcript tool-block model (grok-style scrollback blocks, dsh-lightweight).
 *
 * Pure logic — no React, no terminal. Reduces ChatRow[] to renderable block
 * metadata: tool blocks with lifecycle status and synthesized titles, verb-
 * group folds for runs of consecutive groupable calls ("Read 4 files"), and
 * narration binding (the assistant `⏵` line becomes the following tool
 * segment's intent title instead of a free-floating row). Rendering lives in
 * MessageList; tests drive this module directly (verify-tool-blocks.ts, t0).
 *
 * Grouping follows grok's scrollback rules (state/verb_group.rs): only
 * non-destructive reads/searches fold eagerly; bash/edit/other rows break a
 * run; collapsed finished thinking rows inside a run are absorbed (hidden
 * while the group stays folded) without counting toward membership.
 */

import type { ChatRow, ToolRow } from '../../adapter/ports/channel-view.js'
import { extractNarration } from '../../utils/narration.js'

/** Verb buckets for tool rows (grok VerbGroupKind, collapsed to dsh's set). */
export type ToolVerbKind = 'file' | 'search' | 'bash' | 'edit' | 'other'

/** Where a tool block's title came from, most specific first. */
export type ToolTitleSource = 'narration' | 'description' | 'input' | 'name'

export interface ToolBlockModel {
  readonly kind: 'tool'
  /** ToolRow.callId — stable id for expand/collapse memory. */
  readonly key: string
  /** The source ChatRow (renders the card body when expanded). */
  readonly row: ChatRow
  readonly verb: ToolVerbKind
  /** Always non-empty; see synthesizeTitle for the priority chain. */
  readonly title: string
  readonly titleSource: ToolTitleSource
  /** The `⏵` line bound to this block (first block of its tool segment). */
  readonly narration?: string
  readonly status: 'running' | 'ok' | 'error'
}

export interface ToolGroupModel {
  readonly kind: 'group'
  /** First member's key — the expand/collapse memory id (grok expanded_groups). */
  readonly firstKey: string
  readonly members: readonly ToolBlockModel[]
  /** Bucket-aggregated label, e.g. "Read 3 files · Searched 1 pattern". */
  readonly label: string
  /** Any member still running (drives live tense + timer in the renderer). */
  readonly running: boolean
  /** The segment's `⏵` line, when the first member carries one. */
  readonly narration?: string
}

export interface ToolBlockReduceResult {
  /** tool row id (ChatRow.id) → block model. */
  readonly blocks: ReadonlyMap<number, ToolBlockModel>
  /** Folded groups in row order; render the group row at its first member. */
  readonly groups: readonly ToolGroupModel[]
  /** first member row id → group (rendering insertion point). */
  readonly groupAt: ReadonlyMap<number, ToolGroupModel>
  /** Tool row ids absorbed into a folded group (skip their individual rows). */
  readonly groupedRows: ReadonlySet<number>
  /** Reasoning row ids absorbed by a folded group (hidden while folded). */
  readonly absorbedReasoning: ReadonlySet<number>
  /** Assistant row ids whose `⏵` line moved into a block title (strip it). */
  readonly narrationConsumed: ReadonlySet<number>
}

/** Verb buckets that fold eagerly into verb-group rows (grok: reads and
 * searches; commands/edits never fold, they only label truncation headers). */
const GROUPABLE: ReadonlySet<ToolVerbKind> = new Set(['file', 'search'])

/** Verb buckets whose tool rows collapse to a single header line by default
 * (grok-style one-line steps): the four high-frequency kinds. `other` keeps
 * the existing per-kind body budget. */
export const SINGLE_LINE_VERBS: ReadonlySet<ToolVerbKind> = new Set(['file', 'search', 'bash', 'edit'])

export function classifyVerb(name: string): ToolVerbKind {
  if (name === 'read') return 'file'
  if (name === 'grep' || name === 'glob' || name === 'web_search') return 'search'
  if (name === 'bash' || name === 'powershell') return 'bash'
  if (name === 'edit' || name === 'write') return 'edit'
  if (name === 'todo_write' || name === 'subagent') return 'other'
  // Plugin / upstream ids: substring fallbacks (exact dsh ids matched above,
  // so todo_write never trips the write-in-edit substring).
  if (name.includes('read')) return 'file'
  if (name.includes('search') || name.includes('grep') || name.includes('glob')) return 'search'
  if (name.includes('bash') || name.includes('shell') || name.includes('terminal')) return 'bash'
  if (name.includes('edit') || name.includes('write') || name.includes('replace')) return 'edit'
  return 'other'
}

function parseJsonArgs(args: string | undefined): Record<string, unknown> | undefined {
  if (args === undefined || args === '') return undefined
  try {
    const parsed: unknown = JSON.parse(args)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch { /* raw or truncated args — fall through */ }
  return undefined
}

function firstLine(text: string): string {
  const line = text.split('\n', 1)[0] ?? ''
  return line.trim()
}

function argString(args: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = args?.[key]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** Title priority: presenter description → call/result view fields → raw
 * args → tool name. Independent of model cooperation: every path yields a
 * meaningful title (this closes the structural gap grok closes with its
 * required `description` schema field). */
export function synthesizeTitle(tool: ToolRow): { title: string; source: Exclude<ToolTitleSource, 'narration'> } {
  const call = tool.callView
  if (call?.card === 'terminal' && typeof call.description === 'string' && call.description.trim() !== '') {
    return { title: firstLine(call.description), source: 'description' }
  }
  const result = tool.resultView
  if (result?.card === 'read' && typeof result.path === 'string' && result.path.trim() !== '') {
    return { title: result.path, source: 'input' }
  }
  if (result?.card === 'search') {
    const firstFile = result.card === 'search' && result.shape === 'matches' ? result.files[0]?.path : undefined
    const title = firstFile ?? (result.shape === 'paths' ? result.paths[0] : undefined)
    if (title !== undefined) return { title, source: 'input' }
  }
  if (call?.card === 'diff') {
    const path = call.diffs[0]?.path
    if (path !== undefined) return { title: path, source: 'input' }
  }
  const args = parseJsonArgs(tool.argsFull ?? tool.argsText)
  const fromArgs = argString(args, 'command') ?? argString(args, 'file_path') ?? argString(args, 'path') ?? argString(args, 'pattern') ?? argString(args, 'query')
  if (fromArgs !== undefined) return { title: firstLine(fromArgs), source: 'input' }
  const viewTitle = call?.card === 'generic' || call?.card === 'terminal' ? call.title : undefined
  if (viewTitle !== undefined && viewTitle.trim() !== '') return { title: firstLine(viewTitle), source: 'input' }
  return { title: tool.name, source: 'name' }
}

function bucketLabel(verb: ToolVerbKind, count: number, running: boolean): string {
  const noun = (one: string, many: string) => (count === 1 ? one : many)
  switch (verb) {
    case 'file': return `${running ? 'Reading' : 'Read'} ${count} ${noun('file', 'files')}`
    case 'search': return `${running ? 'Searching' : 'Searched'} ${count} ${noun('pattern', 'patterns')}`
    case 'bash': return `${running ? 'Running' : 'Ran'} ${count} ${noun('command', 'commands')}`
    case 'edit': return `${running ? 'Editing' : 'Edited'} ${count} ${noun('file', 'files')}`
    case 'other': return `${running ? 'Calling' : 'Called'} ${count} ${noun('tool', 'tools')}`
  }
}

/** Bucket-aggregated group label (grok BucketAccumulator): per-verb counts,
 * present tense for buckets with a running member. */
export function groupLabel(members: readonly ToolBlockModel[]): string {
  const counts = new Map<ToolVerbKind, { count: number; running: boolean }>()
  for (const member of members) {
    const bucket = counts.get(member.verb) ?? { count: 0, running: false }
    bucket.count += 1
    bucket.running = bucket.running || member.status === 'running'
    counts.set(member.verb, bucket)
  }
  return [...counts.entries()].map(([verb, { count, running }]) => bucketLabel(verb, count, running)).join(' · ')
}

/** Reduce a transcript to tool-block metadata. `expandedGroups` holds first
 * keys the user unfolded — those groups render member-by-member instead of
 * folding (members keep their rows; absorbed thinking reappears). */
export function reduceToolBlocks(rows: readonly ChatRow[], opts: { expandedGroups?: ReadonlySet<string> } = {}): ToolBlockReduceResult {
  const expandedGroups = opts.expandedGroups ?? new Set<string>()
  const blocks = new Map<number, ToolBlockModel>()
  const narrationConsumed = new Set<number>()

  // Pass 1 — narration binding + per-tool titles.
  // A `⏵` line is held while only tool/reasoning rows follow; it binds to the
  // FIRST tool block of that segment. Any other row (user, notice, bash, …)
  // breaks the binding — an unbound narration keeps its floating-row rendering.
  let pending: { text: string; rowIds: number[] } | undefined
  let consumedInSegment = false
  for (const row of rows) {
    if (row.kind === 'assistant') {
      const { narration } = extractNarration(row.text)
      if (narration !== undefined) {
        // A fresh ⏵ line starts a new intent: it overrides any pending one
        // (the previous line was either consumed or stays floating on its own).
        pending = { text: narration, rowIds: [row.id] }
        consumedInSegment = false
      }
      continue
    }
    if (row.kind === 'reasoning') continue
    if (row.kind === 'tool' && row.tool !== undefined) {
      const tool = row.tool
      const synthetic = synthesizeTitle(tool)
      const narration = pending !== undefined && !consumedInSegment ? pending.text : undefined
      if (narration !== undefined && pending !== undefined) {
        for (const id of pending.rowIds) narrationConsumed.add(id)
        consumedInSegment = true
      }
      const title = narration ?? synthetic.title
      const titleSource: ToolTitleSource = narration !== undefined ? 'narration' : synthetic.source
      blocks.set(row.id, { kind: 'tool', key: tool.callId, row, verb: classifyVerb(tool.name), title, titleSource, narration, status: tool.status })
      // A bash/edit/other row ends the groupable segment (grok: commands break runs).
      if (!GROUPABLE.has(classifyVerb(tool.name))) { pending = undefined; consumedInSegment = false }
      continue
    }
    // user / notice / interrupt / local / compact / subagent / job — break.
    pending = undefined
    consumedInSegment = false
  }

  // Pass 2 — verb-group folds over consecutive groupable runs.
  const groups: ToolGroupModel[] = []
  const groupAt = new Map<number, ToolGroupModel>()
  const groupedRows = new Set<number>()
  const absorbedReasoning = new Set<number>()
  let i = 0
  while (i < rows.length) {
    const first = rows[i]
    const firstBlock = first.kind === 'tool' ? blocks.get(first.id) : undefined
    if (firstBlock === undefined || !GROUPABLE.has(firstBlock.verb)) { i += 1; continue }
    const members: ToolBlockModel[] = []
    const claimedReasoning: number[] = []
    let j = i
    while (j < rows.length) {
      const row = rows[j]
      const block = row.kind === 'tool' ? blocks.get(row.id) : undefined
      if (row.kind === 'tool' && row.tool !== undefined && block !== undefined && GROUPABLE.has(block.verb)) {
        members.push(block)
        j += 1
        continue
      }
      if (row.kind === 'reasoning') { claimedReasoning.push(row.id); j += 1; continue }
      break
    }
    if (members.length >= 2 && !expandedGroups.has(firstBlock.key)) {
      const group: ToolGroupModel = {
        kind: 'group',
        firstKey: firstBlock.key,
        members,
        label: groupLabel(members),
        running: members.some(member => member.status === 'running'),
        narration: members.find(member => member.narration !== undefined)?.narration,
      }
      groups.push(group)
      groupAt.set(first.id, group)
      for (const member of members) groupedRows.add(member.row.id)
      for (const id of claimedReasoning) absorbedReasoning.add(id)
    }
    i = Math.max(j, i + 1)
  }

  return { blocks, groups, groupAt, groupedRows, absorbedReasoning, narrationConsumed }
}
