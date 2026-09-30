import React from 'react'
import { Box, Text, useInput, ScrollBox, type ScrollBoxHandle, useTerminalSize, useAnimationFrame } from '../ui.js'
import { formatJobDuration, type BackgroundJobState } from '../dsh-adapter/jobs.js'
import { formatDuration } from '../terminal-utils/format.js'
import type { SubagentState } from '../dsh-adapter/subagents.js'
import { t } from '../i18n.js'
import { Divider } from './design-system/Divider.js'
import { ExitButton } from './SubagentDashboard.js'
import { isPlainReturnInput } from '../utils/modifiers.js'
import { FollowUpLine, useFollowUpInput } from './SubagentFollowUpInput.js'
import { isMinimalMode } from '../minimalMode.js'
import { stringWidth } from '../ink/stringWidth.js'
import { MULTIPLICATION_X, BLACK_CIRCLE } from '../terminal-utils/figures.js'

export interface TaskCenterPanelProps {
  jobs: readonly BackgroundJobState[]
  subagents: SubagentState[]
  /** Continuable child ids: the follow-up composer appears only there. */
  continuableIds?: ReadonlySet<string>
  onClose: () => void
  /** Kill the focused running job (`job_kill`). */
  onKillJob: (id: string) => void
  /** Interrupt the focused running subagent (stops the current turn). */
  onInterrupt: (agentId: string) => void
  /** Drop a settled subagent row from the list surfaces (persisted). */
  onDeleteSubagent?: (agentId: string) => void
  /** Deliver a follow-up to a continuable subagent (send_message seam). */
  onFollowUp?: (agentId: string, text: string) => Promise<boolean> | boolean
  /** Open the full transcript scene for a subagent row. */
  onOpenSubagent?: (agentId: string) => void
}

/** One focusable entry in the merged list, tagged by section. */
type Entry =
  | { section: 'tasks'; job: BackgroundJobState }
  | { section: 'subagents'; subagent: SubagentState }

function jobStatusInfo(status: BackgroundJobState['status']): { glyph: string; color: 'warning' | 'success' | 'error' | undefined; label: string } {
  // Minimal mode drops the color (JobsPanel symmetry): the glyphs alone
  // carry the state, so a monochrome terminal reads the same panel.
  const minimal = isMinimalMode()
  if (status === 'completed') return { glyph: '✓', color: minimal ? undefined : 'success', label: t('jobs-status-completed') }
  if (status === 'failed') return { glyph: MULTIPLICATION_X, color: minimal ? undefined : 'error', label: t('jobs-status-failed') }
  if (status === 'killed') return { glyph: MULTIPLICATION_X, color: minimal ? undefined : 'error', label: t('jobs-status-killed') }
  if (status === 'stopping') return { glyph: '·', color: minimal ? undefined : 'warning', label: t('jobs-status-stopping') }
  return { glyph: minimal ? '·' : BLACK_CIRCLE, color: minimal ? undefined : 'warning', label: t('jobs-status-running') }
}

function subagentStatusInfo(sub: SubagentState): { glyph: string; color: 'warning' | 'success' | 'error' | undefined; label: string } {
  const minimal = isMinimalMode()
  const running = sub.status === 'running' || sub.status === 'starting'
  if (running) return { glyph: minimal ? '·' : BLACK_CIRCLE, color: minimal ? undefined : 'warning', label: t('subagent-status-running') }
  if (sub.status === 'unknown') return { glyph: '○', color: undefined, label: t('subagent-status-unknown') }
  if (sub.status === 'failed' || sub.status === 'cancelled') return { glyph: MULTIPLICATION_X, color: minimal ? undefined : 'error', label: t('subagent-status-failed') }
  return { glyph: '✓', color: minimal ? undefined : 'success', label: t('subagent-status-completed') }
}

