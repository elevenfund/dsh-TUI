import React from 'react'
import { Box, NoSelect, Text } from '../../ui.js'
import { BLACK_CIRCLE } from '../../terminal-utils/figures.js'
import { extractNarration } from '../../utils/narration.js'
import { Markdown } from '../Markdown.js'

type Props = {
  text: string
  /** Adds the top margin between messages. */
  marginTopOnTurn: boolean
  /** Message-selection mode highlight. */
  isSelected?: boolean
  /** Row expanded on its own (persistent hover-grey background). */
  isExpanded?: boolean
}

/**
 * Assistant text message: bullet + markdown body. A leading `⏵` narration
 * line (working-activity narrate contract) renders as the turn's dim step
 * title above the body — grok-style turn headline, matching what the
 * subagent transcript scene has always shown.
 *
 * Deliberately not clickable: the transcript is reading material and the
 * mouse's job there is text selection (user feedback — row hover tints and
 * fold toggling were noise, not affordance).
 */
export function AssistantTextMessage({
  text,
  marginTopOnTurn,
  isSelected = false,
  isExpanded = false,
}: Props): React.ReactNode {
  const { narration, body } = extractNarration(text)
  return (
    <Box
      alignItems="flex-start"
      flexDirection="row"
      justifyContent="space-between"
      marginTop={marginTopOnTurn ? 1 : 0}
      width="100%"
      backgroundColor={isExpanded ? 'userMessageBackgroundHover' : undefined}
    >
      <Box flexDirection="row">
        <NoSelect fromLeftEdge minWidth={2}>
          {/* Selection cursor lights the bullet only — the row body stays
              untinted (full-row highlight on plain text reads as an
              accident, not a cursor affordance). */}
          <Text color={isSelected ? 'suggestion' : 'text'}>{BLACK_CIRCLE}</Text>
        </NoSelect>
        <Box flexDirection="column">
          {narration !== undefined && <Text dimColor>{`⏵ ${narration}`}</Text>}
          {body !== '' && <Markdown>{body}</Markdown>}
        </Box>
      </Box>
    </Box>
  )
}
