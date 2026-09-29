import React from 'react'
import { Box, Text, useInput, ScrollBox, type ScrollBoxHandle, useTerminalSize, useAnimationFrame } from '../ui.js'
import type { SubagentState } from '../dsh-adapter/subagents.js'
import { foldAgentTranscript, type AgentTranscriptRow } from '../dsh-adapter/agentTranscript.js'
import { Markdown } from './Markdown.js'
import { Divider } from './design-system/Divider.js'
import { ExitButton } from './SubagentDashboard.js'
import { FollowUpLine, useFollowUpInput } from './SubagentFollowUpInput.js'
import { UserPromptMessage } from './messages/UserPromptMessage.js'
import { toolDisplayName } from './messages/toolNames.js'
import { t } from '../i18n.js'
import { MULTIPLICATION_X, BLACK_CIRCLE } from '../terminal-utils/figures.js'

export interface AgentTranscriptSceneProps {
  subagent: SubagentState
  /** Folded transcript rows (foldAgentTranscript over the child's events). */
  rows: readonly AgentTranscriptRow[]
  /** Identity token that changes when the source events moved (each emit);
   * drives the refresh effect and the live tail-follow. */
  streamVersion: unknown
  loading: boolean
  onBack: () => void
  onRefresh: () => void
  onInterrupt?: (agentId: string) => void
  onFollowUp?: (agentId: string, text: string) => Promise<boolean> | boolean
  followUpEnabled?: boolean
}

/** Horizontal inset of the content column: scene paddingX (2×2) + the
 * assistant bullet column (2). MarkdownTable budgets column widths from the
 * FULL terminal width, so without passing this inset through, a table wider
 * than the content column gets re-wrapped by the Text layout and its
 * box-drawing borders break mid-row. */
const CONTENT_INSET = 6

/** Folded reasoning rows render collapsed to one preview line; l toggles. */
function ReasoningLine({ row, expanded, width }: { row: AgentTranscriptRow; expanded: boolean; width: number }): React.ReactNode {
  const preview = row.text.split('\n')[0]?.slice(0, 120) ?? ''
  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text dimColor wrap="truncate">{`✻ ${expanded ? '' : `${preview}${row.text.length > preview.length ? '…' : ''}`}`}</Text>
      {expanded && <Markdown dimColor cacheTokens={false} width={width}>{row.text}</Markdown>}
    </Box>
  )
}

function ToolLine({ row }: { row: AgentTranscriptRow }): React.ReactNode {
  const tool = row.tool
  if (tool === undefined) return null
  const glyph = tool.status === 'running' ? BLACK_CIRCLE : tool.status === 'error' ? MULTIPLICATION_X : '✓'
  const color = tool.status === 'running' ? 'warning' : tool.status === 'error' ? 'error' : 'success'
  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Box flexDirection="row" gap={1}>
        <Text color={color}>{glyph}</Text>
        <Text bold>{toolDisplayName(tool.name)}</Text>
        <Text dimColor wrap="truncate">{tool.argsText.slice(0, 80)}</Text>
      </Box>
      {tool.status !== 'running' && (tool.errorText ?? tool.resultText) !== undefined && (
        <Text dimColor wrap="truncate">{`  ${tool.errorText ?? tool.resultText ?? ''}`.slice(0, 160)}</Text>
      )}
    </Box>
  )
}

/**
 * AgentTranscriptScene — the subagent detail scene as a full conversation
 * (grok-style): the child's own transcript rendered with the main chat's
 * row semantics — user bubbles, markdown assistant messages, folded
 * reasoning, tool cards — instead of the summary/output/tools pager.
 * Streaming children refresh from the live event snapshot; settled ones
 * read the durable log. m follows up (continuable children), X interrupts
 * a running child, Esc returns to the task center.
 */