function formatSubagentDuration(sub: SubagentState): string {
  const running = sub.status === 'running' || sub.status === 'starting'
  const ms = running ? Date.now() - sub.startedAt : (sub.completedAt !== undefined ? sub.completedAt - sub.startedAt : 0)
  return formatDuration(ms)
}

function subagentTokens(sub: SubagentState): number {
  const tokens = sub.tokens
  if (tokens === undefined) return 0
  return tokens.total ?? ((tokens.input ?? 0) + (tokens.output ?? 0))
}

/** Hard single-line clip by display width (shared rule with JobsPanel). */
function clipLine(text: string, maxWidth: number): string {
  if (maxWidth <= 1) return ''
  let width = 0
  let index = 0
  while (index < text.length) {
    const next = text.codePointAt(index)!
    const char = String.fromCodePoint(next)
    const charWidth = stringWidth(char)
    if (width + charWidth > maxWidth - 1) break
    width += charWidth
    index += char.length
  }
  return index < text.length ? `${text.slice(0, index)}…` : text
}

function TaskRow({ entry, focused, columns, onOpen }: { entry: Entry; focused: boolean; columns: number; onOpen?: () => void }): React.ReactNode {
  const info = entry.section === 'tasks' ? jobStatusInfo(entry.job.status) : subagentStatusInfo(entry.subagent)
  const labelWidth = Math.max(10, (columns ?? 80) - 42)
  const header = entry.section === 'tasks' ? (
    <>
      <Text dimColor>{entry.job.id}</Text>
      <Text dimColor>·</Text>
      <Text dimColor>{entry.job.kind}</Text>
      <Text dimColor>·</Text>
      <Text bold={focused} color={focused ? 'accent' : undefined}>{clipLine(entry.job.label, labelWidth)}</Text>
      <Box flexGrow={1} />
      <Text dimColor>{formatJobDuration(entry.job)}</Text>
      <Text dimColor>·</Text>
      <Text color={info.color}>{info.label}</Text>
    </>
  ) : (
    <>
      <Text bold={focused} color={focused ? 'accent' : undefined}>{clipLine(entry.subagent.description, labelWidth)}</Text>
      <Text dimColor>·</Text>
      <Text>{entry.subagent.model ?? entry.subagent.provider ?? 'default'}</Text>
      <Box flexGrow={1} />
      <Text dimColor>{`${formatSubagentDuration(entry.subagent)} · ${subagentTokens(entry.subagent) || '—'} tok · ${entry.subagent.toolCalls.length} tools`}</Text>
      <Text dimColor>·</Text>
      <Text color={info.color}>{info.label}</Text>
    </>
  )
  const detail = entry.section === 'tasks' ? (
    <>
      {entry.job.command !== undefined && (
        <Text dimColor wrap="truncate">{`    ${t('jobs-panel-command')} ${clipLine(entry.job.command, labelWidth + 24)}`}</Text>
      )}
      {entry.job.outputLines.slice(-4).map((line, index) => (
        <Text key={`${entry.job.id}-out-${index}`} dimColor wrap="truncate">{`    │ ${clipLine(line, labelWidth + 24)}`}</Text>
      ))}
    </>
  ) : (() => {
    const running = entry.subagent.status === 'running' || entry.subagent.status === 'starting'
    const live = running ? entry.subagent.output[entry.subagent.output.length - 1] : undefined
    const tool = entry.subagent.toolCalls[entry.subagent.toolCalls.length - 1]
    return (
      <>
        {tool !== undefined && (
          <Text dimColor wrap="truncate">{`    ${t('task-center-last-tool')} ${clipLine(tool.name ?? '', labelWidth + 24)}`}</Text>
        )}
        {live !== undefined && (
          <Text dimColor wrap="truncate">{`    │ ${clipLine(live, labelWidth + 24)}`}</Text>
        )}
      </>
    )
  })()
  return (
    <Box flexDirection="column" onClick={onOpen}>
      <Box flexDirection="row" gap={1}>
        <Text color={focused ? 'accent' : undefined}>{focused ? '❯' : ' '}</Text>
        <Text color={info.color}>{info.glyph}</Text>
        {header}
      </Box>
      {focused && <Box flexDirection="column">{detail}</Box>}
    </Box>
  )
}

