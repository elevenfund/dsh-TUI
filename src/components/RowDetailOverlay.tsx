import React from 'react'
import { Box, ScrollBox, Text, useTerminalSize, type ScrollBoxHandle } from '../ui.js'
import type { ChatRow } from '../adapter/ports/channel-view.js'
import { truncateToWidth } from '../ink/truncateToWidth.js'
import { t } from '../i18n.js'

/**
 * First-string argument summary for the card title: most tools put their
 * primary operand (command / path / pattern / query) in the first JSON
 * field, so that value reads far better than raw argsText. Falls back to
 * the raw text for non-JSON or empty args.
 */
function summarizeArgs(argsText: string): string {
  try {
    const parsed: unknown = JSON.parse(argsText)
    if (parsed !== null && typeof parsed === 'object') {
      const first = Object.values(parsed as Record<string, unknown>)[0]
      if (typeof first === 'string' && first.length > 0) return first
    }
  } catch {
    // raw args: show as-is
  }
  return argsText
}

const secondsOf = (ms: number): string => `${(Math.round(ms / 100) / 10).toFixed(1)}s`

/**
 * One Text per source line. Ink's Text does not break on `\n` — folding a
 * multi-line payload into a single node swallows the newlines and renders
 * one run-on line that only soft-wraps by width (seq's 60 lines showed as
 * "1 2 3 … 60"). Long lines still soft-wrap through Text's default wrap.
 */
function multiline(text: string, keyPrefix: string, color?: 'error'): React.ReactNode[] {
  return text.split('\n').map((line, index) => (
    <Text key={`${keyPrefix}${index}`} color={color}>{line}</Text>
  ))
}

/**
 * The selection-mode Enter viewer (grok's "Enter details"): the selected
 * row's COMPLETE content in a centered card over a dim click-catcher — the
 * transcript viewport can never hold a 500-line tool output, so full
 * reading lives here instead of in the scroll. The card is keyboard-first:
 * Chat's key chain routes j/k/↑/↓/pgup/pgdn/g/G to the card's ScrollBox
 * and Esc/Enter back into selection mode (cursor stays on the row that
 * opened the card). A click on the catcher closes; a click inside the card
 * is swallowed. Only paints themed text cells — the content is plain rows,
 * the ScrollBox viewport-culls like the transcript itself, so a huge
 * output costs no more than the visible window.
 */
export function RowDetailOverlay({
  row,
  scrollRef,
  onClose,
  maxRows,
}: {
  readonly row: ChatRow
  /** Receives the card body's ScrollBox handle (Chat routes scroll keys). */
  readonly scrollRef?: React.Ref<ScrollBoxHandle>
  readonly onClose: () => void
  /** Height budget of the mount region (the transcript viewport). The
   *  card mounts inside it, so sizing from full-screen rows overestimates
   *  whenever the input cluster grew (queue/btw/background rows) and the
   *  card's head gets clipped against the region's top edge. */
  readonly maxRows?: number
}): React.ReactNode {
  const { columns, rows } = useTerminalSize()
  // The card mounts INSIDE the transcript row, so its height budget must
  // respect that region, not the screen: the caller passes the live
  // viewport height; the rows fallback covers the first frame (and hosts
  // without a handle). Bottom margin 2 + the region budget itself.
  const regionRows = maxRows !== undefined && maxRows > 0 ? maxRows : rows - 8
  const cardColumns = Math.max(40, Math.min(columns - 4, Math.floor(columns * 0.95)))
  const cardRows = Math.max(6, Math.min(regionRows - 2, rows - 10))
  const left = Math.max(0, Math.floor((columns - cardColumns) / 2))
  const bottom = 2

  const tool = row.kind === 'tool' ? row.tool : undefined
  const isError = tool?.status === 'error'
  const title = tool
    ? `${tool.name}(${truncateToWidth(summarizeArgs(tool.argsText), 48)}) · ${isError ? 'error' : secondsOf(tool.durationMs ?? 0)}`
    : row.kind === 'reasoning'
      ? `${t('row-detail-thinking')} · ${secondsOf(row.durationMs ?? 0)}`
      : row.kind === 'assistant'
        ? t('row-detail-assistant')
        : t('row-detail-user')

  return (
    <>
      {/* Catcher first (sibling, painted under the card): dims the
          transcript and closes on outside click. */}
      <Box
        position="absolute"
        bottom={0}
        left={0}
        width="100%"
        height={rows}
        flexShrink={0}
        overflow="hidden"
        backdrop="dim"
        onClick={onClose}
      />
      <Box
        position="absolute"
        bottom={bottom}
        left={left}
        width={cardColumns}
        height={cardRows}
        flexDirection="column"
        flexShrink={0}
        overflow="hidden"
        backgroundColor="toolCardBackground"
        opaque
        borderStyle="round"
        onClick={event => event.stopImmediatePropagation()}
      >
        <Box height={1} flexShrink={0} paddingLeft={1} paddingRight={1}>
          <Text bold color={isError ? 'error' : 'text'} wrap="truncate-end">{title}</Text>
        </Box>
        <ScrollBox ref={scrollRef} flexDirection="column" flexGrow={1} flexShrink={1}>
          <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
            {tool ? (
              <>
                {tool.argsText.split('\n').map((line, index) => (
                  <Text key={`a${index}`} wrap="wrap">{index === 0 ? `$ ${line}` : line}</Text>
                ))}
                {tool.errorText !== undefined && tool.errorText.length > 0
                  ? multiline(tool.errorText, 'e', 'error')
                  : null}
                {tool.resultText !== undefined && tool.resultText.length > 0
                  ? multiline(tool.resultText, 'r')
                  : null}
              </>
            ) : (
              multiline(row.text, 't')
            )}
          </Box>
        </ScrollBox>
        <Box height={1} flexShrink={0} paddingLeft={1} paddingRight={1}>
          <Text dimColor>{t('row-detail-hint')}</Text>
        </Box>
      </Box>
    </>
  )
}
