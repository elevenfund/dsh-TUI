import React from 'react'
import type { ChannelUi } from '../../adapter/channel/ui-policy.js'
import type { ChatRow } from '../../dsh-adapter/channel.js'

/**
 * `/` transcript incsearch state: the per-render match list (rows is a live
 * in-place array, so a useMemo would freeze at mount), the highlight/count
 * sync effect, and the current-match keep-in-view effect. Extracted
 * verbatim from Chat; `searchableText` arrives as a dependency so the module
 * stays free of transcript rendering imports.
 */
export function useTranscriptSearch(args: {
  channel: ChannelUi
  searchActive: boolean
  searchQuery: string
  searchCurrent: number
  setSearchCount: (count: number) => void
  setSearchCurrent: (current: number) => void
  setHighlight: (query: string) => void
  seekRow: (rowId: number) => void
  searchableText: (row: ChatRow) => string
}) {
  const { channel, searchActive, searchQuery, searchCurrent, setSearchCount, setSearchCurrent, setHighlight, seekRow, searchableText } = args
  // Computed per render — `channel.rows` is a live in-place array (see
  // selectableRows); a useMemo would freeze the match list at mount.
  const searchMatches = (() => {
    const q = searchQuery.toLowerCase()
    if (!q) return []
    return channel.rows
      .map((row, index) => ({ row, index, text: searchableText(row).toLowerCase() }))
      .filter(m => m.text.includes(q))
  })()

  // Incsearch: highlight all matches (screen-space overlay) and keep the
  // current match row in view as the query changes.
  React.useEffect(() => {
    if (!searchActive) return
    setHighlight(searchQuery)
    const count = searchMatches.length
    setSearchCount(count)
    const current = Math.min(searchCurrent, Math.max(0, count - 1))
    setSearchCurrent(current)
    const target = searchMatches[current]
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- runtime guard: out-of-range index on an empty/filtered list
    if (target) {
      seekRow(target.row.id)
    }
  }, [searchQuery, searchActive])

  // n/N navigation: move the current match into view.
  React.useEffect(() => {
    if (!searchActive) return
    const target = searchMatches[searchCurrent]
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- runtime guard: out-of-range index on an empty/filtered list
    if (target) {
      seekRow(target.row.id)
    }
  }, [searchCurrent])

  return { searchMatches }
}
