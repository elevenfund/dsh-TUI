import React from 'react'
import { Box } from '../../ui.js'
import { AgentStrip } from '../../components/AgentStrip.js'
import { BtwPanel } from '../../components/BtwPanel.js'
import { ExtensionDialog } from '../../components/ExtensionDialog.js'
import { PromptInput } from '../../components/PromptInput.js'
import { RecapPanel } from '../../components/RecapPanel.js'
import { TipsPanel } from '../../components/TipsPanel.js'
import { StatusLine } from '../StatusLine.js'
import { TranscriptSearch } from './chrome.js'
import { t } from '../../i18n.js'
import { setClipboard } from '../../ink/termio/osc.js'
import type { ChatOverlay, ChatOverlayAction } from '../chatOverlay.js'
import type { TuiDialogSnapshot, TuiDialogAnswer } from '../../dsh-adapter/dialogs.js'
import type { PromptController } from '../../components/PromptInput.js'
import type { PromptDraftCache } from '../../components/promptDraftCache.js'
import type { TranscriptImage } from '../../dsh-adapter/channel.js'
import type { BtwState, RecapState } from './use-side-panels.js'
import type { WaveBand } from '../../dsh-adapter/trajectory/types.js'
import type { ChannelUi } from '../../adapter/channel/ui-policy.js'

/**
 * The input cluster: the replaceable input-row chain (approval / dialog /
 * tips / recap / question / btw / search each take over the prompt slot),
 * the composer itself, and the status line — plus the transient overlay
 * anchor Box. Extracted verbatim from Chat's JSX; every prop is a
 * pass-through of the same closure the inline JSX read.
 */
