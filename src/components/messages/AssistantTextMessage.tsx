import React from 'react'
import { Box, NoSelect, Text } from '../../ui.js'
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
          {/* Grok keeps plain assistant text chrome-free (no bullet — bullets
              belong to structured blocks). The selection cursor is the only
              affordance: a prompt-like ❯ echoing the user-row marker. */}
          {isSelected ? <Text color="suggestion">❯</Text> : <Text> </Text>}
        </NoSelect>
        <Box flexDirection="column">
          {narration !== undefined && <Text dimColor>{`⏵ ${narration}`}</Text>}
          {body !== '' && <Markdown>{body}</Markdown>}
        </Box>
      </Box>
    </Box>
  )
}