export function AgentTranscriptScene({
  subagent,
  rows,
  streamVersion,
  loading,
  onBack,
  onRefresh,
  onInterrupt,
  onFollowUp,
  followUpEnabled,
}: AgentTranscriptSceneProps): React.ReactNode {
  const scrollRef = React.useRef<ScrollBoxHandle | null>(null)
  const { rows: terminalRows, columns } = useTerminalSize()
  const contentWidth = Math.max(20, columns - CONTENT_INSET)
  const [expandedReasoning, setExpandedReasoning] = React.useState<ReadonlySet<string>>(() => new Set())
  const running = subagent.status === 'running' || subagent.status === 'starting'
  // While the child streams, re-read the event snapshot on its version
  // bumps and tail-follow the scroll.
  React.useEffect(() => { onRefresh() }, [streamVersion, onRefresh])
  React.useEffect(() => {
    if (running) scrollRef.current?.scrollToBottom()
  }, [running, streamVersion, rows.length])
  // 1s tick keeps the live status line fresh.
  const [clockRef] = useAnimationFrame(1000)
  const followUp = useFollowUpInput(async text => { await onFollowUp?.(subagent.agentId, text) })

  useInput((input, key, event) => {
    if (followUp.composing) {
      event.stopImmediatePropagation()
      followUp.handleKey(input, key)
      return
    }
    if (key.escape || (key.ctrl && input === 'c')) {
      event.stopImmediatePropagation()
      onBack()
      return
    }
    if (key.upArrow || input === 'k') {
      event.stopImmediatePropagation()
      scrollRef.current?.scrollBy(-1)
      return
    }
    if (key.downArrow || input === 'j') {
      event.stopImmediatePropagation()
      scrollRef.current?.scrollBy(1)
      return
    }
    // Half-page paging: Ctrl+F/B mirror the row-detail card's vim set
    // (u/d as the classic half-page aliases, PageUp/PageDown as the native
    // spelling).
    const viewport = Math.max(1, Math.floor((scrollRef.current?.getViewportHeight() ?? terminalRows - 10) / 2))
    if (key.pageUp || (key.ctrl && input === 'b') || (!key.ctrl && !key.meta && input === 'u')) {
      event.stopImmediatePropagation()
      scrollRef.current?.scrollBy(-viewport)
      return
    }
    if (key.pageDown || (key.ctrl && input === 'f') || (!key.ctrl && !key.meta && input === 'd')) {
      event.stopImmediatePropagation()
      scrollRef.current?.scrollBy(viewport)
      return
    }
    if (key.home || (!key.ctrl && !key.meta && input === 'g')) {
      // g / gg → top (single g is the less habit; the second press re-seeks
      // the same top and no-ops).
      event.stopImmediatePropagation()
      scrollRef.current?.scrollTo(0)
      return
    }
    if (key.end || (!key.ctrl && !key.meta && input === 'G')) {
      event.stopImmediatePropagation()
      scrollRef.current?.scrollToBottom()
      return
    }
    // l/h toggle the last reasoning fold (vim expand/collapse, matching
    // the main transcript's selection-mode keys).
    if (input === 'l' || input === 'h') {
      const lastReasoning = [...rows].reverse().find(row => row.kind === 'reasoning')
      if (lastReasoning !== undefined) {
        event.stopImmediatePropagation()
        setExpandedReasoning(previous => {
          const next = new Set(previous)
          if (input === 'l') next.add(lastReasoning.id)
          else next.delete(lastReasoning.id)
          return next
        })
      }
      return
    }
    if (input.toLowerCase() === 'x' && running && onInterrupt) {
      event.stopImmediatePropagation()
      onInterrupt(subagent.agentId)
      return
    }
    if (input.toLowerCase() === 'm' && followUpEnabled && onFollowUp) {
      event.stopImmediatePropagation()
      followUp.begin()
      return
    }
    event.stopImmediatePropagation()
  })

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} ref={clockRef}>
      <Divider color="accent" title={` ${subagent.description} `} />
      <Box flexDirection="row" gap={2} marginTop={1} marginBottom={1}>
        <Text dimColor>{subagent.model ?? subagent.provider ?? 'default'}</Text>
        <Text dimColor>{`· ${rows.length} ${t('agent-transcript-rows')}`}</Text>
        {loading && <Text dimColor>{t('agent-transcript-loading')}</Text>}
        <Box flexGrow={1} />
        <Text color={running ? 'warning' : subagent.status === 'failed' || subagent.status === 'cancelled' ? 'error' : 'success'}>
          {subagent.status}
        </Text>
        <ExitButton onClick={onBack} />
      </Box>

      <Box flexDirection="column" maxHeight={Math.max(10, terminalRows - 10)}>
        <ScrollBox ref={scrollRef} flexDirection="column" flexGrow={1}>
          {rows.length === 0 && !loading && (
            <Text dimColor>{t('agent-transcript-empty')}</Text>
          )}
          {rows.map(row => {
            if (row.kind === 'user') {
              return <UserPromptMessage key={row.id} text={row.text} marginTopOnTurn={false} isSelected={false} />
            }
            if (row.kind === 'assistant') {
              return (
                <Box key={row.id} flexDirection="row" width="100%">
                  <Box minWidth={2}><Text color="text">●</Text></Box>
                  <Markdown cacheTokens={false} width={contentWidth}>{row.text}</Markdown>
                </Box>
              )
            }
            if (row.kind === 'reasoning') {
              return <ReasoningLine key={row.id} row={row} expanded={expandedReasoning.has(row.id)} width={contentWidth} />
            }
            return <ToolLine key={row.id} row={row} />
          })}
        </ScrollBox>
      </Box>

      <Divider color="subtle" title="" />
      <Box marginTop={0} flexDirection="row">
        <Text dimColor>{`↑/↓/j/k ${t('subagent-hint-scroll')} · l/h ${t('agent-transcript-think-toggle')} · g/G ${t('agent-transcript-jump-hint')}`}</Text>
        {followUpEnabled && onFollowUp && <Text dimColor>{` · ${t('subagent-followup-key-hint')}`}</Text>}
        {running && onInterrupt && <Text dimColor>{` · ${t('subagent-interrupt-key-hint')}`}</Text>}
        <Text dimColor>{` · Esc ${t('subagent-hint-back')}`}</Text>
      </Box>
      {followUp.composing && (
        <FollowUpLine state={followUp} placeholder={t('subagent-followup-prompt')} />
      )}
    </Box>
  )
}

