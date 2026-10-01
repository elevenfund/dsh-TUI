import React from 'react'
import type { TimelineSnapshot } from '../../ink/timeline-rail.js'

/** Transcript browsing state: the timeline snapshot MessageList reports, the
 * keyboard-selection cursor, and the per-row fold toggles. Extracted verbatim
 * from Chat — the session-switch reset and the key routing stay in Chat's
 * orchestration, this hook only owns the state itself. */
export function useTranscriptBrowsing(): {
  timeline: TimelineSnapshot
  setTimeline: React.Dispatch<React.SetStateAction<TimelineSnapshot>>
  selectionActive: boolean
  setSelectionActive: React.Dispatch<React.SetStateAction<boolean>>
  selectedId: number | null
  setSelectedId: React.Dispatch<React.SetStateAction<number | null>>
  expandedRows: ReadonlySet<number>
  setExpandedRows: React.Dispatch<React.SetStateAction<ReadonlySet<number>>>
  streamViewToggledRows: ReadonlySet<number>
  setStreamViewToggledRows: React.Dispatch<React.SetStateAction<ReadonlySet<number>>>
} {
  const [timeline, setTimeline] = React.useState<TimelineSnapshot>({
    turns: [],
    activeId: null,
    pinnedId: null,
    upId: null,
    downId: null,
  })
  const [selectionActive, setSelectionActive] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState<number | null>(null)
  const [expandedRows, setExpandedRows] = React.useState<ReadonlySet<number>>(
    () => new Set(),
  )
  /** 流式 reasoning 行相对 thinkingFold 默认值的用户切换。与
   *  expandedRows 分开：preview 默认三行、full 默认全文，点击在两者间
   *  翻转；落定后自动回到普通行的折叠语义。 */
  const [streamViewToggledRows, setStreamViewToggledRows] = React.useState<ReadonlySet<number>>(
    () => new Set(),
  )
  return {
    timeline, setTimeline,
    selectionActive, setSelectionActive,
    selectedId, setSelectedId,
    expandedRows, setExpandedRows,
    streamViewToggledRows, setStreamViewToggledRows,
  }
}
