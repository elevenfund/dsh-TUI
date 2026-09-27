import React from 'react'
import { t } from '../i18n.js'
import { Box, Text } from '../ui.js'
import { DIAMOND } from '../terminal-utils/figures.js'
import { useBlink } from '../hooks/useBlink.js'
import type { ActivityView } from '../dsh-adapter/activity-store.js'

/**
 * Context-pressure percentage (0–100) from the last usage snapshot, or
 * undefined when unknown — shared by the spinner-line and status-line
 * placements of the working-activity line (pi working-activity style:
 * amber ≥ 80%, red ≥ 95%).
 */
export function contextPressurePct(
  usage: { input: number; cacheRead: number; cacheWrite: number } | undefined,
  contextWindow: number | undefined,
): number | undefined {
  if (usage === undefined || contextWindow === undefined || contextWindow <= 0) {
    return undefined
  }
  const occupied = usage.input + usage.cacheRead + usage.cacheWrite
  return Math.round((occupied / contextWindow) * 100)
}

/**
 * The working-activity line, rendered either in the spinner slot (while a
 * turn runs) or on the status bar (the turn-summary card once idle):
 * a blinking diamond leading the live copy — the same glyph language as
 * tool and thinking rows (grok-style running bullet) — an amber/red
 * `⚠ ctx N%` pressure prefix, and an optional trailing suffix. Done
 * summaries render statically in the brand mist blue.
 */
/** The fields the line renders, from the working-activity plugin's projection. */
export interface ActivityLineValue {
  readonly phase: ActivityView['phase']
  readonly line: string
}

export function ActivityLine({
  activity,
  warnPct,
  warnDanger,
  suffix,
}: {
  activity: ActivityLineValue
  /** Deprecated: frame presets no longer render — the line leads with the
   *  shared grok-style blinking diamond. Kept for call-site compatibility. */
  activityFrames?: string
  warnPct?: number
  warnDanger?: boolean
  suffix?: string
}): React.ReactNode {
  const [bulletRef, bulletBlinking] = useBlink(activity.phase !== 'done')
  const color =
    activity.phase === 'done' || activity.phase === 'tool'
      ? 'accent'
      : 'activity'

  return (
    <Box flexDirection="row" ref={bulletRef}>
      <Text wrap="truncate">
        {activity.phase !== 'done' && (
          <Text
            color={bulletBlinking ? 'success' : undefined}
            bold={bulletBlinking}
          >{`${DIAMOND} `}</Text>
        )}
        {warnPct !== undefined && warnPct >= 80 && (
          <Text color={warnDanger ? 'error' : 'warning'}>
            {t('activity-ctx-warn')}{warnPct}% ·{' '}
          </Text>
        )}
        {activity.phase === 'done' ? (
          <Text color={color}>{activity.line}</Text>
        ) : (
          <Text>{activity.line}</Text>
        )}
        {suffix !== undefined && <Text dimColor>{suffix}</Text>}
      </Text>
    </Box>
  )
}
