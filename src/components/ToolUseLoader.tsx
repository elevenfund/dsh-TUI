import React from 'react'
import Box from '../ink/components/Box.js'
import { Text } from '../ui.js'
import { useBlink } from '../hooks/useBlink.js'
import { DIAMOND } from '../terminal-utils/figures.js'

type Props = {
  isError: boolean
  isUnresolved: boolean
  shouldAnimate: boolean
  /** Raw tool id (bash/read/edit/…) — unused for coloring: the diamond is
   *  status-tinted (grok-style) instead of category-tinted. Kept in the
   *  signature so call sites stay stable. */
  toolName?: string
}

/**
 * The status diamond on tool-call rows (grok-style): a pulsing diamond while
 * the call runs, green once settled, red on error — one glyph, one signal,
 * readable at a glance.
 */
export function ToolUseLoader({
  isError,
  shouldAnimate,
}: Props): React.ReactNode {
  const [ref, isBlinking] = useBlink(shouldAnimate)

  if (isError) {
    return (
      <Box ref={ref} minWidth={2}>
        <Text color="error">{DIAMOND}</Text>
      </Box>
    )
  }

  if (shouldAnimate) {
    return (
      <Box ref={ref} minWidth={2}>
        <Text color={isBlinking ? 'success' : undefined} bold={isBlinking}>{DIAMOND}</Text>
      </Box>
    )
  }

  return (
    <Box minWidth={2}>
      <Text color="success">{DIAMOND}</Text>
    </Box>
  )
}