export function InputCluster(props: {
  agentViewOpenSessionRef: { current: string | undefined }
  agentViewRows: readonly import('../../dsh-adapter/channel.js').AgentViewRow[]
  approvalPanelNode: React.ReactNode
  backgroundAgentsNeedingInput: number
  backgroundToAgentView: () => void
  channel: ChannelUi
  dialogSnapshot: TuiDialogSnapshot | null
  dialogs: { decide: (key: string, value: TuiDialogAnswer) => void; cancel: (key: string) => void }
  dispatchOverlay: (action: ChatOverlayAction) => void
  enterSelection: () => void
  exitSelection: () => void
  expanded: boolean
  handle: import('../../ui.js').ScrollBoxHandle | null
  helpOpen: boolean
  historyFill: string | null
  openTaskCenter: () => void
  overlay: ChatOverlay
  promptControllerRef: React.RefObject<PromptController | null>
  promptDraftRef: { current: PromptDraftCache }
  promptReplacementOpen: boolean
  promptSelectionActive: boolean
  questionPanelNode: React.ReactNode
  runCommand: (name: string, rawInput?: string, images?: readonly import('../../dsh-adapter/channel.js').ComposerImageRef[]) => boolean | Promise<boolean>
  searchActive: boolean
  searchQuery: string
  searchCursor: number
  searchCount: number
  searchCurrent: number
  selectionActive: boolean
  setHelpOpen: React.Dispatch<React.SetStateAction<boolean>>
  setHistoryFill: (text: string | null) => void
  setSupervisorOpen: React.Dispatch<React.SetStateAction<boolean>>
  setTaskCenterDetailFromPanel: (fromPanel: boolean) => void
  setTaskCenterDetailId: (id: string | null) => void
  workingActivity: import('../../components/ActivityLine.js').ActivityLineValue | undefined
  writeRaw: ((data: string) => void | null) | null
  btw: BtwState | null
  closeBtw: () => void
  recap: RecapState | null
  setRecap: React.Dispatch<React.SetStateAction<RecapState | null>>
  closeRecap: () => void
  dismissPeek: () => void
  handleCaretImage: (image: TranscriptImage | undefined, title: string | undefined, reason: 'caret' | 'click') => void
  peekPreview: { image: TranscriptImage; title?: string } | null
  openRewind: () => void
  historyMatches: readonly { text: string }[]
  wakeBand: WaveBand | undefined
  wakeTime: number
  trajectorySeen: boolean
  /** Opens the trajectory scene — the wake strip's click target. */
  openScene: () => void
  /** Effective trajectory combo display (hover hint + first-run hint). */
  trajectoryCombo: string
}): React.ReactNode {
  const {
    agentViewOpenSessionRef, agentViewRows, approvalPanelNode,
    backgroundAgentsNeedingInput, backgroundToAgentView,
    channel, dialogSnapshot, dialogs, dispatchOverlay,
    enterSelection, exitSelection, expanded, handle, helpOpen,
    historyFill, openTaskCenter, overlay,
    promptControllerRef, promptDraftRef, promptReplacementOpen,
    promptSelectionActive, questionPanelNode, runCommand,
    searchActive, searchQuery, searchCursor, searchCount, searchCurrent,
    selectionActive, setHelpOpen, setHistoryFill, setSupervisorOpen,
    setTaskCenterDetailFromPanel, setTaskCenterDetailId,
    workingActivity, writeRaw,
    btw, closeBtw, recap, setRecap, closeRecap,
    dismissPeek, handleCaretImage, peekPreview, openRewind, historyMatches,
    wakeBand, wakeTime, trajectorySeen, openScene, trajectoryCombo,
  } = props
  return (
<Box flexDirection="column" flexShrink={0}>
        {approvalPanelNode !== null ? (
          approvalPanelNode
        ) : dialogSnapshot !== null ? (
          <ExtensionDialog
            key={dialogSnapshot.key}
            dialog={dialogSnapshot}
            onDecide={value => dialogs.decide(dialogSnapshot.key, value)}
            onCancel={() => dialogs.cancel(dialogSnapshot.key)}
          />
        ) : overlay.kind === 'tips' ? (
          <Box flexDirection="column" marginTop={1}>
            <TipsPanel onClose={() => dispatchOverlay({ type: 'close-if', kind: 'tips' })} />
          </Box>
        ) : recap !== null && (!recap.auto || recap.expanded) ? (
          <Box flexDirection="column" marginTop={1}>
            <RecapPanel
              summary={recap.summary}
              title={recap.title}
              error={recap.error}
              streaming={!recap.done}
              titleApplied={recap.titleApplied}
              onClose={() => {
                // An expanded auto recap collapses back to its dim row;
                // a manual /recap closes outright.
                if (recap.auto) {
                  setRecap(prev => (prev ? { ...prev, expanded: false } : prev))
                } else {
                  closeRecap()
                }
              }}
              onCopy={() => {
                void setClipboard(recap.summary ?? '').then(raw => { if (raw) writeRaw?.(raw) })
                channel.notify(t('copied-chars', { n: (recap.summary ?? '').length }), { timeoutMs: 1500 })
              }}
              onApplyTitle={() => {
                if (recap.title === undefined || recap.titleApplied) return
                channel.renameSession(recap.title)
                setRecap(prev => (prev ? { ...prev, titleApplied: true } : prev))
                channel.notify(t('recap-title-applied-notify', { title: recap.title }), { color: 'success' })
              }}
            />
          </Box>
        ) : btw !== null ? (
          <Box flexDirection="column" marginTop={1}>
            <BtwPanel
              question={btw.question}
              answer={btw.answer}
              error={btw.error}
              streaming={!btw.done}
              onClose={closeBtw}
              onCopy={() => {
                void setClipboard(btw.answer ?? '').then(raw => { if (raw) writeRaw?.(raw) })
                channel.notify(t('copied-chars', { n: (btw.answer ?? '').length }), { timeoutMs: 1500 })
              }}
            />
          </Box>
        ) : questionPanelNode !== null ? (
          questionPanelNode
        ) : null}
        <PromptInput
          key="prompt-input"
          channel={channel}
          suspended={promptReplacementOpen}
          draftCache={promptDraftRef.current}
          helpOpen={helpOpen}
          onToggleHelp={() =>{  setHelpOpen(previous => !previous) }}
          onRunCommand={runCommand}
          selectionActive={promptSelectionActive}
          onEnterSelection={enterSelection}
          onExitSelection={exitSelection}
          fillText={historyFill}
          onFillConsumed={() => setHistoryFill(null)}
          onRewindRequest={openRewind}
          onBackgroundRequest={backgroundToAgentView}
          // The 🏠 at the head of the input row opens the same session screen
          // `/resume` and `/agentview` open — one surface, three doors. It is
          // gated on this prop rather than a setting, so hosts that mount the
          // prompt without a session screen (and the layout regressions that
          // pin the row's column budget) keep the row they had.
          onOpenSessions={() => {
            agentViewOpenSessionRef.current = channel.agentId
            setSupervisorOpen(true)
          }}
          backgroundAgentsNeedingInput={
            // Only the real channel supplies the seam; pre-agent-view test
            // stubs must not grow the footer row (layout-dependent
            // regressions pin the visible row count). The footer only
            // renders while some session actually waits (N > 0): a
            // permanent idle row would steal a transcript row on every
            // real channel — one row is enough to scroll the startup
            // header fully off a short terminal, pausing its viewport
            // clock and shifting every row-count layout invariant.
            channel.agentViewRows !== undefined && backgroundAgentsNeedingInput > 0
              ? backgroundAgentsNeedingInput
              : undefined
          }
          controllerRef={promptControllerRef}
          onCaretImage={handleCaretImage}
          caretPreviewOpen={peekPreview !== null}
          onDismissCaretPreview={dismissPeek}
          onSubmitted={() => handle?.scrollToBottom()}
        />
        <AgentStrip
          jobs={channel.backgroundJobs ?? []}
          subagents={channel.subagents ?? []}
          onOpenCenter={openTaskCenter}
          onOpenSubagent={(id) => {
            // Strip click: Esc returns to the main session, not the panel.
            setTaskCenterDetailFromPanel(false)
            setTaskCenterDetailId(id)
          }}
        />
        <StatusLine
          channel={channel}
          activity={workingActivity}
          selectionActive={selectionActive}
          helpOpen={helpOpen}
          onOpenSubagents={openTaskCenter}
          wake={
            wakeBand === undefined
              ? undefined
              : {
                  band: wakeBand,
                  hint: trajectorySeen ? undefined : trajectoryCombo,
                  tick: Math.floor(wakeTime / 120),
                  // Click target for the strip: opens the trajectory scene.
                  onOpen: openScene,
                  // Chord revealed while the pointer rests on the strip.
                  hoverHint: trajectoryCombo,
                }
          }
        />
    </Box>
  )
}