/**
 * Task center (`Ctrl+G`) — the unified classified panel: background tasks
 * (bash/pty jobs) and subagents on one screen, grok-style classification.
 * The legacy `Ctrl+A` dashboard and `/jobs` panel stay untouched; this is
 * the merged view over the same channel state. Keyboard: ↑/↓/j/k move
 * across BOTH sections (vim), Enter opens a subagent's transcript scene,
 * `x` stops the focused running row (job kill / subagent interrupt), `d`
 * drops a settled subagent row, `m` follows up on a continuable subagent,
 * Esc closes.
 */
export function TaskCenterPanel({
  jobs,
  subagents,
  continuableIds,
  onClose,
  onKillJob,
  onInterrupt,
  onDeleteSubagent,
  onFollowUp,
  onOpenSubagent,
}: TaskCenterPanelProps): React.ReactNode {
  const [focusIndex, setFocusIndex] = React.useState(0)
  const scrollRef = React.useRef<ScrollBoxHandle | null>(null)
  const { rows, columns } = useTerminalSize()
  // 1s tick keeps live durations counting while the panel is open.
  const [clockRef] = useAnimationFrame(1000)
  // The follow-up target is pinned when composing begins: focus may move
  // while the draft is being typed.
  const followUpTargetRef = React.useRef<string | null>(null)
  const followUp = useFollowUpInput(async text => {
    const target = followUpTargetRef.current
    if (target !== null) await onFollowUp?.(target, text)
  })

  const entries: Entry[] = React.useMemo(() => [
    ...jobs.map((job): Entry => ({ section: 'tasks', job })),
    ...subagents.map((sub): Entry => ({ section: 'subagents', subagent: sub })),
  ], [jobs, subagents])
  const focus = Math.min(focusIndex, Math.max(0, entries.length - 1))
  const focusedEntry = entries[focus]
  const followUpReady = focusedEntry?.section === 'subagents'
    && onFollowUp !== undefined
    && continuableIds?.has(focusedEntry.subagent.agentId) === true
  const interruptReady = focusedEntry?.section === 'subagents'
    && (focusedEntry.subagent.status === 'running' || focusedEntry.subagent.status === 'starting')
  const settledSubagentFocused = focusedEntry?.section === 'subagents'
    && focusedEntry.subagent.status !== 'running' && focusedEntry.subagent.status !== 'starting'
  const deleteReady = settledSubagentFocused && onDeleteSubagent !== undefined

  useInput((input, key, event) => {
    if (followUp.composing) {
      event.stopImmediatePropagation()
      followUp.handleKey(input, key)
      return
    }
    if (key.escape || (key.ctrl && input === 'c')) {
      event.stopImmediatePropagation()
      onClose()
      return
    }
    const moveUp = key.upArrow || input === 'k'
    const moveDown = key.downArrow || input === 'j'
    if (moveUp) {
      event.stopImmediatePropagation()
      setFocusIndex(i => Math.max(0, Math.min(i, entries.length - 1) - 1))
      scrollRef.current?.scrollBy(-1)
      return
    }
    if (moveDown) {
      event.stopImmediatePropagation()
      setFocusIndex(i => Math.min(entries.length - 1, Math.max(0, i) + 1))
      scrollRef.current?.scrollBy(1)
      return
    }
    if (isPlainReturnInput(input, key)) {
      event.stopImmediatePropagation()
      if (focusedEntry?.section === 'subagents' && onOpenSubagent) onOpenSubagent(focusedEntry.subagent.agentId)
      return
    }
    // x stops the focused running row: job_kill authority on a task row,
    // turn-interrupt on a subagent row.
    if (input.toLowerCase() === 'x') {
      if (focusedEntry?.section === 'tasks') {
        const { job } = focusedEntry
        if (job.status === 'running' || job.status === 'stopping') {
          event.stopImmediatePropagation()
          onKillJob(job.id)
        }
        return
      }
      if (interruptReady && focusedEntry?.section === 'subagents') {
        event.stopImmediatePropagation()
        onInterrupt(focusedEntry.subagent.agentId)
      }
      return
    }
    // d drops the focused settled subagent row (persisted removal).
    if (input === 'd' && deleteReady && focusedEntry?.section === 'subagents') {
      event.stopImmediatePropagation()
      onDeleteSubagent!(focusedEntry.subagent.agentId)
      return
    }
    // m opens the follow-up composer on the focused continuable subagent.
    if (input === 'm' && followUpReady && focusedEntry?.section === 'subagents') {
      event.stopImmediatePropagation()
      followUpTargetRef.current = focusedEntry.subagent.agentId
      followUp.begin()
      return
    }
    event.stopImmediatePropagation()
  })

  const runningJobs = jobs.filter(job => job.status === 'running' || job.status === 'stopping').length
  const runningSubagents = subagents.filter(sub => subagentStatusInfo(sub).color === 'warning').length
  const doneCount = entries.length - runningJobs - runningSubagents
  const minimal = isMinimalMode()

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} ref={clockRef}>
      <Divider color="accent" title={t('task-center-title')} />
      <Box flexDirection="row" gap={3} marginTop={1} marginBottom={1}>
        <Text>
          <Text color="warning">{runningJobs + runningSubagents}</Text>
          <Text dimColor>{` ${t('task-center-running')}`}</Text>
        </Text>
        <Text>
          <Text color="success">{doneCount}</Text>
          <Text dimColor>{` ${t('task-center-done')}`}</Text>
        </Text>
        <Box flexGrow={1} />
        <Text dimColor>{minimal ? '' : '⌃G'}</Text>
        <ExitButton onClick={onClose} />
      </Box>

      <Box flexDirection="column" maxHeight={Math.max(10, rows - 10)} marginTop={1}>
        <ScrollBox ref={scrollRef} flexDirection="column" flexGrow={1}>
          <Divider color="subtle" title={`${t('task-center-section-tasks')} (${jobs.length})`} />
          {jobs.length === 0 ? (
            <Text dimColor>{`  ${t('task-center-empty-tasks')}`}</Text>
          ) : (
            jobs.map((job, index) => (
              <TaskRow key={`job-${job.id}`} entry={{ section: 'tasks', job }} focused={index === focus} columns={columns} />
            ))
          )}
          <Divider color="subtle" title={`${t('task-center-section-subagents')} (${subagents.length})`} />
          {subagents.length === 0 ? (
            <Text dimColor>{`  ${t('task-center-empty-subagents')}`}</Text>
          ) : (
            subagents.map((sub, index) => (
              <TaskRow
                key={`sub-${sub.agentId}`}
                entry={{ section: 'subagents', subagent: sub }}
                focused={jobs.length + index === focus}
                columns={columns}
                onOpen={onOpenSubagent !== undefined ? () => onOpenSubagent(sub.agentId) : undefined}
              />
            ))
          )}
        </ScrollBox>
      </Box>

      <Divider color="subtle" title="" />
      <Box marginTop={0}>
        <Text dimColor>{t('task-center-hint')}</Text>
        {followUpReady && <Text dimColor>{` · ${t('subagent-followup-key-hint')}`}</Text>}
        {interruptReady && <Text dimColor>{` · ${t('subagent-interrupt-key-hint')}`}</Text>}
        {deleteReady && <Text dimColor>{` · ${t('subagent-delete-key-hint')}`}</Text>}
      </Box>
      {followUp.composing && (
        <FollowUpLine state={followUp} placeholder={t('subagent-followup-prompt')} />
      )}
    </Box>
  )
}
