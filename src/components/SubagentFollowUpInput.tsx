import React from 'react'
import { Text } from '../ui.js'
import { t } from '../i18n.js'

/**
 * Shared follow-up composer for subagent surfaces (dashboard card, detail
 * scene). Both scenes own a full-screen input grab, so the hook exposes the
 * composing state and a key handler to branch on BEFORE the scene's own
 * navigation keys; Enter sends, Esc cancels, backspace edits. The rendered
 * line is a one-row `› prompt` field kept at the bottom of the owning scene.
 */
export interface FollowUpInputState {
  readonly composing: boolean
  readonly draft: string
  readonly sending: boolean
  /** Feed the scene's useInput payload while composing. Returns true when
   * the key was consumed (the scene must skip its own handling). */
  handleKey(input: string, key: { return: boolean; escape: boolean; backspace: boolean; delete: boolean; ctrl: boolean }): boolean
  begin(): void
  reset(): void
}

export function useFollowUpInput(onSubmit: (text: string) => void | Promise<unknown>): FollowUpInputState {
  const [composing, setComposing] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [sending, setSending] = React.useState(false)

  const send = React.useCallback(async (): Promise<void> => {
    const text = draft.trim()
    if (text === '') { setComposing(false); return }
    setSending(true)
    try {
      await onSubmit(text)
    } finally {
      setSending(false)
      setDraft('')
      setComposing(false)
    }
  }, [draft, onSubmit])

  const handleKey = React.useCallback((input: string, key: { return: boolean; escape: boolean; backspace: boolean; delete: boolean; ctrl: boolean }): boolean => {
    if (!composing) return false
    if (key.escape) { setComposing(false); setDraft(''); return true }
    if (key.return) { void send(); return true }
    if (key.backspace || key.delete) { setDraft(value => value.slice(0, -1)); return true }
    if (key.ctrl || input === '') return true
    setDraft(value => value + input)
    return true
  }, [composing, send])

  return {
    composing,
    draft,
    sending,
    handleKey,
    begin: React.useCallback((): void => { setComposing(true); setDraft('') }, []),
    reset: React.useCallback((): void => { setComposing(false); setDraft('') }, []),
  }
}

/** The one-row composer field. Mount it only while `state.composing`; the
 * owning scene keeps its own footer hint line above it. */
export function FollowUpLine({ state, placeholder }: { state: FollowUpInputState; placeholder: string }): React.ReactNode {
  return (
    <Text>
      <Text color="warning" bold>{'› '}</Text>
      <Text wrap="truncate">{state.draft !== '' ? state.draft : <Text dimColor>{placeholder}</Text>}</Text>
      <Text color="warning">{state.draft === '' ? '' : ' '}{'▏'}</Text>
      {state.sending && <Text dimColor>{` ${t('subagent-followup-sending')}`}</Text>}
    </Text>
  )
}
