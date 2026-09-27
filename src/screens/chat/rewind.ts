import type { ChannelUi } from '../../adapter/channel/ui-policy.js'
import type { ChatOverlayAction } from '../chatOverlay.js'
import type { ChatRow } from '../../dsh-adapter/channel.js'
import { t } from '../../i18n.js'

export interface RewindCommands {
  /** Open the rewind picker (from PromptInput's double-Esc on an empty input). */
  openRewind: () => void
  /**
   * Enter on a rewind candidate: ask the plugins first (tui/rewind-prompt).
   * A veto keeps the list open; offered modes turn the confirm pane into a
   * choice list; "no opinion" lands on the plain confirm as before.
   */
  requestRewindConfirm: (row: ChatRow) => Promise<void>
  /** Execute the confirmed rewind; the message comes back into the input. */
  performRewind: (row: ChatRow, mode?: string | null) => Promise<void>
}

/** The /rewind command family, extracted verbatim from Chat. */
export function createRewindCommands(args: {
  channel: ChannelUi
  dispatchOverlay: (action: ChatOverlayAction) => void
  rewindRequestRef: { current: number }
  pendingFillRef: { current: string | null }
  setHistoryFill: (text: string) => void
}): RewindCommands {
  const { channel, dispatchOverlay, rewindRequestRef, pendingFillRef, setHistoryFill } = args
  const openRewind = () => {
    // The overlay is not 'rewind' yet this render, so rewindRows is empty —
    // scan directly instead of reading the gated list.
    const candidates = channel.rows
      .filter(row => row.kind === 'user' && row.label === undefined)
      .reverse()
    if (candidates.length === 0) {
      channel.notify(t('rewind-none'))
      return
    }
    rewindRequestRef.current += 1
    dispatchOverlay({
      type: 'open',
      overlay: { kind: 'rewind', index: 0, confirm: null, modes: null, modeIndex: 0, busy: false },
    })
  }
  const requestRewindConfirm = async (row: ChatRow) => {
    const token = ++rewindRequestRef.current
    dispatchOverlay({ type: 'rewind-busy', busy: true })
    const decision = await channel.promptRewind(row)
    if (token !== rewindRequestRef.current) return
    if (decision === 'cancel') {
      dispatchOverlay({ type: 'rewind-busy', busy: false })
      return
    }
    dispatchOverlay({ type: 'rewind-decision', confirm: row, modes: decision?.modes ?? null })
  }
  const performRewind = async (row: ChatRow, mode: string | null = null) => {
    const text = await channel.rewindTo(row, mode)
    if (text !== null) {
      // The restored message belongs to the binding `rewindTo` just created,
      // not to the one it replaced: it is the user's choice, and the switch
      // effect must not treat it as the old conversation's leftovers.
      pendingFillRef.current = String(channel.agentId)
      // Put the restored message back in the prompt for re-editing.
      setHistoryFill(text)
      channel.notify(t('rewind-done'))
    }
  }
  return { openRewind, requestRewindConfirm, performRewind }
}
