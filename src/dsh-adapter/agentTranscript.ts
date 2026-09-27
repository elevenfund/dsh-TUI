/**
 * Lightweight transcript folder for subagent sessions: raw SessionEvents →
 * renderable rows for the AgentTranscriptScene. This is a READ-ONLY view
 * over the child's durable log (live registry snapshot or JSONL tail), so
 * it deliberately re-derives the same row semantics as the main
 * projection's user/message, assistant/chunk, assistant/message,
 * tool/call and tool/result branches without touching any channel state.
 */

export interface AgentTranscriptTool {
  callId: string
  name: string
  argsText: string
  status: 'running' | 'ok' | 'error'
  resultText?: string
  errorText?: string
}

export interface AgentTranscriptRow {
  id: string
  kind: 'user' | 'assistant' | 'reasoning' | 'tool'
  text: string
  streaming: boolean
  tool?: AgentTranscriptTool
}

interface RawEvent {
  type?: unknown
  data?: unknown
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** First text block of a content-blocks array (or a bare string). */
function firstText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const block of content) {
    const item = record(block)
    if (item['type'] === 'text' && typeof item['text'] === 'string') text += item['text']
  }
  return text
}

function reasoningText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const block of content) {
    const item = record(block)
    if (item['type'] === 'reasoning' && typeof item['text'] === 'string') text += item['text']
  }
  return text
}

/**
 * Fold raw session events into transcript rows. Unknown event types are
 * ignored; the folder is stateless across calls (callers re-fold the full
 * snapshot each refresh — child logs are bounded by the child's turn, not
 * the parent's session).
 */
export function foldAgentTranscript(events: readonly unknown[]): AgentTranscriptRow[] {
  const rows: AgentTranscriptRow[] = []
  let seq = 0
  const toolRows = new Map<string, AgentTranscriptRow>()
  for (const raw of events) {
    const event = record(raw)
    const type = event['type']
    const data = record(event['data'])
    if (type === 'user/message') {
      const source = record(data['source'])
      if (source['kind'] !== 'user') continue
      const text = firstText(data['content'])
      if (text === '') continue
      rows.push({ id: `u${seq++}`, kind: 'user', text, streaming: false })
    } else if (type === 'assistant/chunk') {
      const chunk = record(data['chunk'])
      const text = typeof chunk['text'] === 'string' ? chunk['text'] : ''
      if (text === '') continue
      if (chunk['type'] === 'reasoning-delta') {
        const last = rows[rows.length - 1]
        if (last !== undefined && last.kind === 'reasoning' && last.streaming) last.text += text
        else rows.push({ id: `r${seq++}`, kind: 'reasoning', text, streaming: true })
      } else {
        const last = rows[rows.length - 1]
        if (last !== undefined && last.kind === 'assistant' && last.streaming) last.text += text
        else rows.push({ id: `a${seq++}`, kind: 'assistant', text, streaming: true })
      }
    } else if (type === 'assistant/message') {
      const message = record(data['message'])
      const text = firstText(message['content'])
      const think = reasoningText(message['content'])
      const last = rows[rows.length - 1]
      if (last !== undefined && last.kind === 'assistant' && last.streaming) {
        last.text = text !== '' ? text : last.text
        last.streaming = false
      } else if (text !== '') {
        rows.push({ id: `a${seq++}`, kind: 'assistant', text, streaming: false })
      }
      if (think !== '') {
        const lastReasoning = rows[rows.length - 1]
        if (lastReasoning !== undefined && lastReasoning.kind === 'reasoning' && lastReasoning.streaming) lastReasoning.streaming = false
        else rows.push({ id: `r${seq++}`, kind: 'reasoning', text: think, streaming: false })
      }
    } else if (type === 'tool/call') {
      const callId = typeof data['callId'] === 'string' ? data['callId'] : `t${seq}`
      const name = typeof data['name'] === 'string' ? data['name'] : 'tool'
      const args = typeof data['arguments'] === 'string' ? data['arguments'] : ''
      const row: AgentTranscriptRow = {
        id: `t${seq++}`,
        kind: 'tool',
        text: '',
        streaming: true,
        tool: { callId, name, argsText: args.slice(0, 160), status: 'running' },
      }
      toolRows.set(callId, row)
      rows.push(row)
    } else if (type === 'tool/result') {
      const message = record(data['message'])
      const source = record(message['source'])
      const callId = typeof source['callId'] === 'string' ? source['callId'] : undefined
      const row = callId !== undefined ? toolRows.get(callId) : undefined
      if (row?.tool === undefined || callId === undefined) continue
      row.streaming = false
      toolRows.delete(callId)
      const result = firstText(message['content'])
      if (data['error'] !== undefined) {
        row.tool.status = 'error'
        row.tool.errorText = typeof data['error'] === 'string' ? data['error'] : 'error'
      } else {
        row.tool.status = 'ok'
        row.tool.resultText = result.slice(0, 240) || undefined
      }
    }
  }
  return rows
}
