import React from 'react'
import { markHomeSeen } from '../../homePrefs.js'
import type { ChannelUi } from '../../adapter/channel/ui-policy.js'

/**
 * Whole-screen surfaces owned by Chat: the trajectory scene (open/close —
 * Chat stays mounted underneath) and the supervisor leave path (`/bg`
 * return target honored, one-shot landing preference written on the way
 * out). Extracted verbatim from Chat.
 */
export function useSceneHome(args: {
  channel: ChannelUi
  markFailuresSeen: () => void
  suppressLogoIntroRef: { current: boolean }
  agentViewReturnId: string | undefined
  setAgentViewReturnId: (id: string | undefined) => void
  setSupervisorOpen: (open: boolean) => void
  repaintTranscript: () => void
}) {
  const { channel, markFailuresSeen, suppressLogoIntroRef, agentViewReturnId, setAgentViewReturnId, setSupervisorOpen, repaintTranscript } = args
  /**
   * The trajectory scene (issue #80 evolution). Unlike every other overlay
   * here it is not a panel but a whole screen: while open, Chat renders the
   * scene INSTEAD of the conversation (see the early return below) and hands
   * it the keyboard. Chat itself stays mounted, so scroll position, pickers
   * and in-flight turn state survive the round trip untouched.
   */
  const [sceneOpen, setSceneOpen] = React.useState(false)
  /**
   * Close the scene.
   *
   * Leaving the alternate screen makes the terminal restore the main buffer;
   * Ink restores the matching saved frame and diffs any conversation changes
   * that happened while the scene was open.
   */
  const closeScene = React.useCallback(() => {
    setSceneOpen(false)
  }, [])

  /** Open the scene, mark failures seen, and retire the key hint for good. */
  const openScene = React.useCallback(() => {
    markFailuresSeen()
    setSceneOpen(true)
  }, [])

  /**
   * Leave the session supervisor for the conversation.
   *
   * The one-shot landing preference is written here rather than at boot: a
   * process that dies before the user ever sees the screen (a config error, a
   * crash during the first render) must not burn the installation's only
   * first-launch landing. Writing on the way OUT means "the user has seen it".
   *
   * Leaving also honours `/bg`'s return target. `/background` moved the
   * session the user was in to the background and opened this screen; a plain
   * Esc out of it re-attaches to that session instead of silently leaving them
   * on the fresh one, which is what "go back to what I was doing" means. Any
   * explicit mount inside the screen clears the target first, so this can
   * never undo a choice the user just made.
   */
  const closeHome = React.useCallback(() => {
    suppressLogoIntroRef.current = true
    markHomeSeen()
    const returnTo = agentViewReturnId
    setAgentViewReturnId(undefined)
    setSupervisorOpen(false)
    if (returnTo !== undefined && returnTo !== channel.agentId) {
      void channel.resumeTo(returnTo).then((result) => {
        if (result.ok) repaintTranscript()
      }).catch(() => undefined)
    }
  }, [agentViewReturnId, channel, repaintTranscript])
  return { sceneOpen, setSceneOpen, closeScene, openScene, closeHome }
}
