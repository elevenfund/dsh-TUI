import React from 'react'

/** Which full-screen surface is up. Chat only opens and closes these; each
 * surface owns its own focus, staged drafts, and keyboard. Pure UI assembly
 * state — extracted verbatim from Chat so the main function stops carrying
 * eleven panel booleans and their open helpers. */
export function usePanelVisibility(openHomeOnBoot: boolean | undefined): {
  supervisorOpen: boolean
  setSupervisorOpen: React.Dispatch<React.SetStateAction<boolean>>
  treeOpen: boolean
  setTreeOpen: React.Dispatch<React.SetStateAction<boolean>>
  agentViewReturnId: string | undefined
  setAgentViewReturnId: React.Dispatch<React.SetStateAction<string | undefined>>
  settingsOpen: boolean
  setSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>
  subagentDashboardOpen: boolean
  setSubagentDashboardOpen: React.Dispatch<React.SetStateAction<boolean>>
  jobsPanelOpen: boolean
  setJobsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  jobsPanelFocusId: string | null
  setJobsPanelFocusId: React.Dispatch<React.SetStateAction<string | null>>
  subagentDetailId: string | null
  setSubagentDetailId: React.Dispatch<React.SetStateAction<string | null>>
  subagentDetailFromDashboard: boolean
  setSubagentDetailFromDashboard: React.Dispatch<React.SetStateAction<boolean>>
  taskCenterOpen: boolean
  setTaskCenterOpen: React.Dispatch<React.SetStateAction<boolean>>
  taskCenterDetailId: string | null
  setTaskCenterDetailId: React.Dispatch<React.SetStateAction<string | null>>
  taskCenterDetailFromPanel: boolean
  setTaskCenterDetailFromPanel: React.Dispatch<React.SetStateAction<boolean>>
  openJobsPanel: (focusId?: string) => void
  openSubagentDashboard: () => void
  openTaskCenter: () => void
  openSubagentDetailFromTranscript: (id: string) => void
} {
  const [supervisorOpen, setSupervisorOpen] = React.useState(openHomeOnBoot === true)
  /** `/tree` opens the session family tree (pi's Session Tree): every rewind
   *  fork stitched back onto the message it diverged from, hover previews,
   *  and per-node rewind/fork/adopt actions. Like the supervisor, a screen. */
  const [treeOpen, setTreeOpen] = React.useState(false)
  /**
   * The session backgrounded when the screen opened via ←/`/bg` (the "Esc
   * returns to that conversation" return target), cleared on close.
   */
  const [agentViewReturnId, setAgentViewReturnId] = React.useState<string | undefined>(undefined)
  /** `/settings` opens the plugin settings screen (issue #165) — like the
   *  browser, a screen rather than a panel: it owns its own focus, staged
   *  drafts and keyboard; Chat only opens it. */
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  /** Subagent dashboard (Ctrl+A): displays active/completed subagents. */
  const [subagentDashboardOpen, setSubagentDashboardOpen] = React.useState(false)
  const [jobsPanelOpen, setJobsPanelOpen] = React.useState(false)
  /** Job id the panel should focus on open: set by a transcript card click
   *  (open the panel AT that job), cleared on close so the keyboard/command
   *  path reopens at the top. */
  const [jobsPanelFocusId, setJobsPanelFocusId] = React.useState<string | null>(null)
  /** Detail view for a specific subagent (opened from dashboard). */
  const [subagentDetailId, setSubagentDetailId] = React.useState<string | null>(null)
  /** Where the open subagent detail was entered from: the Ctrl+A dashboard
   *  returns there on Esc; a transcript card returns to the transcript
   *  (Esc must not summon a dashboard the user never opened). */
  const [subagentDetailFromDashboard, setSubagentDetailFromDashboard] = React.useState(true)
  /** Task center (Ctrl+G): the unified classified panel over jobs +
   *  subagents. Legacy Ctrl+A dashboard and /jobs panel stay untouched. */
  const [taskCenterOpen, setTaskCenterOpen] = React.useState(false)
  const [taskCenterDetailId, setTaskCenterDetailId] = React.useState<string | null>(null)
  /** Where the open detail scene was entered from: the panel (Enter on a
   *  row) returns to the panel on Esc, the agent strip returns to the main
   *  session. */
  const [taskCenterDetailFromPanel, setTaskCenterDetailFromPanel] = React.useState(true)

  // MessageList forwards these open handlers into every memoized row. Their
  // identities must survive token/metrics updates, including for tool rows —
  // an inline closure re-renders ALL settled tool cards on each channel
  // version (verify-tool-history-window).
  const openJobsPanel = React.useCallback((focusId?: string) => {
    if (typeof focusId === 'string' && focusId !== '') setJobsPanelFocusId(focusId)
    setJobsPanelOpen(true)
  }, [])
  // Stable identity for the StatusLine subagents chip's click target.
  const openSubagentDashboard = React.useCallback(() => setSubagentDashboardOpen(true), [])
  // The strip and the status chips open the unified task center (Ctrl+G).
  const openTaskCenter = React.useCallback(() => setTaskCenterOpen(true), [])
  // From a transcript card: Esc closes back into the transcript (never
  // summons a dashboard the user never opened).
  const openSubagentDetailFromTranscript = React.useCallback((id: string) => {
    setSubagentDetailFromDashboard(false)
    setSubagentDetailId(id)
  }, [])

  return {
    supervisorOpen, setSupervisorOpen,
    treeOpen, setTreeOpen,
    agentViewReturnId, setAgentViewReturnId,
    settingsOpen, setSettingsOpen,
    subagentDashboardOpen, setSubagentDashboardOpen,
    jobsPanelOpen, setJobsPanelOpen,
    jobsPanelFocusId, setJobsPanelFocusId,
    subagentDetailId, setSubagentDetailId,
    subagentDetailFromDashboard, setSubagentDetailFromDashboard,
    taskCenterOpen, setTaskCenterOpen,
    taskCenterDetailId, setTaskCenterDetailId,
    taskCenterDetailFromPanel, setTaskCenterDetailFromPanel,
    openJobsPanel,
    openSubagentDashboard,
    openTaskCenter,
    openSubagentDetailFromTranscript,
  }
}
