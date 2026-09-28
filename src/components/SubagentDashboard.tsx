import React from 'react'
import { Box, Text, useInput, ScrollBox, type ScrollBoxHandle, useTerminalSize } from '../ui.js'
import { SubagentCard } from './SubagentCard.js'
import type { SubagentState } from '../dsh-adapter/subagents.js'
import type { Theme } from '../theme.js'
import { t } from '../i18n.js'
import { Divider } from './design-system/Divider.js'
import { isPlainReturnInput } from '../utils/modifiers.js'
import { FollowUpLine, useFollowUpInput } from './SubagentFollowUpInput.js'

export interface SubagentDashboardProps {
  subagents: SubagentState[]
  onClose: () => void
  onSelect?: (agentId: string) => void
  /** Continuable child ids (host catalog mode): only these rows offer the
   * follow-up composer — one-shot children dispose at settlement. */
  continuableIds?: ReadonlySet<string>
  /** Deliver a follow-up (send_message seam). Absent hides the control. */
  onFollowUp?: (agentId: string, text: string) => Promise<boolean> | boolean
}

/** 可点击 ✕ 退出按钮：整屏/浮层场景的鼠标退出通道（Esc 等价）。 */
export function ExitButton({ onClick }: { onClick: () => void }): React.ReactNode {
  const [hovered, setHovered] = React.useState(false)
  return (
    <Box
      onClick={onClick}
      onMouseEnter={(): void => setHovered(true)}
      onMouseLeave={(): void => setHovered(false)}
    >
      <Text color={hovered ? 'text' : 'subtle'}>{' ✕'}</Text>
    </Box>
  )
}

/**
 * SubagentDashboard — overlay panel showing all active/recent subagents.
 * Keyboard: up/down to navigate, Enter to view detail, Esc to close.
 */
export function SubagentDashboard({
  subagents,
  onClose,
  onSelect,
  continuableIds,
  onFollowUp,
}: SubagentDashboardProps): React.ReactNode {
  const [focusIndex, setFocusIndex] = React.useState(0)
  const scrollRef = React.useRef<ScrollBoxHandle | null>(null)
  const { rows, columns } = useTerminalSize()
  // The follow-up target is pinned when composing begins: focusIndex may
  // move (or the list reorder) while the draft is being typed.
  const followUpTargetRef = React.useRef<string | null>(null)
  const followUp = useFollowUpInput(async text => {
    const target = followUpTargetRef.current
    if (target !== null) await onFollowUp?.(target, text)
  })

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
    
    if (key.upArrow || (!key.ctrl && !key.meta && input === 'k')) {
      event.stopImmediatePropagation()
      setFocusIndex(i => Math.max(0, i - 1))
      scrollRef.current?.scrollBy(-3)
      return
    }

    if (key.downArrow || (!key.ctrl && !key.meta && input === 'j')) {
      event.stopImmediatePropagation()
      setFocusIndex(i => Math.min(subagents.length - 1, i + 1))
      scrollRef.current?.scrollBy(3)
      return
    }
    
    if (isPlainReturnInput(input, key) && onSelect) {
      event.stopImmediatePropagation()
      const selected = subagents[focusIndex]
      if (selected) onSelect(selected.agentId)
      return
    }

    // m opens the follow-up composer on the focused continuable row (send_
    // message seam): steering a live child, cold-resuming an idle one.
    {
      const selected = subagents[focusIndex]
      if (input === 'm' && onFollowUp !== undefined && selected !== undefined && continuableIds?.has(selected.agentId) === true) {
        event.stopImmediatePropagation()
        followUpTargetRef.current = selected.agentId
        followUp.begin()
        return
      }
    }

    // Consume all input while dashboard is open
    event.stopImmediatePropagation()
  })

  const running = subagents.filter(s => s.status === 'running').length
  const completed = subagents.filter(s => s.status === 'completed').length
  const failed = subagents.filter(s => s.status === 'failed').length

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Divider
        color="accent"
        title={t('subagent-dashboard-title')}
      />

      <Box flexDirection="row" gap={3} marginTop={1} marginBottom={1}>
        <Text>
          <Text color="accent">{running}</Text>
          <Text dimColor> {t('subagent-count-running')}</Text>
        </Text>
        <Text>
          <Text color="success">{completed}</Text>
          <Text dimColor> {t('subagent-count-completed')}</Text>
        </Text>
        {failed > 0 && (
          <Text>
            <Text color="error">{failed}</Text>
            <Text dimColor> {t('subagent-count-failed')}</Text>
          </Text>
        )}
        <Box flexGrow={1} />
        {/* 可点击退出（Esc 的鼠标等价），hover 提亮 */}
        <ExitButton onClick={onClose} />
      </Box>

      <Box flexDirection="column" maxHeight={Math.max(10, rows - 10)} marginTop={1}>
        <ScrollBox ref={scrollRef} flexDirection="column" flexGrow={1}>
          {subagents.length === 0 ? (
            <Box flexDirection="column" alignItems="center" marginTop={Math.max(2, Math.floor((rows - 16) / 3))}>
              <Text dimColor>{'○'}</Text>
              <Text dimColor>{t('subagent-none')}</Text>
              <Box marginTop={1}><Text dimColor>{t('subagent-empty-hint')}</Text></Box>
            </Box>
          ) : (
            subagents.map((subagent, index) => (
              <Box key={subagent.agentId} flexDirection="column">
                <SubagentCard
                  subagent={subagent}
                  focused={index === focusIndex}
                  onClick={onSelect !== undefined
                    // Click = view detail, same as Enter on the focused card.
                    ? () => onSelect(subagent.agentId)
                    : undefined}
                />
                {index < subagents.length - 1 && (
                  <Text dimColor>{'─'.repeat(Math.max(20, Math.min(72, columns - 6)))}</Text>
                )}
              </Box>
            ))
          )}
        </ScrollBox>
      </Box>

      <Divider color="subtle" title="" />
      <Box marginTop={0}>
        <Text dimColor>
          {onSelect
            ? t('subagent-dashboard-hint-detail')
            : t('subagent-dashboard-hint-basic')}
        </Text>
        {(() => {
          const focused = subagents[focusIndex]
          return onFollowUp !== undefined && focused !== undefined && continuableIds?.has(focused.agentId) === true
            ? <Text dimColor>{` · ${t('subagent-followup-key-hint')}`}</Text>
            : null
        })()}
      </Box>
      {followUp.composing && (
        <FollowUpLine state={followUp} placeholder={t('subagent-followup-prompt')} />
      )}
    </Box>
  )
}
