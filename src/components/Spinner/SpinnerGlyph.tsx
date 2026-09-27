import React from 'react'
import Box from '../../ink/components/Box.js'
import Text from '../design-system/ThemedText.js'
import { getTheme, type Theme } from '../../theme.js'
import { useTheme } from '../design-system/ThemeProvider.js'
import { interpolateColor, parseRGB, toRGBColor } from './spinnerUtils.js'
import { useBlink } from '../../hooks/useBlink.js'
import { DIAMOND } from '../../terminal-utils/figures.js'

const REDUCED_MOTION_DOT = '●'
const REDUCED_MOTION_CYCLE_MS = 2000 // 2-second cycle: 1s visible, 1s dim
const ERROR_RED = { r: 171, g: 43, b: 63 }

type Props = {
  /** Deprecated: frames no longer rotate — the glyph is the shared
   *  grok-style blinking diamond. Kept for call-site compatibility. */
  frame: number
  messageColor: keyof Theme
  stalledIntensity?: number
  reducedMotion?: boolean
  time?: number
}

/**
 * The working glyph: a blinking diamond in the message color (grok-style
 * running bullet, same cadence as tool and thinking rows). Its fixed
 * two-column slot keeps the message aligned while it blinks and while
 * reduced-motion mode is active. Stalled turns tint toward error red.
 */
export function SpinnerGlyph({
  messageColor,
  stalledIntensity = 0,
  reducedMotion = false,
  time = 0,
}: Props): React.ReactNode {
  const [themeName] = useTheme()
  const theme = getTheme(themeName)
  const [ref, isBlinking] = useBlink(!reducedMotion && stalledIntensity <= 0)

  if (reducedMotion) {
    const isDim = Math.floor(time / (REDUCED_MOTION_CYCLE_MS / 2)) % 2 === 1
    return (
      <Box flexWrap="wrap" height={1} width={2}>
        <Text color={messageColor} dimColor={isDim}>
          {REDUCED_MOTION_DOT}
        </Text>
      </Box>
    )
  }

  if (stalledIntensity > 0) {
    const baseColorStr = theme[messageColor]
    const baseRGB = baseColorStr ? parseRGB(baseColorStr) : null

    if (baseRGB) {
      const interpolated = interpolateColor(baseRGB, ERROR_RED, stalledIntensity)
      return (
        <Box flexWrap="wrap" height={1} width={2}>
          <Text color={toRGBColor(interpolated)}>{DIAMOND}</Text>
        </Box>
      )
    }
    // Fallback for ANSI themes: use messageColor until fully stalled, then error
    const color = stalledIntensity > 0.5 ? 'error' : messageColor
    return (
      <Box flexWrap="wrap" height={1} width={2}>
        <Text color={color}>{DIAMOND}</Text>
      </Box>
    )
  }

  return (
    <Box flexWrap="wrap" height={1} width={2} ref={ref}>
      <Text color={isBlinking ? messageColor : undefined} bold={isBlinking}>
        {DIAMOND}
      </Text>
    </Box>
  )
}
