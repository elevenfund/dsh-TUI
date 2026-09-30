import React from 'react'
import { Box, Text, useTerminalSize } from '../../ui.js'
import { useAnimationFrame } from '../../ink/hooks/use-animation-frame.js'
import { stringWidth } from '../../ink/stringWidth.js'
import type { ClickEvent } from '../../ink/events/click-event.js'
import type { DOMElement } from '../../ink/dom.js'
import { formatDuration } from '../../terminal-utils/format.js'
import { ToolUseLoader } from '../ToolUseLoader.js'
import type { ToolGroupModel } from './tool-blocks.js'

type Props = {
  group: ToolGroupModel
  /** Adds the top margin between messages. */
  marginTopOnTurn: boolean
  /** Message-selection mode highlight. */
  isSelected?: boolean
  /** Click toggles the group between the folded label and member rows. */
  onClick?(event: ClickEvent): void
  ref?: React.Ref<DOMElement>
}

function clipToWidth(text: string, width: number): string {
  if (width <= 1) return '…'
  if (stringWidth(text) <= width) return text
  let used = 0
  let out = ''
  for (const ch of text) {
    const w = stringWidth(ch)
    if (used + w > width - 1) break
    out += ch
    used += w
  }
  return `${out}…`
}

/**
 * The verb-group fold row (grok "Read 4 files"): one line standing in for a
 * run of consecutive groupable tool calls. The label aggregates per-verb
 * counts in the right tense; a bound narration becomes the row's intent
 * title with the count label as its dim suffix. A running member pulses the
 * diamond and drives a live timer; clicking unfolds the run member-by-member.
 */
export function ToolGroupRow({ group, marginTopOnTurn, isSelected = false, onClick, ref }: Props): React.ReactNode {
  // 250ms repaint while running keeps the live timer fresh; the loader's own
  // blink also pulses, this just fixes the cadence.
  useAnimationFrame(group.running ? 250 : null)
  const { columns } = useTerminalSize()
  const firstStartedAt = group.members[0]?.row.tool?.startedAt
  const error = group.members.some(member => member.status === 'error')
  const elapsed = group.running && firstStartedAt !== undefined
    ? formatDuration(Math.max(0, Date.now() - firstStartedAt))
    : undefined
  // Budget: diamond(2) + gaps + timer + selection marker leave this much for
  // the title line at common widths; the clip keeps CJK-safe truncation.
  const titleBudget = Math.max(8, columns - (elapsed !== undefined ? 14 : 4))
  // The narration title carries no marker glyph: it must read exactly like
  // any other fold row's title (user feedback — the ⏵ prefix broke visual
  // parity between narration-titled and plain folds).
  const title = group.narration ?? group.label
  const suffix = group.narration !== undefined ? group.label : undefined
  return (
    <Box
      ref={ref}
      flexDirection="row"
      flexWrap="nowrap"
      justifyContent="space-between"
      marginTop={marginTopOnTurn ? 1 : 0}
      width="100%"
      backgroundColor={isSelected ? 'messageActionsBackground' : undefined}
      onClick={onClick}
    >
      <Box flexDirection="row" flexWrap="nowrap" minWidth={1}>
        <ToolUseLoader shouldAnimate={group.running} isUnresolved={group.running} isError={error} toolName={group.members[0]?.row.tool?.name} />
        <Text>
          <Text bold color={error ? 'error' : undefined}>{clipToWidth(title, titleBudget)}</Text>
          {suffix !== undefined && <Text dimColor>{` · ${suffix}`}</Text>}
        </Text>
      </Box>
      {elapsed !== undefined && (
        <Box flexShrink={0}>
          <Text dimColor>{elapsed}</Text>
        </Box>
      )}
    </Box>
  )
}
