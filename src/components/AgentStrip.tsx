import React from 'react'
import { Box, Text, useAnimationFrame } from '../ui.js'
import { formatJobDuration, type BackgroundJobState } from '../dsh-adapter/jobs.js'
import { formatDuration } from '../terminal-utils/format.js'
import type { SubagentState } from '../dsh-adapter/subagents.js'
import { t } from '../i18n.js'
import { clipLineToWidth } from '../ink/truncateToWidth.js'

export interface AgentStripProps {
  jobs: readonly BackgroundJobState[]
  subagents: readonly SubagentState[]
  /** Open the task center (Ctrl+G panel) — the strip's keyboard door. */
  onOpenCenter: () => void
  /** Open one running subagent's transcript scene (mouse door). */
  onOpenSubagent?: (agentId: string) => void
}

/** Max rows before the strip collapses into "first N + count". */
const MAX_ROWS = 3

/** Hard single-line clip by display width (shared rule with JobsPanel). */

function subagentTokens(sub: SubagentState): number {
  const tokens = sub.tokens
  if (tokens === undefined) return 0
  return tokens.total ?? ((tokens.input ?? 0) + (tokens.output ?? 0))
}

/**
 * Agent strip — the always-on bottom readout while anything runs: one line
 * per live background task / subagent (status glyph, label, elapsed, token
 * draw), Claude-Code-style. Clicking a subagent line opens its transcript
 * scene; the trailing `⌃G` hint is the keyboard door to the task center.
 * Renders nothing when the session is idle.
 */
export function AgentStrip({ jobs, subagents, onOpenCenter, onOpenSubagent }: AgentStripProps): React.ReactNode {
  const liveJobs = jobs.filter(job => job.status === 'running' || job.status === 'stopping')
  const liveSubagents = subagents.filter(sub => sub.status === 'running' || sub.status === 'starting')
  const total = liveJobs.length + liveSubagents.length
  // 1s tick keeps elapsed counters alive; parks at null once nothing is
  // live — the strip itself stays mounted (return null below), so an
  // always-on clock would keep the settled session rendering a frame every
  // second forever (the idle-frame leak verify-subagent-settle pins).
  const [clockRef] = useAnimationFrame(total > 0 ? 1000 : null)
  if (total === 0) return null
  const lines: Array<{ key: string; node: React.ReactNode; onClick?: () => void }> = []
  const pushJob = (job: BackgroundJobState): void => {
    lines.push({
      key: `job-${job.id}`,
      node: (
        <>
          <Text color="ansi:yellowBright">●</Text>
          <Text bold dimColor>{job.id}</Text>
          <Text dimColor>{clipLineToWidth(job.label, 60)}</Text>
          <Box flexGrow={1} />
          <Text dimColor>{formatJobDuration(job)}</Text>
        </>
      ),
    })
  }
  const pushSubagent = (sub: SubagentState): void => {
    const duration = formatDuration(Math.max(0, Date.now() - sub.startedAt))
    const live = sub.output[sub.output.length - 1]
    lines.push({
      key: `sub-${sub.agentId}`,
      onClick: onOpenSubagent !== undefined ? () => onOpenSubagent(sub.agentId) : undefined,
      node: (
        <>
          <Text color="ansi:yellowBright">◐</Text>
          <Text bold>{clipLineToWidth(sub.description, 28)}</Text>
          {live !== undefined && <Text dimColor>{clipLineToWidth(live, 48)}</Text>}
          <Box flexGrow={1} />
          <Text dimColor>{`${duration} · ↓${subagentTokens(sub)}`}</Text>
        </>
      ),
    })
  }
  for (const job of liveJobs.slice(0, MAX_ROWS)) pushJob(job)
  for (const sub of liveSubagents.slice(0, MAX_ROWS - Math.min(liveJobs.length, MAX_ROWS))) pushSubagent(sub)
  const hidden = total - lines.length

  return (
    <Box flexDirection="column" ref={clockRef}>
      {lines.map(line => (
        <Box key={line.key} flexDirection="row" gap={1} onClick={line.onClick}>
          {line.node}
        </Box>
      ))}
      <Box flexDirection="row" gap={1} onClick={onOpenCenter}>
        {hidden > 0 && <Text dimColor>{t('task-center-strip-more', { n: hidden })}</Text>}
        <Box flexGrow={1} />
        <Text dimColor>{`⌃G ${t('task-center-strip-hint')}`}</Text>
      </Box>
    </Box>
  )
}
