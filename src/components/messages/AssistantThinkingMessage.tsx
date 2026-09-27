import React from 'react'
import { Box, Text } from '../../ui.js'
import { t } from '../../i18n.js'
import { StreamingMarkdown } from '../StreamingMarkdown.js'
import { formatDuration } from '../../terminal-utils/format.js'
import { THINKING_SETTLED_MARKER } from '../../terminal-utils/figures.js'
import { useBlink } from '../../hooks/useBlink.js'
import { isMinimalMode } from '../../minimalMode.js'
import type { ClickEvent } from '../../ink/events/click-event.js'

/** Preview body rows — a FIXED row count (kimicode-style constant-height
 *  ticker). Ink's truncate slices the whole string across newlines as one
 *  logical line, so a single joined Text collapses to 1-2 rows whenever
 *  the combined width passes the terminal width, then bounces back as
 *  lines shift. One Text per row, each truncated to the width and padded
 *  to exactly this many rows, keeps the block height stream-independent. */
const PREVIEW_ROWS = 3

type Props = {
  thinking: string
  /** The FULL un-revealed text (reasoning rows under smooth streaming):
   *  `thinking` carries the revealed slice the expanded body paints, while
   *  the live preview ticker must follow the newest ARRIVED content — never
   *  a lagging reveal. Falls back to `thinking`. */
  textFull?: string
  /** Adds the top margin between messages. */
  marginTopOnTurn: boolean
  /** Show the full text (Ctrl+O, per-row expansion, or live click toggle). */
  verbose: boolean
  /** True while the reasoning block is still streaming — the leading anchor
   *  becomes a blinking diamond (grok-style running bullet) and settles back
   *  to the static anchor once the step ends. */
  streaming?: boolean
  /** Streaming compact mode (thinkingFold=preview): a 3-row live ticker of
   *  the model's latest reasoning lines instead of the full block —
   *  kimicode-style constant height; the block never resizes mid-stream. */
  preview?: boolean
  /** Thinking wall-clock duration once the reasoning block settled (ms). */
  durationMs?: number
  /** Message-selection mode highlight. */
  isSelected?: boolean
  onClick?(event: ClickEvent): void
}

/**
 * Thinking block: settled rows fold to the grok-style single line
 * (`◆` + thought-label + thinking-duration + hint-expand-ctrl-o);
 * streaming rows show a blinking diamond plus the bold
 * thinking-running-label, switching between a three-line preview and the
 * full reasoning text on click.
 */
export function AssistantThinkingMessage({
  thinking,
  textFull,
  marginTopOnTurn,
  verbose,
  streaming = false,
  preview = false,
  durationMs,
  isSelected = false,
  onClick,
}: Props): React.ReactNode {
  if (!thinking) return null

  // The preview ticker tracks the newest ARRIVED line (smooth streaming must
  // not lag it behind the reveal); the expanded body below paints `thinking`
  // — the revealed slice under smooth streaming, the full text otherwise.
  const tickerText = textFull ?? thinking

  // Running bullet: a blinking diamond while the reasoning streams — the
  // same useBlink cadence as tool rows keeps one glyph language across
  // steps (grok-style running bullet).
  const [bulletRef, bulletBlinking] = useBlink(streaming)

  const duration =
    durationMs !== undefined && durationMs >= 1000
      ? t('thinking-duration', { duration: formatDuration(durationMs) })
      : ''

  // grok-style header: bold verb ("Thinking…" while running), muted
  // "for Xs" suffix once settled, one line.
  const label = `${t('thinking-running-label')}…`
  const minimal = isMinimalMode()
  // Hover 轻指示：可点击折叠时折叠头从 dim 提亮为正常色（不刷整行背景，
  // 转录视觉保持安静）。
  const [hovered, setHovered] = React.useState(false)
  const hoverProps = onClick !== undefined
    ? { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) }
    : {}
  const header =
    streaming ? (
      <Box flexDirection="row" ref={bulletRef}>
        <Text
          color={minimal || !bulletBlinking ? undefined : 'success'}
          bold={bulletBlinking}
        >{`${THINKING_SETTLED_MARKER} `}</Text>
        {/* 流式行同样可点击折叠；running 标签保持正常亮度，与工具行一致 */}
        <Text bold>{label}</Text>
      </Box>
    ) : (
      <Text dimColor={!hovered} color={hovered ? 'text' : undefined} italic>
        {`${minimal ? '*' : THINKING_SETTLED_MARKER} `}
        <Text bold>{t('thought-label')}</Text>
        <Text>{duration}{streaming ? '…' : ` ${t('hint-expand-ctrl-o')}`}</Text>
      </Text>
    )

  if (preview) {
    // Live ticker: the model's last few reasoning lines, dimmed, one Text
    // per row so each truncates to the width independently, padded to a
    // constant PREVIEW_ROWS-tall block that follows the stream. The folded
    // summary takes over when the step settles. The LAST row truncates
    // from the start (leading ellipsis) so the newest tokens — which grow
    // at the line's end — stay visible while the line is longer than the
    // width.
    const lines = tickerText.split('\n')
    const visible = lines.slice(-PREVIEW_ROWS)
    const clipped = lines.length > visible.length
    // Pad with single spaces — an empty-string Text renders with zero
    // height in ink, so '' padding would not hold the row open.
    const rows = Array.from(
      { length: PREVIEW_ROWS },
      (_, i) => visible[i] ?? ' ',
    )
    return (
      <Box
        flexDirection="column"
        marginTop={marginTopOnTurn ? 1 : 0}
        backgroundColor={isSelected ? 'messageActionsBackground' : undefined}
        onClick={onClick}
        {...hoverProps}
      >
        {header}
        <Box
          flexDirection="column"
          paddingLeft={2}
          height={PREVIEW_ROWS}
          flexShrink={0}
          overflow="hidden"
        >
          {rows.map((line, i) => (
            <Box key={i} flexDirection="row" height={1}>
              {/* The bar is a fixed-width column OUTSIDE the truncating text:
                * ink's truncate-start rewrites the text's leading columns, so
                * a bar inside the text would be eaten by the ellipsis. */}
              <Text dimColor italic>{'│ '}</Text>
              <Box flexDirection="row" flexGrow={1}>
                <Text
                  dimColor
                  italic
                  wrap={i === rows.length - 1 ? 'truncate-start' : 'truncate'}
                >
                  {i === 0 && clipped ? `…${line}` : line}
                </Text>
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    )
  }

  if (!verbose) {
    return (
      <Box
        marginTop={marginTopOnTurn ? 1 : 0}
        backgroundColor={isSelected ? 'messageActionsBackground' : undefined}
        onClick={onClick}
        {...hoverProps}
      >
        {header}
      </Box>
    )
  }

  return (
    <Box
      flexDirection="column"
      gap={1}
      marginTop={marginTopOnTurn ? 1 : 0}
      width="100%"
      backgroundColor={isSelected ? 'messageActionsBackground' : undefined}
      onClick={onClick}
      {...hoverProps}
    >
      {header}
      <Box paddingLeft={2}>
        {/* StreamingMarkdown: the live thinking text grows per token — the
          incremental stable-prefix + tail budget keeps the per-frame layout
          cost at O(new content) instead of re-laying out the whole block. */}
        <StreamingMarkdown dimColor>{thinking}</StreamingMarkdown>
      </Box>
    </Box>
  )
}
