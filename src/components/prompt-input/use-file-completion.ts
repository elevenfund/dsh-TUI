import React from 'react'
import { mentionAtCaret } from '../../utils/mentions.js'
import { preserveSelection, type FileCandidate } from '../../utils/fileSuggestions.js'
import type { ChannelUi as Channel } from '../../adapter/channel/ui-policy.js'

/**
 * `@` file completion (issue #15): the trigger is the mention token at the
 * CARET, so `@` works mid-message (`看看 @src/a.ts 这个`), not only when it
 * is the input's first character. The cwd listing loads when the trigger
 * appears. Extracted verbatim from PromptInput.tsx; the component keeps its
 * own `mentionAtCaret` read for overlay gating.
 */
export function useFileCompletion(
  value: string,
  cursor: number,
  channel: Channel,
): {
  fileMatches: readonly FileCandidate[]
  fileSelected: number
  setFileSelected: React.Dispatch<React.SetStateAction<number>>
  selectedFile: FileCandidate | undefined
} {
  const [fileMatches, setFileMatches] = React.useState<readonly FileCandidate[]>([])
  const [fileSelected, setFileSelected] = React.useState(0)
  const mention = mentionAtCaret(value, cursor)
  const atTrigger = mention !== undefined
  const fileRequestId = React.useRef(0)
  const selectedFile = fileMatches[fileSelected]
  React.useEffect(() => {
    const requestId = ++fileRequestId.current
    if (!mention) {
      setFileMatches([])
      setFileSelected(0)
      return
    }
    const previous = selectedFile
    // Deps key on `mention.query` (and trigger on/off) only: cursor movement
    // within the same token must NOT refetch, and `selectedFile`/`fileSelected`
    // are read as their render-time values only to seed selection preservation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    void channel.listFileCandidates(mention.query, { topK: 50 }).then(next => {
      if (requestId !== fileRequestId.current) return
      setFileMatches(next)
      setFileSelected(preserveSelection(previous, next, fileSelected))
    })
  }, [channel, mention?.query, atTrigger])
  return { fileMatches, fileSelected, setFileSelected, selectedFile }
}