/**
 * Container for the transcript scene: owns the folded rows and re-reads the
 * child's raw events whenever `version` changes identity (the Chat passes
 * the channel object itself — every emit produces a new one, so a streaming
 * child refreshes live, while a settled durable child stays quiet).
 */
export function TaskCenterDetail({
  subagent,
  version,
  readTranscript,
  onBack,
  onInterrupt,
  onFollowUp,
  followUpEnabled,
}: {
  subagent: SubagentState
  version: unknown
  readTranscript: (agentId: string) => Promise<readonly unknown[]>
  onBack: () => void
  onInterrupt: (agentId: string) => void
  onFollowUp: (agentId: string, text: string) => Promise<boolean> | boolean
  followUpEnabled: boolean
}): React.ReactNode {
  const [rows, setRows] = React.useState<readonly AgentTranscriptRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const refresh = React.useCallback((): void => {
    let alive = true
    setLoading(true)
    void readTranscript(subagent.agentId)
      .then(events => {
        if (!alive) return
        setRows(foldAgentTranscript(events))
        setLoading(false)
      })
      .catch(() => {
        if (alive) setLoading(false)
      })
  }, [readTranscript, subagent.agentId])
  return (
    <AgentTranscriptScene
      subagent={subagent}
      rows={rows}
      streamVersion={version}
      loading={loading}
      onBack={onBack}
      onRefresh={refresh}
      onInterrupt={onInterrupt}
      onFollowUp={onFollowUp}
      followUpEnabled={followUpEnabled}
    />
  )
}
