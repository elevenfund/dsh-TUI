import React from 'react'
import { Box, Text, useTerminalSize } from '../../ui.js'
import { NoSelect } from '../../ink/components/NoSelect.js'
import { LoadingState } from '../../components/design-system/LoadingState.js'
import { Pane } from '../../components/design-system/Pane.js'
import { t } from '../../i18n.js'
import { POINTER } from '../../terminal-utils/figures.js'
import { cleanRenderText } from '../../dsh-adapter/sanitize.js'

/**
 * The pinned prompt header shown above the ScrollBox while the user has
 * scrolled up. It pins the user message the transcript viewport is currently
 * showing — the topmost visible user message, or the nearest one above when
 * only assistant content fills the view — so it tracks which turn the user
 * is reading instead of always carrying the latest prompt. Fixed at 1 row so
 * the ScrollBox never shifts when the text changes.
 */
export function PinnedTurnHeader({
  text,
  onClick,
}: {
  text: string
  onClick: () => void
}): React.ReactNode {
  const { columns } = useTerminalSize()
  // A one-row Box does not clip its children. Flatten hard line breaks before
  // truncating, otherwise later prompt lines paint down the transcript gutter.
  const label = cleanRenderText(`${POINTER} ${text}`, Math.max(1, columns - 1))
  return (
    <Box
      flexShrink={0}
      width="100%"
      height={1}
      overflow="hidden"
      paddingRight={1}
      onClick={onClick}
    >
      <Text color="userPromptLabel" bold wrap="truncate-end">
        {label}
      </Text>
    </Box>
  )
}

/** The `↓ N new messages` pill shown while scrolled up with new content. */
export function NewMessagesPill({
  count,
  onClick,
}: {
  count: number
  onClick: () => void
}): React.ReactNode {
  const [hover, setHover] = React.useState(false)
  return (
    // noSelect: the pill is chrome (a button), not transcript. Without this,
    // its text row is ordinary selectable cells — a selection anchored at
    // the screen bottom (or extended across it) captures
    // "↓ 回到底部（Enter/End）" into the copy on release. noSelect keeps the
    // click/hover wiring (dispatchClick ignores noSelect) and only removes
    // the cells from the highlight and getSelectedText.
    <NoSelect paddingX={2} paddingTop={1}>
      <Box
        backgroundColor={hover ? 'userMessageBackgroundHover' : 'background'}
        onClick={onClick}
        onMouseEnter={() =>{  setHover(true) }}
        onMouseLeave={() =>{  setHover(false) }}
      >
        <Text color="inverseText" bold>
          {' '}
          {count > 0
            ? t(count === 1 ? 'new-message' : 'new-messages', { n: count })
            : t('back-to-bottom')}
          {' '}
        </Text>
      </Box>
    </NoSelect>
  )
}

/** /model while the provider catalog is still loading. */
export function ModelPickerLoading(): React.ReactNode {
  return (
    <Pane color="permission">
      <Box flexDirection="column" gap={1}>
        <Text bold color="permission">
          {t('picker-title-model')}
        </Text>
        <LoadingState
          message={t('model-loading')}
          bold
          subtitle={t('model-loading-subtitle')}
        />
      </Box>
    </Pane>
  )
}

/**
 * The `/` incsearch bar: a
 * single row above the prompt input with the query, a block cursor, and the
 * match counter (`current/count`) or a red `no matches` when nothing hits.
 */
export function TranscriptSearch({
  query,
  cursorOffset,
  count,
  current,
}: {
  query: string
  cursorOffset: number
  count: number
  current: number
}): React.ReactNode {
  const cursorChar = cursorOffset < query.length ? query[cursorOffset] : ' '
  return (
    // noSelect: the bar's own text must not match the search query (the
    // screen-space highlight would self-match).
    <NoSelect
      borderTopDimColor
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderStyle="single"
      marginTop={1}
      paddingLeft={2}
      width="100%"
    >
      <Text>/</Text>
      <Text>{query.slice(0, cursorOffset)}</Text>
      <Text inverse>{cursorChar}</Text>
      {cursorOffset < query.length && <Text>{query.slice(cursorOffset + 1)}</Text>}
      <Box flexGrow={1} />
      {query && count === 0 ? (
        <Text color="error">{t('search-no-matches')} </Text>
      ) : count > 0 ? (
        <Text dimColor>
          {Math.min(current + 1, count)}/{count}{'  '}
        </Text>
      ) : null}
    </NoSelect>
  )
}
