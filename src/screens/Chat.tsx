import React from 'react'
import { t, getLang, setLang, isLang, writeLangPref, readLangPref, subscribeLang, LANGS, type Lang } from '../i18n.js'
import { readThemePref } from '../themePrefs.js'
import { readPresetPref } from '../presetPrefs.js'
import { readModelPref } from '../modelPrefs.js'
import { readActivityFrames } from '../activityPrefs.js'
import { envThemeOverride } from '../components/design-system/ThemeProvider.js'
import { hasPath } from '../dsh-adapter/settingsEditor.js'
import { isMod } from '../utils/modifiers.js'
import { planReload, type ReloadKind } from '../reload.js'
import { AlternateScreen, Box, Image, Text, useInput, ScrollBox, type ScrollBoxHandle, useTheme, useTerminalSize } from '../ui.js'
import * as tuiKit from '../ui.js'
import { usePageInset } from '../components/PageMargin.js'
import { POINTER } from '../terminal-utils/figures.js'
import { isPlainReturnInput, modLabel } from '../utils/modifiers.js'
import { actionMatches } from '../utils/keymap.js'
import { formatTokens } from '../terminal-utils/format.js'
import { homeDir } from '../utils/paths.js'
import type { LlmModelInfo, LlmProviderInfo } from '../adapter/ports/channel-view.js'
import { cleanRenderText, cleanScalarText } from '../dsh-adapter/sanitize.js'
import {
  deriveModelGroups,
  modelPickerLanding,
  recentCatalogModels,
  RECENTS_GROUP_PROVIDER,
} from '../modelGroups.js'
import { readModelRecents, recordModelUse, type ModelRecentsRef } from '../modelRecents.js'
import type { ChannelUi as Channel } from '../adapter/channel/ui-policy.js'
import { sessionCwdMatches, type ChatRow, type ComposerImageRef, type EffortOption, type ExternalCommandOutcome, type PermissionPresetSnapshot, type PresetOption, type SkillInfo } from '../dsh-adapter/channel.js'
import type { QuestionStore } from '../dsh-adapter/questions.js'
import { TuiDialogStore } from '../dsh-adapter/dialogs.js'
import { TuiStatusStore, type TuiStatusViewUi } from '../dsh-adapter/status.js'
import { ActivityPhase, ActivityStore, useActivity } from '../dsh-adapter/activity-store.js'
import type { TranscriptImage } from '../dsh-adapter/transcript-images.js'
import type { TuiShortcutHost } from '../dsh-adapter/shortcuts.js'
import type { TuiThemeHost } from '../dsh-adapter/themes.js'
import type { TuiRewindMode } from '../dsh-adapter/extension-events.js'
import { runProviderWizard } from '../dsh-adapter/providerWizard.js'
import { ApprovalStore } from '../dsh-adapter/approvals.js'
import { AskUserQuestionPanel } from '../components/questions/AskUserQuestionPanel.js'
import { ApprovalPanel } from '../components/approvals/ApprovalPanel.js'
import { ExtensionDialog } from '../components/ExtensionDialog.js'
import type { DOMElement } from '../ink/dom.js'
import { useSearchHighlight } from '../ink/hooks/use-search-highlight.js'
import { useTerminalTitle } from '../ink/hooks/use-terminal-title.js'
import { useTerminalFocus } from '../ink/hooks/use-terminal-focus.js'
import { useCopyOnSelect } from '../ink/hooks/use-copy-on-select.js'
import { useSelection } from '../ink/hooks/use-selection.js'
import { NoSelect } from '../ink/components/NoSelect.js'
import { LogoHeader, MessageList } from '../components/MessageList.js'
import { TimelineRail } from '../components/TimelineRail.js'
import { ScrollbarGutter } from '../components/ScrollbarGutter.js'
import type { TimelineSnapshot } from '../ink/timeline-rail.js'
import { normalizeScrollGutter } from '../tuiDisplayPrefs.js'
import { OverlayAbove } from '../components/OverlayAbove.js'
import { TooltipLayer } from '../components/Tooltip.js'
import { PromptInput, type PromptController } from '../components/PromptInput.js'
import type { PromptDraftCache } from '../components/promptDraftCache.js'
import type { InjectController } from '../dsh-adapter/inject-channel.js'
import { PromptEditorLayer, usePromptEditorOpen } from '../components/PromptEditor.js'
import { GoalTodoPanel } from '../components/GoalTodoPanel.js'
import { AutoRecapRow } from '../components/AutoRecapRow.js'
import { BalanceReportRow } from '../components/BalanceReportRow.js'
import type { BalanceResult } from '../deepseekBalance.js'
import { LoadedContextPanel } from '../components/LoadedContextPanel.js'
import { StatusLine } from './StatusLine.js'
import { WorkingSpinner, useThinkingStatus } from '../components/WorkingSpinner.js'
import { ActivityLine, contextPressurePct, liveThinkingTail } from '../components/ActivityLine.js'
import { ModelPicker } from '../components/ModelPicker.js'
import { PluginSceneBoundary } from '../components/PluginSceneBoundary.js'
import { PluginStatusViewBoundary } from '../components/PluginStatusViewBoundary.js'
import { ImagePreviewOverlay } from '../components/ImagePreviewOverlay.js'
import { RowDetailOverlay } from '../components/RowDetailOverlay.js'
import { SkillsPicker, SkillsPickerLoading } from '../components/SkillsPicker.js'
import { SessionSupervisor } from './SessionSupervisor.js'
import { SessionTree } from './SessionTree.js'
import { Settings } from './Settings.js'
import { WorkspacePicker } from '../components/WorkspacePicker.js'
import { WorkspaceMenuPicker } from '../components/WorkspaceMenuPicker.js'
import { WorkspaceFlowPicker } from '../components/WorkspaceFlowPicker.js'
import type { TuiWorkspaceCommandResult, TuiWorkspaceTarget } from '../workspaces.js'
import { ActivityPicker } from '../components/ActivityPicker.js'
import { ColorPicker } from '../components/ColorPicker.js'
import { EffortSlider } from '../components/EffortSlider.js'
import { PresetPicker } from '../components/PresetPicker.js'
import { PermissionsPicker } from '../components/PermissionsPicker.js'
import { PlanPicker } from '../components/PlanPicker.js'
import { LangPicker } from '../components/LangPicker.js'
import { ThemePicker, getThemeOptions } from '../components/ThemePicker.js'
import { AUTO_THEME_NAME, getAutoThemeBase } from '../theme.js'
import { FRAME_PRESETS, PRESET_NAMES } from '../components/activityFrames.js'
import { ThinkingToggle } from '../components/ThinkingToggle.js'
import { HistorySearchDialog } from '../components/HistorySearchDialog.js'
import { RewindPicker } from '../components/RewindPicker.js'
import { BtwPanel } from '../components/BtwPanel.js'
import { RecapPanel } from '../components/RecapPanel.js'
import { isValidSessionColor, SESSION_COLOR_NAMES } from '../terminal-utils/sessionColors.js'
import { TipsPanel } from '../components/TipsPanel.js'
import { SubagentDashboard } from '../components/SubagentDashboard.js'
import { TaskCenterPanel } from '../components/TaskCenterPanel.js'
import { AgentStrip } from '../components/AgentStrip.js'
import { TaskCenterDetail } from '../components/AgentTranscriptScene.js'
import { JobsPanel } from '../components/JobsPanel.js'
import { SubagentDetailScene } from '../components/SubagentDetailScene.js'
import { FileActionsPanel, FILE_ACTION_COUNT } from '../components/FileActionsPanel.js'
import { openExternal, openFile, revealInFileManager } from '../utils/openExternal.js'
import { resolveTargetPath } from '../utils/fileTarget.js'
import { classifyOpenTarget } from '../utils/urlGuard.js'
import { statSync } from 'node:fs'
import { setClipboard } from '../ink/termio/osc.js'
import { TerminalWriteContext } from '../ink/useTerminalNotification.js'
import instances from '../ink/instances.js'
import { useAnimationFrame } from '../ink/hooks/use-animation-frame.js'
import { useExternalVersion } from '../hooks/useExternalVersion.js'
import { TrajectoryScene } from './TrajectoryScene.js'
import { resumeFailureText } from '../sessions/resumeFailure.js'
import { markHomeSeen } from '../homePrefs.js'
import { extendTrajectory, projectWave, type TrajBuild } from '../dsh-adapter/trajectory/index.js'
import { miniWakeWidth } from '../components/trajectory/MiniWake.js'
import { readTrajectorySeen, writeTrajectorySeen } from '../trajectoryPrefs.js'
import type { RawTrajEvent as SessionEvent } from '../adapter/ports/channel-view.js'
import { LoadingState } from '../components/design-system/LoadingState.js'
import { Pane } from '../components/design-system/Pane.js'
import { loadHistory, type HistoryEntry } from '../history.js'
import { formatLoadedContextReport } from '../utils/loaded-context.js'
import {
  NO_OVERLAY,
  chatOverlayReducer,
  dialogOverlayVisible,
  wrapIndex,
  type ChatOverlay,
  type WorkspaceFlowInput,
} from './chatOverlay.js'
import type { Key } from '../ink/events/input-event.js'
import { grokWorkingLine } from './chat/working-line.js'
import { ModelPickerLoading, NewMessagesPill, PinnedTurnHeader, TranscriptSearch } from './chat/chrome.js'
import { createOverlayKeyHandlers } from './chat/overlay-keys.js'
import { selectionKeyIntent, selectionRestoreTarget, selectionStepId } from './chat/selection-mode.js'
import { useSidePanels } from './chat/use-side-panels.js'
import { peekKey, useImagePreview } from './chat/use-image-preview.js'
import { useWorkspaceCommands } from './chat/use-workspace-commands.js'
import { createRunCommand } from './chat/run-command.js'
import { createRewindCommands } from './chat/rewind.js'
import { useTrajectory } from './chat/use-trajectory.js'
import { useSeek } from './chat/use-seek.js'

/** Strip the focus/global-input surface even from untyped plugins. Local
 * click, hover, and captured drag stay inside the view and are kept. */
function StatusViewBox({
  ref: _ref,
  tabIndex: _tabIndex,
  autoFocus: _autoFocus,
  onContextMenu: _onContextMenu,
  onFocus: _onFocus,
  onFocusCapture: _onFocusCapture,
  onBlur: _onBlur,
  onBlurCapture: _onBlurCapture,
  onKeyDown: _onKeyDown,
  onKeyDownCapture: _onKeyDownCapture,
  onWheel: _onWheel,
  ...props
}: React.ComponentProps<typeof Box>): React.ReactNode {
  return <Box {...props} />
}

/** Text refs would expose the host DOM node; status text is presentation. */
function StatusViewText({
  ref: _ref,
  ...props
}: React.ComponentProps<typeof Text>): React.ReactNode {
  return <Text {...props} />
}

/** Rich status views receive pointer-only layout/text primitives, never the
 * input, channel, raw-ANSI, or terminal-write parts of the full UI kit. */
const STATUS_VIEW_UI = Object.freeze({
  Box: StatusViewBox,
  Image,
  Text: StatusViewText,
  useTerminalSize,
}) satisfies TuiStatusViewUi

/** Shared empty snapshot for hosts whose channel has no event log. */
const NO_EVENTS: readonly SessionEvent[] = []

const COMMAND_RESULT_CELLS = 200

function cleanCommandError(error: unknown): string {
  try {
    if (error instanceof Error) {
      return typeof error.message === 'string'
        ? cleanRenderText(error.message, COMMAND_RESULT_CELLS)
        : ''
    }
    return cleanScalarText(error, COMMAND_RESULT_CELLS)
  } catch {
    return ''
  }
}

function clonePermissionPresetSnapshot(snapshot: PermissionPresetSnapshot): PermissionPresetSnapshot {
  return {
    availability: snapshot.availability,
    options: snapshot.options.map(option => ({ ...option })),
    ...(snapshot.current === undefined ? {} : { current: { ...snapshot.current } }),
  }
}

/** Row kinds the message-selection cursor can land on. Assistant text IS
 *  navigable (the cursor must reach the bottom-most reply — G lands on the
 *  last row, whatever its kind), but its selection visual is the bullet
 *  lighting up, not a full-row background (user feedback: a blue assistant
 *  row reads as an accident, not an affordance). */
const SELECTABLE_KINDS = new Set<ChatRow['kind']>([
  'user',
  'assistant',
  'tool',
  'reasoning',
  'interrupt',
  'local',
  'local-output',
  'compact',
])

/** Shared empty list for mode-gated derived rows (stable reference, so
 *  downstream consumers never see a changing prop when the mode is off). */
const NO_ROWS: readonly ChatRow[] = []

/** `max` → `Max` (effort levels arrive lower-case from the adapter). */
function capitalize(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1)
}

/** Terminal-title spinner frames. */
const TITLE_SPINNER_FRAMES = ['⠂', '⠐']

/** Searchable transcript text for one row (`/` incsearch):
 *  user text, assistant text, thinking, tool args/results, local output). */
function searchableText(row: ChatRow): string {
  switch (row.kind) {
    case 'tool':
      return row.tool
        ? `${row.tool.name} ${row.tool.argsText} ${row.tool.resultText ?? ''} ${row.tool.errorText ?? ''}`
        : ''
    default:
      return row.text
  }
}

/**
 * Main chat screen: a scrollable transcript
 * (with the user message the viewport is showing pinned above the transcript
 * while scrolled up, and a 1-column minimap scrollbar with one node per
 * user message — the current message's node is highlighted, clicking a node
 * jumps to it), transient notifications, the working spinner, the bordered
 * prompt
 * input (with slash-command overlay) and the status line pinned at the
 * bottom.
 *
 * Ctrl+O toggles expanded detail globally; Shift+↑ enters message-selection
 * mode (↑/↓ move, Enter expands the selected row, Esc exits); Ctrl+C
 * interrupts the running turn, or (when idle) asks for a second Ctrl+C to
 * exit; Enter while scrolled up jumps back to the bottom.
 */

/**
 * Shared inert approval store for hosts that render Chat without an
 * approval seam (headless verify scripts). Never parked into, so its
 * snapshot stays null and the approval panel never mounts.
 */
let fallbackApprovalStore: ApprovalStore | undefined

/**
 * Shared inert extension stores for hosts that render Chat without the
 * dsh-tui-extensions row (headless verify scripts, bare embeds). Never
 * written, so plugin dialogs/status contributions never mount and
 * no shortcut ever matches.
 */
let fallbackDialogStore: TuiDialogStore | undefined
let fallbackStatusStore: TuiStatusStore | undefined
/** Standalone mounts (tests, bare embeds) without the composition root's store. */
let fallbackActivityStore: ActivityStore | undefined

/** Identity of one caret-preview dismissal: the token (its title) on the
 *  image, so the same image staged twice is dismissed per token. */
export function Chat({
  channel,
  questionStore,
  approvalStore,
  extensionDialogs,
  extensionStatus,
  activityStore,
  extensionShortcuts,
  themeHost,
  onExit,
  onUpdate,
  onRestart,
  fullscreen = false,
  trajectorySeen: trajectorySeenProp,
  injectControllerRef,
  promptControllerRef: promptControllerRefProp,
  renderScene,
  openHomeOnBoot,
}: {
  channel: Channel
  renderScene?: (id: string, channel: Channel) => React.ReactNode
  questionStore: QuestionStore
  /**
   * The approval seam's UI store. Optional: hosts without an approval
   * channel (headless scripts, older embeds) render Chat without it and
   * simply never see an approval panel — the question panel keeps its seat.
   */
  approvalStore?: ApprovalStore
  /**
   * The managed plugin dialog queue (tuiDialogs service's store). Optional
   * for the same hosts as approvalStore; absent, plugin dialog requests
   * park unanswered (their `timeoutMs` is the plugin's guard).
   */
  extensionDialogs?: TuiDialogStore
  /** Plugin text and bounded rich status contributions. */
  extensionStatus?: TuiStatusStore
  /** Session-scoped activity values published by the working-activity plugin. */
  activityStore?: ActivityStore
  /** Host-only keyboard shortcut dispatch path. */
  extensionShortcuts?: TuiShortcutHost
  /** Optional runtime theme host; static JSON themes work without it. */
  themeHost?: TuiThemeHost
  onExit: () => void
  /** Update the installed package and restart the current TUI process. */
  onUpdate?: () => void
  /** Restart the current TUI process and resume this session (no update). */
  onRestart?: () => void
  /**
   * True when the host already wrapped this tree in `<AlternateScreen>`
   * (`fullscreen: true`). Both full-screen surfaces need this — the trajectory
   * scene and the session browser: entering the alt
   * screen a second time is harmless, but the inner unmount's DEC 1049 exit
   * would drop the whole app back to the main screen.
   */
  fullscreen?: boolean
  /**
   * Whether the trajectory has been opened before on this machine.
   *
   * A prop rather than a filesystem read inside the component: a render
   * initializer touching disk is the wrong layer, and hosts that already know
   * (or tests that need determinism) can simply say. Falls back to the
   * persisted flag when the host does not supply one.
   */
  trajectorySeen?: boolean
  /**
   * External injection controller (dsh-adapter/inject-channel.ts). When the
   * host runs the injection socket, Chat publishes `{ append, submit }` into
   * this ref every render so the adapter-owned socket drives the prompt input
   * without reaching into React state directly. Absent for hosts that do not
   * open the channel (headless scripts, bare embeds).
   */
  injectControllerRef?: React.RefObject<InjectController | null>
  /**
   * Show the workspace home screen as this session's first frame.
   *
   * A prop rather than a filesystem read inside the component: the host knows
   * whether this launch was an ordinary one (no `--resume`, no workspace
   * target) and whether the home screen has already been shown on this
   * installation, and tests need it deterministic.
   */
  openHomeOnBoot?: boolean
  /**
   * The composer's live controller, published every render. Exposed as a prop
   * so a regression can read the draft the composer HOLDS — the ownership
   * question (does a screen swap lose it?) is about state, not about pixels.
   */
  promptControllerRef?: React.RefObject<PromptController | null>
}) {
  const writeRaw = React.useContext(TerminalWriteContext)
  // Re-render whenever the channel mutates; rows/status are read fresh below.
  // DEFAULT lane on purpose (useExternalVersion): the channel version bumps
  // at streaming cadence (every ~16ms via emitStream), and a useSyncExternalStore
  // wakeup would force a SyncLane render per bump — each such sync commit
  // preempting the in-flight Default render and ending with Default work
  // still pending feeds React's nested-update counter until error #185 kills
  // the process (beta.3; the reveal-store half was PR #680, this is the
  // channel half — the surviving source on Windows timer granularity).
  useExternalVersion(channel.subscribe, () => channel.version)
  // Re-render on language switches so the whole UI hot-swaps its strings.
  React.useSyncExternalStore(subscribeLang, getLang)
  const promptEditorOpen = usePromptEditorOpen()
  // The pending ask-user-question (DSH user-interaction seam): the model's
  // `ask_user_question` tool parks here until the panel is answered.
  const questionSnapshot = React.useSyncExternalStore(
    listener => questionStore.subscribe(listener),
    () => questionStore.getSnapshot(),
  )
  // The pending tool-approval ask (DSH approval seam): the permission layer
  // parks here until the panel decides; shown with priority over a pending
  // questionnaire since it gates a tool about to run. Hosts that pass no
  // approvalStore share one inert instance that never holds an ask.
  const approvals = approvalStore ?? (fallbackApprovalStore ??= new ApprovalStore())
  const approvalSnapshot = React.useSyncExternalStore(
    listener => approvals.subscribe(listener),
    () => approvals.getSnapshot(),
  )
  // The pending managed plugin dialog (tuiDialogs seam): a plugin's
  // select/confirm/input request parks here until the panel settles it.
  // Priority sits right below the approval panel (a gated tool outranks a
  // plugin's question) and above the questionnaire. Hosts without the
  // extensions row share one inert store that never holds a dialog.
  const dialogs = extensionDialogs ?? (fallbackDialogStore ??= new TuiDialogStore())
  const dialogSnapshot = React.useSyncExternalStore(
    listener => dialogs.subscribe(listener),
    () => dialogs.getSnapshot(),
  )
  // Plugin status contributions: text keys join into one line; bounded rich
  // views keep their own rows immediately above the prompt.
  const statusContributions = extensionStatus ?? (fallbackStatusStore ??= new TuiStatusStore())
  // The working line: the working-activity plugin's published value for THIS
  // session, read from its session projection. No projection value (plugin
  // absent, or nothing published yet) simply means the classic spinner below.
  const activityValues = activityStore ?? (fallbackActivityStore ??= new ActivityStore())
  const workingActivity = useActivity(activityValues, channel.sessionId)
  const subscribeStatus = React.useCallback(
    (listener: () => void) => statusContributions.subscribe(listener),
    [statusContributions],
  )
  const statusEntries = React.useSyncExternalStore(
    subscribeStatus,
    () => statusContributions.getSnapshot(),
  )
  const statusViews = React.useSyncExternalStore(
    subscribeStatus,
    () => statusContributions.getViewSnapshot(),
  )
  // Shortcut handler failures surface as toasts (the registry also logs
  // them); the hook is re-pointed on every mount so a stale closure never
  // outlives its channel.
  React.useEffect(() => {
    if (extensionShortcuts === undefined) return
    return extensionShortcuts.setErrorHandler(combo => {
      channel.notify(t('ext-shortcut-failed', { combo }), { color: 'error', timeoutMs: 4000 })
    })
  }, [extensionShortcuts, channel])
  // When a questionnaire batch completes, fold a Q&A summary into the
  // transcript (the tool card itself is hidden from the message list).
  const questionOpenRef = React.useRef(questionSnapshot !== null)
  React.useEffect(() => {
    const wasOpen = questionOpenRef.current
    questionOpenRef.current = questionSnapshot !== null
    if (wasOpen && questionSnapshot === null) {
      for (const summary of questionStore.takeSummaries()) {
        channel.pushLocal(summary.title, summary.lines)
      }
    }
  }, [channel, questionSnapshot, questionStore])
  const [expanded, setExpanded] = React.useState(false)
  const [helpOpen, setHelpOpen] = React.useState(false)
  const [handle, setHandle] = React.useState<ScrollBoxHandle | null>(null)
  /** ScrollBox of the open row-detail card (key routing lives in Chat's input chain). */
  const rowDetailScrollRef = React.useRef<ScrollBoxHandle | null>(null)
  /**
   * Conversation timeline snapshot (reported by MessageList): one entry
   * per user turn plus the viewport-derived navigation targets. The
   * ACTIVE turn — the one whose content owns the viewport top row — pins
   * the sticky prompt header AND highlights the transcript rail's tick,
   * from one report so the two can never disagree; upId/downId drive the
   * rail's ▲/▼. Null activeId while pinned to the bottom only when there
   * are no turns (header hidden there anyway).
   */
  const [timeline, setTimeline] = React.useState<TimelineSnapshot>({
    turns: [],
    activeId: null,
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
  /**
   * The transient-dialog layer (every picker/dialog `<OverlayAbove>` hosts,
   * plus /tips) as ONE value: mutual exclusion between the panels is
   * structural instead of emerging from "an open picker makes the prompt
   * inert". Transitions live in the pure reducer (chatOverlay.ts), which
   * scripts/verify-chat-overlay.ts pins without a renderer. Async data the
   * pickers show (model list, preset roster, …) stays in the caches below —
   * it persists across open/close so a reopened picker paints the previous
   * list while the fresh one loads, exactly as the boolean era did.
   */
  const [overlay, dispatchOverlay] = React.useReducer(chatOverlayReducer, NO_OVERLAY)
  // Chat and PromptInput both receive one parsed stdin batch. Keep the
  // permission focus synchronous so arrow+Enter in the same batch uses the
  // post-arrow row rather than the previous render's index.
  const permissionOverlayFocusRef = React.useRef<{ overlay: unknown; index: number } | null>(null)
  React.useEffect(() => {
    if (overlay.kind === 'permission') {
      // Seed each concrete picker instance after commit. Keyboard handlers
      // update this ref synchronously; render must remain side-effect free.
      if (permissionOverlayFocusRef.current?.overlay !== overlay) {
        permissionOverlayFocusRef.current = { overlay, index: overlay.index }
      }
    } else {
      permissionOverlayFocusRef.current = null
    }
  }, [overlay])
  const [models, setModels] = React.useState<readonly LlmModelInfo[]>([])
  /** Provider display identities for the /model group level; refreshed alongside `models`. */
  const [providerInfos, setProviderInfos] = React.useState<readonly LlmProviderInfo[]>([])
  /** /model 最近使用分组：成功切换即记录（去重置顶，上限 10），重启保留。 */
  const [modelRecents, setModelRecents] = React.useState<readonly ModelRecentsRef[]>(() => readModelRecents())
  /** Two-level /model: the drilled-in provider route; undefined = group level.
   *  Reset on open; stale ids resolve back to the group level via `activeModelGroup`. */
  const [modelGroup, setModelGroup] = React.useState<string | undefined>(undefined)
  /** True while the picker sits in the single-provider fast path (drilled in
   *  at open, the group level never shown): Esc closes directly and no back
   *  hint renders — a pinned recents pseudo-group must not fake a two-level
   *  walk the user never saw (issue #527 regression: repro-picker-windowing). */
  const [modelPickerDirect, setModelPickerDirect] = React.useState(false)
  /** Group rows over the current catalog, first-appearance (registry) order,
   *  with the pinned recents pseudo-group first when any entry is catalogued. */
  const modelGroups = React.useMemo(
    () => deriveModelGroups(models, providerInfos, modelRecents),
    [models, providerInfos, modelRecents],
  )
  /** The drilled-in group, but only while it still exists in the catalog. */
  const activeModelGroup = modelGroup !== undefined && modelGroups.some(group => group.provider === modelGroup)
    ? modelGroup
    : undefined
  const groupModels = React.useMemo(() => {
    if (activeModelGroup === undefined) return []
    if (activeModelGroup === RECENTS_GROUP_PROVIDER) return recentCatalogModels(modelRecents, models)
    return models.filter(model => model.provider === activeModelGroup)
  }, [models, modelRecents, activeModelGroup])
  /** Switch + record: every successful switch feeds the /model recents group
   *  (picker Enter/click, `/model provider/id`, the wizard's live switch,
   *  and /reload's applied model all ride this one path). */
  const switchModelRecorded = (provider: string, id: string, name?: string): Promise<boolean> => {
    if (name !== undefined) channel.notify(t('model-switching', { name }))
    return channel.switchModel(provider, id).then((ok) => {
      if (!ok) return ok
      if (name !== undefined) channel.notify(t('model-switched', { name }))
      setModelRecents(recordModelUse({ provider, id }))
      return ok
    })
  }
  /** `/skills` 技能目录（issue #204）：null = 注册表快照在途。 */
  const [skillsList, setSkillsList] = React.useState<readonly SkillInfo[] | null>(null)
  /**
   * The session supervisor — the ONE screen behind `/resume`, `/agentview`,
   * `/home`, `/bg` and the composer's 🏠 button.
   *
   * Those were three screens over one domain (a workspace rail here, a
   * search surface there, a live-status overview somewhere else), which is why
   * each new session feature needed patching into all three and why the
   * three disagreed about what switching a session even does. There is now a
   * single surface and a single runtime behind every entry point: this
   * terminal hosts several sessions, leaving one parks it rather than ending
   * it, and a session another terminal holds is visible but not enterable.
   *
   * Seeded from the host's one-shot landing decision (`openHomeOnBoot`): the
   * first ordinary launch of an installation lands here instead of on a blank
   * conversation, because that is the launch where "which project am I working
   * on" has not been answered yet. Every later launch starts on the chat
   * screen, and the screen stays reachable.
   */
  const [supervisorOpen, setSupervisorOpen] = React.useState(openHomeOnBoot === true)
  /** `/tree` opens the session family tree (pi's Session Tree): every rewind
   *  fork stitched back onto the message it diverged from, hover previews,
   *  and per-node rewind/fork/adopt actions. Like the supervisor, a screen. */
  const [treeOpen, setTreeOpen] = React.useState(false)
  /**
   * The session backgrounded when the screen opened via ←/`/bg` (the "Esc
   *  returns to that conversation" return target), cleared on close.
   */
  const [agentViewReturnId, setAgentViewReturnId] = React.useState<string | undefined>(undefined)
  /** Live agent-view rows: the prompt footer's "← N agents" hint reads the
   *  needs-input count from here (cached snapshot in the channel). The
   *  `?.()` fallbacks keep pre-agent-view test stubs (channel facades in
   *  scripts/*) rendering — the real channel always provides the seams. */
  const EMPTY_AGENT_VIEW_ROWS: readonly never[] = []
  const agentViewRows = React.useSyncExternalStore(
    listener => channel.subscribeAgentView?.(listener) ?? (() => {}),
    () => channel.agentViewRows?.() ?? EMPTY_AGENT_VIEW_ROWS,
  )
  const backgroundAgentsNeedingInput = agentViewRows.filter(
    row => row.status === 'needs-input' && !row.current,
  ).length
  /** Background the attached session and open the supervisor
   *  (`/bg`, `/background`, and ← on an empty prompt all land here). The
   *  backgrounded session becomes the screen's return target (final Esc
   *  attaches back to it). */
  const backgroundToAgentView = React.useCallback((): void => {
    void channel.backgroundCurrent().then((result) => {
      if (result.ok) {
        setAgentViewReturnId(result.backgroundedSessionId)
        agentViewOpenSessionRef.current = channel.agentId
        setSupervisorOpen(true)
      }
    })
  }, [channel])
  /** `/settings` opens the plugin settings screen (issue #165) — like the
   *  browser, a screen rather than a panel: it owns its own focus, staged
   *  drafts and keyboard; Chat only opens it. */
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [workspaceTargets, setWorkspaceTargets] = React.useState<readonly TuiWorkspaceTarget[]>([])
  /** `/preset` agent-preset roster (issue #8): loads async, persists. */
  const [presetOptions, setPresetOptions] = React.useState<readonly PresetOption[]>([])
  /** `/effort` adapter levels: load async before the slider opens. */
  const [effortOptions, setEffortOptions] = React.useState<readonly EffortOption[]>([])
  const [themeName, setTheme] = useTheme()
  const { rows: terminalRows } = useTerminalSize()
  const [showAllMessages, setShowAllMessages] = React.useState(false)
  /** Scope the fold to this question: an aborted ask can promote its queued
   *  successor without ever publishing an idle (null) snapshot. */
  const [minimizedQuestionKey, setMinimizedQuestionKey] = React.useState<string | null>(null)
  const questionMinimized = questionSnapshot !== null && minimizedQuestionKey === questionSnapshot.key
  /** Fold state for the GoalTodoPanel todo section (ctrl/cmd+q or click). */
  const [todoCollapsed, setTodoCollapsed] = React.useState(false)
  const [thinkingVisible, setThinkingVisible] = React.useState(true)
  /** ctrl+r history-search entries (loaded on open, persists). */
  const [historyEntries, setHistoryEntries] = React.useState<readonly HistoryEntry[]>([])
  const {
    btw, setBtw, btwAbortRef, closeBtw,
    recap, setRecap, recapAbortRef, closeRecap,
    balance, setBalance, runBalance,
  } = useSidePanels(channel)
  const [historyFill, setHistoryFill] = React.useState<string | null>(null)
  /**
   * Session switches that do not go through `/new` (agent-view attach,
   * backgrounding, `/resume`) remount the transcript tree without resetting
   * view-local state. Row-id-based UI would keep pointing at rows of the
   * PREVIOUS session (ids restart at 0 after an adopt), so the new session
   * renders with stale folds/expansion/selection — the "entered a freshly
   * dispatched session and it renders wrong" bug. Reset the same set `/new`
   * resets, plus the search overlay and the side question, and repaint the
   * transcript from the top.
   */
  const repaintTranscript = (): void => {
    const ink = instances.get(process.stdout) ?? instances.values().next().value
    // Wait one task so React commits the new session's tree before the
    // scrollback clear repaints (same pattern as `/new`).
    setTimeout(() => {
      handle?.scrollTo(0)
      ink?.clearScrollbackAndRedraw()
    }, 0)
  }
  const lastAgentIdRef = React.useRef<string | undefined>(undefined)
  React.useEffect(() => {
    const id = channel.agentId
    if (lastAgentIdRef.current === undefined) {
      lastAgentIdRef.current = id
      return
    }
    if (lastAgentIdRef.current === id) return
    lastAgentIdRef.current = id
    setExpanded(false)
    setExpandedRows(new Set())
    setSelectedId(null)
    setSelectionActive(false)
    setShowAllMessages(false)
    setLoadedContextOpen(false)
    setSearchQuery('')
    setSearchCursor(0)
    setSearchCount(0)
    setSearchCurrent(0)
    closeBtw()
    repaintTranscript()
  }, [channel.agentId]) // eslint-disable-line react-hooks/exhaustive-deps
  /** The session attached when the agent view opened; a close on a
   *  DIFFERENT session means a switch happened inside the view, and the
   *  transcript repaint cannot be skipped. */
  const agentViewOpenSessionRef = React.useRef<string | undefined>(undefined)
  /**
   * Leaving a whole screen (agent view, browser) remounts the transcript
   * tree, which would replay the ~3.4s whale opening animation on every
   * close — competing with resumed or streaming rows for frame budget.
   * Suppress the intro on those remounts; `/deepseek` re-enables it.
   */
  const suppressLogoIntroRef = React.useRef(false)
  /** Subagent dashboard (Ctrl+A): displays active/completed subagents. */
  const [subagentDashboardOpen, setSubagentDashboardOpen] = React.useState(false)
  const [jobsPanelOpen, setJobsPanelOpen] = React.useState(false)
  // MessageList forwards these open handlers to every memoized row. Their
  // identities must survive token/metrics updates, including for tool rows.
  const openJobsPanel = React.useCallback(() => setJobsPanelOpen(true), [])
  // Stable identity for the StatusLine subagents chip's click target.
  const openSubagentDashboard = React.useCallback(() => setSubagentDashboardOpen(true), [])
  // The strip and the status chips open the unified task center (Ctrl+G).
  const openTaskCenter = React.useCallback(() => setTaskCenterOpen(true), [])
  /** Detail view for a specific subagent (opened from dashboard). */
  const [subagentDetailId, setSubagentDetailId] = React.useState<string | null>(null)
  /** Task center (Ctrl+G): the unified classified panel over jobs +
   * subagents. Legacy Ctrl+A dashboard and /jobs panel stay untouched. */
  const [taskCenterOpen, setTaskCenterOpen] = React.useState(false)
  const [taskCenterDetailId, setTaskCenterDetailId] = React.useState<string | null>(null)
  /** Where the open detail scene was entered from: the panel (Enter on a
   * row) returns to the panel on Esc, the agent strip returns to the main
   * session. */
  const [taskCenterDetailFromPanel, setTaskCenterDetailFromPanel] = React.useState(true)
  /** Continuable child ids from the host catalog: the follow-up composer is
   * offered only on these rows (one-shot children dispose at settlement).
   * Re-read when the child set changes or the channel is replaced. */
  const [subagentContinuableIds, setSubagentContinuableIds] = React.useState<ReadonlySet<string>>(() => new Set())
  // Stub channels (verify harnesses) predate these fields — same defensive
  // optionality as jobControl below.
  const subagentCount = channel.subagents?.length ?? 0
  React.useEffect(() => {
    let alive = true
    void channel.subagentModes?.().then(modes => {
      if (!alive) return
      setSubagentContinuableIds(new Set(Object.entries(modes).filter(([, continuable]) => continuable).map(([id]) => id)))
    }).catch(() => undefined)
    return () => { alive = false }
  }, [channel, subagentCount])
  /** Follow-up delivery (send_message seam) with a delivery toast. */
  const followUpSubagent = React.useCallback(async (agentId: string, text: string): Promise<boolean> => {
    const delivered = await channel.subagentControl?.followUp(agentId, text) === true
    channel.notify(t(delivered ? 'subagent-followup-sent' : 'subagent-followup-failed'), { color: delivered ? 'success' : 'warning', timeoutMs: 3000 })
    return delivered
  }, [channel])
  // Settlement toast: a tracked running child that settles while BOTH
  // subagent surfaces are closed lands on the notification line — the
  // dashboard-open case needs no ping (the card flips in view) and the
  // first frame (incl. resume bootstrap, where historical rows arrive
  // already settled) stays silent.
  const seenSubagentStatusRef = React.useRef<ReadonlyMap<string, string> | null>(null)
  const subagentsSnapshot = channel.subagents ?? []
  const subagentSurfacesOpen = subagentDashboardOpen || subagentDetailId !== null
  React.useEffect(() => {
    const prev = seenSubagentStatusRef.current
    const next = new Map(subagentsSnapshot.map(sub => [sub.agentId, sub.status]))
    seenSubagentStatusRef.current = next
    if (prev === null || subagentSurfacesOpen) return
    for (const sub of subagentsSnapshot) {
      const was = prev.get(sub.agentId)
      if (was !== 'running' && was !== 'starting') continue
      if (sub.status === 'completed') channel.notify(t('subagent-toast-completed', { label: sub.description }), { color: 'success', timeoutMs: 4000 })
      else if (sub.status === 'failed' || sub.status === 'cancelled') channel.notify(t('subagent-toast-failed', { label: sub.description }), { color: 'warning', timeoutMs: 4000 })
    }
  }, [subagentsSnapshot, subagentSurfacesOpen, channel])
  /**
   * Hidden `/deepseek` easter egg: each invocation bumps this key so the
   * logo header remounts and replays the whale spout + text shimmer.
   */
  const [logoNonce, setLogoNonce] = React.useState(0)
  React.useEffect(() => () => btwAbortRef.current?.abort(), [])
  React.useEffect(() => () => recapAbortRef.current?.abort(), [])
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
  /** The startup summary gives way to transcript rows after the first local command or message. */
  const loadedContextVisible = channel.rows.length === 0 && channel.loadedContext !== undefined
  /** Startup context panel: collapsed by default, toggled with Ctrl+P. */
  const [loadedContextOpen, setLoadedContextOpen] = React.useState(false)
  const toggleLoadedContext = React.useCallback(() => {
    setLoadedContextOpen(previous => !previous)
  }, [])
  const renderedLoadedContextOpen = React.useRef(loadedContextOpen)
  React.useLayoutEffect(() => {
    if (renderedLoadedContextOpen.current === loadedContextOpen) return
    renderedLoadedContextOpen.current = loadedContextOpen
    // Reanchor after the new panel geometry commits. Requesting it in the
    // key handler lets a pending paint consume it on the old tall layout,
    // leaving the collapsed summary stranded outside the physical viewport.
    const ink = instances.get(process.stdout) ?? instances.values().next().value
    ink?.invalidatePrevFrame()
    ink?.reanchorViewport()
  }, [loadedContextOpen])

  /**
   * Click-to-act targets: the Ink instance's hyperlink-open callback (wired
   * in the effect below) resolves every clickable target the transcript
   * renders — http(s) links open the browser, `dsh-file:`/`file://` paths
   * open the file-action menu. `dsh-file:` payloads are RAW display paths
   * (possibly relative), so they resolve against the CURRENT channel cwd
   * at click time (read through a ref so this callback keeps a stable
   * identity — it is threaded into memoized row components).
   */
  const cwdRef = React.useRef(channel.cwd)
  React.useEffect(() => {
    cwdRef.current = channel.cwd
  }, [channel.cwd])
  const openFileActions = React.useCallback((rawPath: string): void => {
    const resolved = resolveTargetPath(rawPath, cwdRef.current)
    // Whether the target is a directory decides the first menu row's label
    // ("open file" vs "open folder"). Missing paths count as files.
    let isDir = false
    try {
      isDir = statSync(resolved).isDirectory()
    } catch {
      isDir = false
    }
    dispatchOverlay({ type: 'open', overlay: { kind: 'file-actions', path: resolved, index: 0, isDir } })
  }, [])

  /** Run one file-action menu row: 0 = open file, 1 = reveal in file
   *  manager, 2 = copy absolute path. */
  const runFileAction = React.useCallback((index: number, path: string): void => {
    if (index === 0) openFile(path)
    else if (index === 1) revealInFileManager(path)
    else void setClipboard(path)
  }, [])

  const previewBlocked = questionSnapshot !== null || approvalSnapshot !== null || dialogSnapshot !== null
  React.useEffect(() => {
    if (
      overlay.kind === 'image-preview' &&
      previewBlocked
    ) {
      dispatchOverlay({ type: 'close-if', kind: 'image-preview' })
    }
  }, [overlay.kind, previewBlocked])
  // Caret-driven preview (Grok Build's chip peek): while the composer caret
  // sits on a staged `[Image #N]` — at its start, the token inverted — the
  // same card shows over the transcript, and it goes away when the caret
  // leaves (the cell just after the token is not "on" it). It is
  // derived state, not an overlay: the prompt keeps the keyboard, so ←/→
  // walk from image to image with the card following. Esc (or a click
  // outside the card) dismisses it for THIS token until the caret leaves and
  // comes back; a click on the token always shows it again.

  const handleOpenTarget = React.useCallback((url: string): void => {
    const classification = classifyOpenTarget(url)
    if (classification.kind === 'file-actions') {
      openFileActions(classification.path)
      return
    }
    if (classification.kind === 'external') {
      openExternal(url)
      return
    }
    // Non-http(s) schemes from model/plugin-shaped links are not handed to
    // the OS handler — see urlGuard.ts. Silently ignored: a toast needs
    // channel state the Ink click path does not carry.
  }, [openFileActions])

  // Wire the click-to-open callback into the Ink instance (the field is
  // otherwise never set — clicking links was a no-op). Re-wired whenever
  // the handler changes (cwd moves), cleared on unmount.
  React.useEffect(() => {
    const ink = instances.get(process.stdout) ?? instances.values().next().value
    if (ink) ink.onHyperlinkClick = handleOpenTarget
    return () => {
      const current = instances.get(process.stdout) ?? instances.values().next().value
      if (current) current.onHyperlinkClick = undefined
    }
  }, [handleOpenTarget])
  /** `/` transcript search (less-style incsearch).
   *  Only the bar's open/closed mode lives in `overlay`; the query and match
   *  counters persist past the bar closing so n/N keep walking the matches. */
  const searchActive = overlay.kind === 'search'
  const [searchQuery, setSearchQuery] = React.useState('')
  const [searchCursor, setSearchCursor] = React.useState(0)
  const [searchCount, setSearchCount] = React.useState(0)
  const [searchCurrent, setSearchCurrent] = React.useState(0)
  const searchAnchorRef = React.useRef(0)
  const rowRefsRef = React.useRef(new Map<number, DOMElement>())
  const { setQuery: setHighlight } = useSearchHighlight()

  // Sticky (pinned-to-bottom) scroll state, subscribed imperatively so
  // wheel events don't re-render React — only the header/pill flip.
  // Deliberately KEPT on useSyncExternalStore despite the SyncLane wakeup
  // cost: the renderer's at-bottom re-pin flips sticky WITHOUT firing the
  // scroll subscribers (see ScrollBox's subscribe doc), so only uSES's
  // every-render getSnapshot check picks that flip up — a pure
  // notification-driven subscription misses it and the new-message pill
  // stops reflecting reality (repro-pill). Wheel cadence is an
  // interaction-rate source (not streaming-rate), the streaming-side
  // #185 sources are all Default-lane now, and the overflow guard
  // backstops the residue.
  const isSticky = React.useSyncExternalStore(
    cb => (handle ? handle.subscribe(cb) : () => {}),
    () => (handle ? handle.isSticky() : true),
  )
  // Whale idle gate: the settled header scrolls away with the transcript,
  // and the idle planner is worth nothing the moment its art leaves the
  // viewport — pause it there (timers cleared, the resting pose's cached
  // rows stay painted so scroll geometry never shifts) and re-arm a fresh
  // cycle when the user scrolls back to the top. Same uSES rationale as
  // isSticky above: the renderer's sticky re-pin doesn't fire scroll
  // subscribers, only the every-render snapshot check picks it up.
  const WHALE_ART_CUTOFF_ROWS = 16 // marginTop + the 13-row whale art
  const whaleArtVisible = React.useSyncExternalStore(
    cb => (handle ? handle.subscribe(cb) : () => {}),
    () => {
      if (!handle) return true
      // A transcript that fits the viewport always shows the header.
      if (handle.getScrollHeight() <= handle.getViewportHeight()) return true
      // Visible while the art block intersects the viewport. A sticky bottom
      // pin with an overflow smaller than the art's height still leaves the
      // art on screen — visibility, not pin state, decides whether the idle
      // planner earns its keep.
      return handle.getScrollTop() < WHALE_ART_CUTOFF_ROWS
    },
  )
  const subscribeTooltipInvalidation = React.useCallback(
    (listener: () => void) => (handle ? handle.subscribe(listener) : () => {}),
    [handle],
  )

  // "N new messages" pill: new rows whose top edge is still BELOW the
  // viewport bottom. The count decrements as the user scrolls down through
  // them and hits 0 (pill hides) once every new row has been on screen —
  // no need to wait for the exact-bottom sticky restore. Chat anchors the
  // "seen up to" point by ROW ID (stable across loadOlder prepends, unlike
  // a rows.length index); MessageList owns the row offsets, so it computes
  // how many rows past that anchor lie below the viewport and reports it.
  const lastSeenRowIdRef = React.useRef<number | null>(null)
  const [unseenCount, setUnseenCount] = React.useState(0)
  React.useEffect(() => {
    if (isSticky) {
      lastSeenRowIdRef.current = null
      setUnseenCount(0)
    } else if (lastSeenRowIdRef.current === null) {
      lastSeenRowIdRef.current = channel.rows.length
        ? channel.rows[channel.rows.length - 1]!.id
        : -1
    }
  }, [isSticky, channel.rows])
  // The pill shows whenever the view is off the bottom (one-click return
  // home): with unseen rows it counts them, otherwise it is the plain
  // "return to bottom" affordance (Enter/End/click all land it).
  const showPill = !isSticky

    // Idle Ctrl+C: first press arms an exit, second press exits. Under
    // Windows ConPTY the key
  // arrives as stdin data (key.ctrl && input === 'c') — the useInput
  // branch below is the only path; SIGINT is not emitted.
  const exitPendingRef = React.useRef(false)
  const exitTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  // Live view into the prompt's text for the Ctrl+C rule (clears text when
  // non-empty; the double-press exit only arms on an empty input).
  const ownPromptControllerRef = React.useRef<PromptController | null>(null)
  const promptControllerRef = promptControllerRefProp ?? ownPromptControllerRef
  const {
    openImagePreview, imagePreviewOwned, handleCaretImage,
    peekPreview, dismissPeek, activePreview, setPeekSuppressed, stepPreview,
    previewGallery, previewIndex,
  } = useImagePreview({ channel, overlay, dispatchOverlay, previewBlocked, promptControllerRef })
  /**
   * Owner of the unsent draft. Every screen this component renders INSTEAD of
   * the conversation (the session screen, the tree, settings, the jobs and
   * subagent panels, the trajectory scene) unmounts the composer, and the
   * composer keeps its text in local state — so without this the half-written
   * prompt died on the way in. The slot lives here, outlives that unmount, and
   * is dropped the moment the attached session changes so no draft can follow
   * the user into a different conversation.
   */
  const promptDraftRef = React.useRef<PromptDraftCache>({ current: null })
  /**
   * Latest channel for the unmount release below: that effect must not re-run
   * on a channel identity change, yet its cleanup must release against the
   * channel of the last render.
   */
  const channelRef = React.useRef(channel)
  channelRef.current = channel
  /**
   * Release the staged images a WAITING snapshot alone owns.
   *
   * While a draft waits in the slot for the composer to remount, the snapshot
   * is the only owner of the capabilities behind its `[Image #N]` tokens. If
   * Chat itself goes away first (leaving an early-return screen by exiting the
   * TUI), nothing would ever restore or discard them — the session's
   * 128-entry FIFO would evict live entries instead. The `hasStagedImage`
   * guard keeps a capability the channel already recycled a no-op; both calls
   * are idempotent.
   *
   * Scope, deliberately narrow (review round 7): a capability a QUEUED message
   * still references (`channel.pending`) is never revoked here. The real
   * double-hold path is paste an image → queue the draft with Tab while the
   * model works → recall that line from input history with ↑ (same stageId
   * rebound to the draft) → park the composer. Delivery resolves its refs from
   * the enqueue-time capture, so a late revoke would only bite a host that
   * re-resolves them afterwards — this keeps the rule identical to
   * `stageIdIsRetained` instead of relying on that.
   *
   * A composer that is still MOUNTED when Chat unmounts is NOT covered: React
   * runs this parent cleanup BEFORE the child's, so the child then writes its
   * draft into the now-dead ref and those ids ride the channel's lifetime out
   * (the #942 review's remaining P2). Neither unmount path loses anything
   * user-visible — the channel dies with them.
   */
  React.useEffect(() => {
    return () => {
      const snapshot = promptDraftRef.current.current
      promptDraftRef.current.current = null
      if (snapshot === null) return
      const queued = new Set<string>()
      for (const item of channelRef.current.pending) {
        // `?? []`: a foreign/embedded host may hand us a pending entry without
        // images, and a throw inside an unmount cleanup escapes into the exit
        // path — every other reader of this field guards it the same way.
        for (const image of item.images ?? []) queued.add(image.stageId)
      }
      for (const [, stageId] of snapshot.images) {
        if (queued.has(stageId)) continue
        if (channelRef.current.hasStagedImage?.(stageId) === true) {
          channelRef.current.discardStagedImage(stageId)
        }
      }
    }
  }, [])
  const draftSessionId = channel.agentId
  /** Session the effect below last reconciled against; a change is a switch. */
  const draftSessionRef = React.useRef(draftSessionId)
  /**
   * The session a fill Chat itself requested belongs to, if one is in flight.
   *
   * A rewind's restored message arrives in the same commit that replaces the
   * session, and it belongs to the NEW binding — the user picked it. The
   * composer cannot tell, so Chat says so here, at the two call sites that ask
   * for a fill.
   *
   * Keyed by the session id rather than a bare flag, so it can only ever excuse
   * the switch it was written for. Do NOT clear it when the composer consumes
   * the fill: a child's layout effects run before the parent's, so the fill is
   * consumed in the very commit this effect judges, and clearing it there would
   * wipe the message the user just got back.
   */
  /**
   * Drop the composer's text when the session underneath it is replaced.
   *
   * A LAYOUT effect, not a passive one: the clear has to land in the commit
   * that swaps the session. A passive effect is flushed later, and anything
   * typed in between (the tree's hand-off, a fast user) would be wiped with the
   * old conversation's text. Which DRAFT the slot keeps is a separate question,
   * answered by the snapshot's owner fields.
   */
  React.useLayoutEffect(() => {
    if (draftSessionRef.current === draftSessionId) return
    draftSessionRef.current = draftSessionId
    // A stored draft can only belong to the conversation being replaced: the
    // composer is the one that writes it, and it writes it on the way out.
    promptDraftRef.current.current = null
    if (pendingFillRef.current === draftSessionId) {
      pendingFillRef.current = null
      return
    }
    promptControllerRef.current?.clear()
  }, [draftSessionId])
  // Publish the external-injection controller (dsh.nvim etc.) every render so
  // the adapter-owned socket can append to the prompt and submit. `submit`
  // mirrors an Enter press: `channel.submit` routes through the DSH inbox
  // (queued after the current turn while working), then the input is cleared.
  React.useEffect(() => {
    if (!injectControllerRef) return
    injectControllerRef.current = {
      append: (text: string) => {
        promptControllerRef.current?.append(text)
      },
      submit: () => {
        const controller = promptControllerRef.current
        if (!controller) return
        const text = controller.append('').trim()
        if (text === '') return
        channel.submit(text)
        controller.clear()
        channel.notify(
          channel.working ? t('input-sent-after-turn') : t('input-injected'),
          { timeoutMs: 2500 },
        )
      },
    }
    return () => {
      injectControllerRef.current = null
    }
  })
  const requestExit = () => {
    if (exitPendingRef.current) {
      onExit()
    } else {
      exitPendingRef.current = true
      channel.notify(t('exit-press-again'))
      exitTimerRef.current = setTimeout(() => {
        exitPendingRef.current = false
      }, 3000)
    }
  }
  /**
   * Ctrl+C on a running turn, shared by every focus state (composer,
   * selection mode, overlay cards) so the interrupt is reachable from
   * anywhere — grok keeps this key global the same way. A still-
   * converging cancel (cancelPending) upgrades the next press to the exit
   * funnel: a stuck turn must not swallow every Ctrl+C forever.
   */
  const interruptRunningTurn = () => {
    if (channel.cancelPending) {
      onExit()
    } else {
      channel.cancel()
      // Interrupt replaces any previously armed exit: the next press must
      // re-confirm instead of exiting out from under the turn.
      exitPendingRef.current = false
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
    }
  }
  /**
   * Page size for transcript paging (PgUp/PgDn, Ctrl+F/Ctrl+B in selection
   * mode): one less than the viewport keeps a row of context so a page
   * never reads as a blank jump; a not-yet-measured handle falls back to a
   * fixed page rather than paging by 0 (a dead key).
   */
  const transcriptPageStep = () => {
    const viewport = handle?.getViewportHeight() ?? 0
    return viewport > 1 ? viewport - 1 : 12
  }
  React.useEffect(() => {
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
    }
  }, [])

  // Spinner timing refs, fed from channel state each render (the spinner
  // only mounts while working, so values are stable for the mount).
  const responseLengthRef = React.useRef(0)
  const uploadTokensRef = React.useRef(0)
  const loadingStartTimeRef = React.useRef(0)
  const totalPausedMsRef = React.useRef(0)
  const pauseStartTimeRef = React.useRef<number | null>(null)
  responseLengthRef.current = channel.responseChars
  // Most recent request's real upload (input + cache read/write occupy the
  // wire exactly like the context window); 0 until the first usage event.
  const lastUploadTokens = channel.lastUsage === undefined
    ? 0
    : channel.lastUsage.input + channel.lastUsage.cacheRead + channel.lastUsage.cacheWrite
  uploadTokensRef.current = lastUploadTokens
  loadingStartTimeRef.current = channel.turnStart
  const thinkingStatus = useThinkingStatus(channel.spinnerMode === 'thinking')

  // Terminal tab title: the session
  // title when set, else "dsh-TUI"; a `⠂/⠐` spinner prefix while a turn is
  // working (960ms cadence, only while the terminal is focused), a static
  // `✦` otherwise. dsh-TUI brands the idle prefix with the DeepSeek whale.
  const [titleFrame, setTitleFrame] = React.useState(0)
  const terminalFocused = useTerminalFocus()
  // Mouse text selection auto-copy: active only in
  // fullscreen (<AlternateScreen> supplies mouse tracking); a no-op
  // subscription in inline mode, where selection belongs to the terminal.
  // The copy clears the highlight and posts a transient notification.
  useCopyOnSelect(
    text => channel.notify(t('copied-chars', { n: text.length }), { timeoutMs: 1500 }),
    // Stale-selection refusal: the highlighted rows were replaced in place
    // (streaming overwrite), so nothing was copied — say why instead of
    // letting the highlight vanish silently.
    () => channel.notify(t('copy-refused-stale'), { timeoutMs: 2500 }),
  )
  const { clearSelection: clearMouseSelection, hasSelection: hasMouseSelection } =
    useSelection()
  React.useEffect(() => {
    if (!channel.working || !terminalFocused) return
    const interval = setInterval(() => {
      setTitleFrame(f => (f + 1) % TITLE_SPINNER_FRAMES.length)
    }, 960)
    return () =>{  clearInterval(interval) }
  }, [channel.working, terminalFocused])
  const titlePrefix = channel.working
    ? (TITLE_SPINNER_FRAMES[titleFrame] ?? '✦')
    : '✦'
  useTerminalTitle(
    `${titlePrefix} 🐋 ${channel.sessionTitle}`,
  )
  const {
    handleWorkspaceResult,
    workspaceFlowAbortRef, workspaceFlowRequestRef,
    runWorkspaceFlowAction, workspaceMenuOptions,
    openWorkspaceTarget, openWorkspaceResume, runWorkspaceMenuOption,
  } = useWorkspaceCommands(channel, dispatchOverlay, setWorkspaceTargets)


  /**
   * Dispatch a slash command; false lets the input flow to the model.
   * Built-in names run the local switch; anyth
ing registered by a DSH
   * plugin (plan/goal/…) dispatches through the command registry, whose
   * result text lands as a notification. `rawInput` carries the text after
   * the command name (`/plan off` → ` off`).
   */
  const runExternalCommand = (
    name: string,
    rawInput: string,
    images: readonly ComposerImageRef[] = [],
  ): Promise<boolean> => {
    const originAgentBinding = channel.agentBindingGeneration
    return channel.runExternalCommandOutcome(name, rawInput, images).then((outcome) => {
      if (channel.agentBindingGeneration !== originAgentBinding) return false
      if (outcome === undefined) {
        channel.notify(t('command-not-found', { name }), { color: 'error' })
        return false
      }
      const cleaned = cleanRenderText(outcome.text, COMMAND_RESULT_CELLS)
      if (cleaned !== '') {
        channel.notify(cleaned, outcome.kind === 'error' ? { color: 'error' } : undefined)
      }
      return outcome.consumeDraft
    }).catch((error: unknown) => {
      if (channel.agentBindingGeneration !== originAgentBinding) return false
      const detail = cleanCommandError(error)
      if (detail !== '') channel.notify(detail, { color: 'error' })
      return false
    })
  }

  /** Route every permission switch through the official command path when it
   *  is registered; otherwise fall back to the permission-presets service's
   *  own write path (the same handler the command drives) so the picker and
   *  typed `/permission <preset>` keep working on compositions where the
   *  command row never reaches this agent's registry. The fallback carries no
   *  images: it is not a registry command and has no image grammar. */
  const runPermissionCommand = (
    rawInput: string,
    images: readonly ComposerImageRef[] = [],
  ): Promise<boolean> => {
    const originAgentBinding = channel.agentBindingGeneration
    const mounted = channel.commandList.some(command => command.external && command.name === 'permission')
    const run: Promise<ExternalCommandOutcome | undefined> = mounted
      ? channel.runExternalCommandOutcome('permission', rawInput, images)
      : channel.runPermissionPreset(rawInput.trim()).then(ok =>
        ok ? { kind: 'success' as const, text: '', consumeDraft: true as const } : undefined)
    return run.then((outcome) => {
      if (channel.agentBindingGeneration !== originAgentBinding) return false
      if (outcome === undefined) {
        channel.notify(t('command-not-found', { name: 'permission' }), { color: 'error' })
        return false
      }
      const cleaned = cleanRenderText(outcome.text, COMMAND_RESULT_CELLS)
      if (cleaned !== '') {
        channel.notify(cleaned, outcome.kind === 'error' ? { color: 'error' } : undefined)
      }
      return outcome.consumeDraft
    }).catch((error: unknown) => {
      if (channel.agentBindingGeneration !== originAgentBinding) return false
      const detail = cleanCommandError(error)
      if (detail !== '') channel.notify(detail, { color: 'error' })
      return false
    })
  }

  /** Hot-swap the UI language (`/lang <id>` and the LangPicker both land
   *  here): persist to ~/.dsh-tui/lang.json and mirror into the dsh-tui
   *  settings namespace when it is served (best effort). */
  const applyLang = (lang: Lang): void => {
    const ok = writeLangPref(lang)
    setLang(lang)
    const settingsHost = channel.settingsHost()
    const tuiView = settingsHost?.listNamespaces().find(entry => entry.ns === 'dsh-tui')
    if (settingsHost !== undefined && tuiView !== undefined) {
      void settingsHost
        .write('dsh-tui', [{ op: 'set', path: ['lang'], value: lang }], tuiView.revision)
        .catch(() => {})
    }
    channel.notify(
      ok ? t('lang-switched', { lang }) : t('lang-switch-failed', { lang }),
      { color: ok ? 'success' : 'error' },
    )
  }



  // === Message-selection mode (Shift+↑ message actions) ===
  // NOTE: rows is a live in-place array on the channel (no new reference per
  // update), so derived lists must be computed per render — a useMemo keyed
  // on `channel.rows` would freeze at the first empty snapshot forever.
  // Both lists only feed their respective modes; computing them
  // unconditionally cost an O(rows) scan + array allocation per render
  // (every streamed chunk), so they are gated on the consuming mode.
  const selectableRows = selectionActive
    ? channel.rows.filter(row => SELECTABLE_KINDS.has(row.kind))
    : NO_ROWS

  // ctrl+r history search: substring match on the query, newest first.
  // The draft lives in the overlay variant; the derived '' while closed
  // keeps the memo inputs stable (nothing renders the matches then).
  const historyQuery = overlay.kind === 'history' ? overlay.query : ''
  const historyMatches = React.useMemo(() => {
    const q = historyQuery.trim().toLowerCase()
    return q ? historyEntries.filter(e => e.text.toLowerCase().includes(q)) : historyEntries
  }, [historyEntries, historyQuery])

  // Double-Esc rewind: the user's own messages, newest first (the list shows
  // selectable user turns; steering side-questions are excluded). Computed
  // per render while the picker is open — `channel.rows` is a live in-place
  // array (see selectableRows).
  const rewindRows = overlay.kind === 'rewind'
    ? channel.rows
      .filter(row => row.kind === 'user' && row.label === undefined)
      .reverse()
    : NO_ROWS

  const {
    trajectory, terminalColumns, markFailuresSeen, pageInsetX, wakeBand, wakeTickRef, wakeTime,
    trajectorySeen, setTrajectorySeen, unreadFailures, failureHintRowId,
  } = useTrajectory(channel, trajectorySeenProp)
  const rewindRequestRef = React.useRef(0)
  const pendingFillRef = React.useRef<string | null>(null)
  const { openRewind, requestRewindConfirm, performRewind } = createRewindCommands({
    channel, dispatchOverlay, rewindRequestRef, pendingFillRef, setHistoryFill,
  })
  const { forceMountRowId, seekRow, seekRowIntoView, revealAndSeekRow } = useSeek(handle, rowRefsRef, showAllMessages, setShowAllMessages)
  const runCommand = createRunCommand({
    channel, t, dispatchOverlay, handle, expanded, models,
    applyLang, backgroundToAgentView, btwAbortRef, handleWorkspaceResult, questionStore,
    openScene, openWorkspaceResume, openWorkspaceTarget, promptControllerRef,
    runBalance, runExternalCommand,
    setBtw, setExpanded, setExpandedRows, setHelpOpen, setHistoryFill,
    setJobsPanelOpen, setLoadedContextOpen, setModelGroup, setModelPickerDirect,
    setRecap, setSelectedId, setSelectionActive, setSettingsOpen,
    setShowAllMessages, setSkillsList, setStreamViewToggledRows,
    setSupervisorOpen, setTheme, setTreeOpen, switchModelRecorded,
    themeName, themeHost, thinkingVisible,
    onUpdate, onRestart, onExit,
    modelRecents, setModelRecents, setModels, setProviderInfos,
    setPresetOptions, setEffortOptions, presetOptions,
    setLogoNonce, suppressLogoIntroRef, recapAbortRef, agentViewOpenSessionRef,
    runPermissionCommand, openRewind,
  })



  // `/` transcript search: rows whose searchable text contains the query.
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

  /**
   * Leave selection mode and hand the keyboard back to the composer —
   * the Tab/Esc key path and the input cluster's click-to-refocus share it.
   * selectedId survives the exit (with a transcript snapshot): a Tab-out /
   * Tab-back-in with no new rows restores the cursor where it was; only a
   * submit (rows changed) makes the next entry follow the fresh bottom.
   */
  const selectionEpochRef = React.useRef<{ maxId: number; count: number } | null>(null)
  const exitSelection = () => {
    selectionEpochRef.current = {
      maxId: channel.rows.reduce((max, row) => Math.max(max, row.id), 0),
      count: channel.rows.length,
    }
    setSelectionActive(false)
  }
  const enterSelection = () => {
    // selectableRows is selectionActive-gated and still NO_ROWS on this
    // turn (setSelectionActive has not committed) — seed or restore the
    // cursor from channel.rows directly or every later move no-ops on a
    // null id. Restore logic lives in selection-mode.ts (pure).
    setSelectionActive(true)
    const targetId = selectionRestoreTarget(
      channel.rows,
      selectionEpochRef.current,
      selectedId,
      row => SELECTABLE_KINDS.has(row.kind),
    )
    if (targetId !== null) {
      setSelectedId(targetId)
      // Minimal alignment: a restored on-screen row leaves the viewport
      // exactly where the user left it (no jump to the bottom).
      seekRowIntoView(targetId)
    } else {
      setSelectedId(null)
    }
  }
  const moveSelection = (delta: 1 | -1) => {
    // Minimal alignment (grok-style browsing): a step inside the
    // viewport moves only the cursor; the page starts scrolling when
    // the cursor reaches the edge, one row per step (force-mounting
    // folded window rows through the same path as history search).
    const nextId = selectionStepId(selectableRows, selectedId, delta)
    if (nextId !== null) {
      setSelectedId(nextId)
      seekRowIntoView(nextId)
    }
  }
  // useCallback: these feed MessageList → MemoRow's shallow compare; fresh
  // closures each render would defeat every row's memo.
  /** Global transcript-mode toggle (default Ctrl+O). The mode OWNS row fold
   *  states: collapsing clears per-row toggles so the transcript reads one
   *  way instead of a mix of global and row-local expansion. */
  const toggleTranscriptMode = () => {
    const next = !expanded
    setExpanded(next)
    if (!next) setExpandedRows(new Set())
    // The toggle rewrites every thinking row's layout at once. The
    // ordinary scroll-based diff pushes rows into terminal scrollback on
    // each expand and nothing removes them on collapse — rapid toggling
    // drifts the virtual↔scrollback mapping until writes misland
    // (garbled transcript, duplicated rows). Re-anchor the next frame:
    // in-place viewport repaint, nothing added to scrollback. Lookup
    // falls back to the only live instance for embedders whose stdout
    // isn't process.stdout (test harnesses).
    const ink = instances.get(process.stdout) ?? instances.values().next().value
    ink?.reanchorViewport()
  }
  const toggleRowExpanded = React.useCallback((rowId: number) => {
    setExpandedRows((previous) => {
      const next = new Set(previous)
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return next
    })
  }, [])
  const toggleStreamView = React.useCallback((rowId: number) => {
    setStreamViewToggledRows((previous) => {
      const next = new Set(previous)
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return next
    })
  }, [])
  const registerRowRef = React.useCallback((rowId: number, el: DOMElement | null) => {
    if (el) rowRefsRef.current.set(rowId, el)
    else rowRefsRef.current.delete(rowId)
  }, [])
  /** Deduplicate terminals that report one Enter as parsed Return then raw CR/LF. */
  const lastModalEnterAtRef = React.useRef(0)

  // ── Overlay keyboard routing ─────────────────────────────────────────
  // Table-driven dispatch (src/screens/chat/overlay-keys.tsx): per-kind
  // handler bodies are the old inline useInput branches verbatim; deps are
  // passed fresh each render so the closures see current state exactly as
  // the inline branches did.
  const overlayKeyHandlers = createOverlayKeyHandlers({
    overlay, dispatchOverlay, channel, handle,
    searchAnchorRef, searchQuery, searchCount, searchCursor,
    setHighlight, setSearchQuery, setSearchCursor,
    setThinkingVisible, interruptRunningTurn, rowDetailScrollRef,
    workspaceFlowAbortRef, workspaceFlowRequestRef, runWorkspaceFlowAction,
    workspaceTargets, workspaceMenuOptions, runWorkspaceMenuOption,
    activeModelGroup, modelGroups, groupModels, setModelGroup, models,
    switchModelRecorded, modelPickerDirect,
    skillsList, setHistoryFill, effortOptions, presetOptions,
    permissionOverlayFocusRef, runPermissionCommand,
    runExternalCommand, applyLang, themeHost, setTheme,
    historyMatches, rewindRequestRef, performRewind, rewindRows,
    requestRewindConfirm, runFileAction,
  })
  const runOverlayKeys = (kind: ChatOverlay['kind'], input: string, key: Key, plainReturn: boolean, event: { stopImmediatePropagation(): void }): boolean => {
    if (overlay.kind !== kind) return false
    const handler = overlayKeyHandlers[kind]
    if (handler === undefined) return false
    handler(input, key, plainReturn, event)
    return true
  }

  useInput((input, key, event) => {
    // Prompt-slot panels own the keyboard while visible. Their own useInput
    // handles the relevant keys; Chat registered first, so yielding here
    // still lets the panel receive them. PromptInput now stays mounted but
    // suspended to preserve async command drafts, making this guard also
    // essential for Ctrl+C: it must never clear the hidden composer.
    if (
      btw !== null
      || overlay.kind === 'tips'
      || (recap !== null && (!recap.auto || recap.expanded))
    ) return
    // The session tree owns the whole terminal while it is up: plain letters
    // drive its search, clicks and Enter drive its action menu.
    if (treeOpen) return
    // The session supervisor owns the whole terminal while it is up: its rail
    // and session list bind ↑/↓/Enter/Tab/Esc, its filter box takes the plain
    // letters that would otherwise reach the prompt, and the directory picker
    // and menus it opens are its own modal layers.
    if (supervisorOpen) return
    // Same for the settings screen: plain letters (s save / d discard) and
    // the field draft editor belong to it alone.
    if (settingsOpen) return
    // Subagent dashboard or detail scene: it owns the keyboard while open.
    if (subagentDashboardOpen || subagentDetailId !== null) return
    // The `/jobs` panel replaces the conversation too, so it owns Esc (close)
    // and k (kill) while open. Unguarded, Esc meant to CLOSE the panel also
    // reached the chat:cancel branch below whenever a turn was in flight —
    // dismissing the panel and killing the turn with one key.
    if (jobsPanelOpen) return
    // A plugin scene (dsh-tui-scenes) or the trajectory scene owns the whole
    // screen while open: every key belongs to it. Unguarded, an Esc meant to
    // CLOSE the scene also reached the chat:cancel branch below whenever a
    // turn was in flight — closing the view and killing the turn in one key.
    if (sceneOpen || channel.pluginScene !== undefined) return
    // Mouse wheel scrolls the transcript even while a question/approval/
    // dialog panel is open — those panels own arrow/Enter/Esc keys, but the
    // transcript above them should still be scrollable in fullscreen mode.
    //
    // Wheel routing is position-first: events landing over a ScrollBox
    // (transcript, help, subagent panels…) are consumed by that box in
    // App's input batch (onWheelAt) and never reach this branch. What
    // arrives here is the fallback: wheel over non-scroll areas (prompt,
    // status bar) or over floating overlays.
    //   - Help stays yielded: PromptInput's help ScrollBox handles the
    //     remaining global wheel while help is open (both covered layers
    //     must not move).
    //   - Pickers/dialogs are modal: wheel that fell through over them
    //     must NOT scroll the transcript behind (the audit's
    //     pass-through gap), so yield like the keyboard guards above.
    // Events only arrive with mouse tracking on; inline mode never sees
    // them, so this is a no-op there.
    if (key.wheelUp || key.wheelDown) {
      if (helpOpen) return
      // Any open transient dialog is modal to the wheel; the one exception
      // mirrors the render gate — a workspace picker whose target list has
      // not landed paints nothing, so wheel-through keeps scrolling.
      const overlayModal =
        overlay.kind !== 'none' &&
        (overlay.kind !== 'workspace-picker' || workspaceTargets.length > 0)
      if (overlayModal) return
      handle?.scrollBy(key.wheelUp ? -3 : 3)
      event.stopImmediatePropagation()
      return
    }
    // PgUp/PgDn page the transcript a full viewport at a time — the keyboard
    // counterpart of the wheel branch above. Without it, a fullscreen session
    // has no keyboard route to scrollback at all: the alt screen holds no
    // native scrollback (see MessageList's historyPaint gate), so a mouse-less
    // user cannot reach an earlier turn.
    //
    // Fullscreen only, on purpose. Inline mode paints committed history onto
    // the main screen, so the terminal's OWN scrollback owns these keys there;
    // claiming them would break paging that already works, exactly like the
    // wheel branch above is a no-op inline.
    //
    // Routing mirrors the wheel branch: help stays yielded (PromptInput pages
    // its help viewport with the same keys) and open pickers/dialogs are modal,
    // so the transcript behind them must not move. Every guard above (session
    // tree, settings, scenes, dashboards) already claimed the keyboard — those
    // surfaces page their own lists with these keys.
    //
    // The question/approval/dialog panels deliberately do NOT yield: like the
    // wheel branch above (whose comment spells this out), those panels mount
    // BELOW the transcript — replacing the prompt, not covering it — so the
    // transcript above them stays visible and scrollable while a decision is
    // pending. The panels bind ↑/↓/Space/Tab/Enter/Esc and never these keys,
    // so paging cannot steal anything from them.
    if ((key.pageUp || key.pageDown) && fullscreen) {
      if (helpOpen) return
      const overlayModal =
        overlay.kind !== 'none' &&
        (overlay.kind !== 'workspace-picker' || workspaceTargets.length > 0)
      if (overlayModal) return
      // One less than the viewport keeps a row of context so a page never
      // reads as a blank jump; a not-yet-measured handle falls back to a
      // fixed page rather than paging by 0 (a dead key). The final page
      // overshoots and the renderer clamps it exactly onto maxScroll, whose
      // positional at-bottom restore re-pins sticky (the #421/#422 wheel
      // contract) — so paging back home clears the new-messages pill too.
      handle?.scrollBy((key.pageUp ? -1 : 1) * transcriptPageStep())
      event.stopImmediatePropagation()
      return
    }
    // Help is modal over Chat. Chat's listener registers before PromptInput's,
    // so yield every remaining key before any global/custom shortcut, search,
    // selection, or working-turn cancellation branch can mutate hidden state.
    // PromptInput then owns Esc, navigation, Tab guards, and ordinary typing.
    if (helpOpen) return
    // The questionnaire / approval panel / managed plugin dialog owns the
    // keyboard while one is pending (the panel's own useInput handles
    // ↑/↓/Space/Tab/Enter/Esc; the prompt input is suspended, so nothing
    // else should see these keys).
    if (approvalSnapshot !== null || dialogSnapshot !== null) return
    if (questionSnapshot !== null) {
      // Only transcript navigation belongs here. The mounted questionnaire
      // owns fold/expand keys, including when it interrupts another screen.
      if (questionMinimized && !isSticky && (isPlainReturnInput(input, key) || key.end)) {
        handle?.scrollToBottom()
        event.stopImmediatePropagation()
      }
      return
    }
    const returnCandidate = isPlainReturnInput(input, key)
    const returnNow = Date.now()
    const plainReturn = returnCandidate && returnNow - lastModalEnterAtRef.current >= 80
    if (plainReturn) lastModalEnterAtRef.current = returnNow
    if (runOverlayKeys('image-preview', input, key, plainReturn, event)) return
    if (runOverlayKeys('row-detail', input, key, plainReturn, event)) return
    if (peekPreview !== null && key.escape) {
      // Caret-driven preview: Esc dismisses it until the caret leaves the
      // token (PromptInput's own Esc arm normally gets there first; this is
      // the fallback when the prompt is not listening). Every other key
      // stays with the prompt, so the caret keeps moving (and the card
      // follows it) while the preview is up.
      dismissPeek()
      event.stopImmediatePropagation()
      return
    }
    // Esc clears a settled mouse selection before the ordinary chat meanings
    // below, but never before a top-level modal. Otherwise a preview opened
    // over selected transcript text needed two Esc presses to close.
    // hasSelection() is an imperative read — no subscription needed.
    if (key.escape && hasMouseSelection()) {
      clearMouseSelection()
      event.stopImmediatePropagation()
      return
    }
    if (runOverlayKeys('search', input, key, plainReturn, event)) return
    // After Enter closed the search bar, n/N keep walking the matches
    // The query persists across bar open/close so n/N keep working.
    // Transcript mode only — in prompt mode n/N are ordinary input chars.
    if (expanded && input === 'n' && searchQuery && searchCount > 0 && !key.ctrl && !key.meta && !key.super) {
      setSearchCurrent(i => (i >= searchCount - 1 ? 0 : i + 1))
      event.stopImmediatePropagation()
      return
    }
    if (expanded && input === 'N' && searchQuery && searchCount > 0 && !key.ctrl && !key.meta && !key.super) {
      setSearchCurrent(i => (i <= 0 ? searchCount - 1 : i - 1))
      event.stopImmediatePropagation()
      return
    }
    if (overlay.kind !== 'none' && overlayKeyHandlers[overlay.kind] !== undefined) {
      overlayKeyHandlers[overlay.kind]!(input, key, plainReturn, event)
      return
    }
    if (actionMatches('trajectory', input, key)) {
      // The trajectory scene key (default Ctrl+T) opens it at any point in
      // the session.
      openScene()
      return
    }
    if (actionMatches('dashboard', input, key)) {
      // The subagent dashboard key (default Ctrl+A) opens the dashboard.
      // Consume the key: without the stop the prompt editor's readline
      // binding ALSO fires (Ctrl+A moves the caret to line start), so one
      // press both opens the overlay and jumps the cursor.
      setSubagentDashboardOpen(true)
      event.stopImmediatePropagation()
      return
    }
    if (actionMatches('taskCenter', input, key)) {
      // The task center key (default Ctrl+G) opens the unified classified
      // panel (jobs + subagents). Same consume rule as the dashboard key:
      // Ctrl+G is also a readline binding (abort line) without the stop.
      setTaskCenterOpen(true)
      event.stopImmediatePropagation()
      return
    }
    if (actionMatches('contextPanel', input, key) && loadedContextVisible) {
      // The loaded-context panel key (default Ctrl+P) toggles the startup
      // panel while it is on screen (transcript still empty); once rows take
      // over and the panel disappears the key has nothing left to do.
      toggleLoadedContext()
      return
    }
    if (actionMatches('history', input, key) && !helpOpen) {
      setHistoryEntries(loadHistory())
      dispatchOverlay({
        type: 'open',
        overlay: { kind: 'history', query: '', cursor: 0, focus: 0 },
      })
      return
    }
    if (key.shift && key.upArrow && !selectionActive && !helpOpen) {
      enterSelection()
    } else if (selectionActive) {
      // Pure key→intent mapping in chat/selection-mode.ts; effects stay
      // here (setters, seeks, overlays). stopImmediatePropagation stays
      // exactly where the old inline branches had it.
      const selectedRow = selectedId !== null ? selectableRows.find(row => row.id === selectedId) : undefined
      const intent = selectionKeyIntent(input, key, {
        working: channel.working,
        helpOpen,
        plainReturn,
        selectedId,
        selectedKind: selectedRow?.kind,
        expanded,
        expandedRows,
      })
      switch (intent.type) {
        case 'interrupt-or-exit': {
          // Ctrl+C keeps its global interrupt meaning inside selection
          // mode (grok's "Cancel turn" works from the transcript too);
          // idle, the key just leaves the mode. The hidden composer
          // draft is never cleared from selection mode.
          if (channel.working) interruptRunningTurn()
          else exitSelection()
          event.stopImmediatePropagation()
          break
        }
        case 'page': {
          // Ctrl+F / Ctrl+B: vim paging over the transcript, same page
          // size as the global PgUp/PgDn keys. The cursor row stays put;
          // the next j/k pulls it back into view.
          handle?.scrollBy(intent.delta * transcriptPageStep())
          event.stopImmediatePropagation()
          break
        }
        case 'toggle-transcript-mode':
          toggleTranscriptMode()
          break
        case 'move':
          moveSelection(intent.delta)
          break
        case 'expand':
          // l expands (vim right = open): head pinned to the viewport top
          // so the revealed body reads top-down. The expand/collapse gate
          // lives in the pure intent (fold-bearing kinds only).
          if (selectedId !== null) {
            toggleRowExpanded(selectedId)
            seekRow(selectedId)
          }
          break
        case 'collapse':
          // h collapses (vim left = close). No seek: the shrink leaves
          // the cursor row where it is.
          if (selectedId !== null) toggleRowExpanded(selectedId)
          break
        case 'jump-top': {
          // g / gg → first selectable row. In a long session the first
          // row sits behind the recent-rows fold — the reveal opens it
          // so forceMount can actually mount the row.
          const first = selectableRows[0]
          if (first) {
            setSelectedId(first.id)
            revealAndSeekRow(first.id, 'nearest')
          }
          break
        }
        case 'jump-bottom': {
          // G → last selectable row AND the live tail: scrollToBottom
          // both bottom-aligns the row and re-pins sticky ("jump to the
          // end" means "follow the tail again" — grok semantics).
          const last = selectableRows[selectableRows.length - 1]
          if (last) {
            setSelectedId(last.id)
            handle?.scrollToBottom()
          }
          break
        }
        case 'open-detail':
          // Enter opens the full-content viewer ("Enter details"); the
          // viewport can never hold a 500-line output.
          if (selectedId !== null) dispatchOverlay({ type: 'open', overlay: { kind: 'row-detail', rowId: selectedId } })
          break
        case 'exit':
          // Tab mirrors grok's focus rotation; Esc exits the same way.
          exitSelection()
          break
        case 'none':
          break
      }
    } else if (key.escape && channel.working && !helpOpen && !promptControllerRef.current?.vimActive()) {
      // Esc interrupts a running turn (the prompt input
      // only sees esc when idle, where it has the double-tap-clear meaning).
      // With messages queued for delivery, interrupt-and-deliver them right
      // away (Codex behavior); otherwise a plain interrupt parks the queue.
      // vim mode (either submode) yields: there Esc is a MODE key (INSERT→
      // NORMAL, NORMAL = no-op/cancel pending d) and the prompt owns it;
      // interrupting still works via Ctrl+C / Ctrl+Enter.
      if (channel.pending.length > 0) {
        const count = channel.interruptAndDeliver(channel.pending.map(item => ({
          text: item.text,
          images: item.images ?? [],
        })))
        if (count > 0) {
          channel.notify(t('interrupt-delivered', { n: count }), { timeoutMs: 2500 })
        }
      } else {
        channel.cancel()
      }
      event.stopImmediatePropagation()
    } else if (actionMatches('transcript', input, key) && !helpOpen) {
      // Leaving transcript mode (default Ctrl+O) — search was already
      // handled above. Help is modal: toggling this state behind the
      // overlay is invisible, then the next `/` unexpectedly opens
      // transcript search instead of slash-command completion after Help
      // closes.
      toggleTranscriptMode()
    } else if (input === '/' && !key.ctrl && !key.meta && !key.super && !helpOpen) {
      // `/` in transcript mode (Ctrl+O expanded):
      // search is active on the transcript screen where `/` isn't a command).
      if (expanded) {
        searchAnchorRef.current = handle?.getScrollTop() ?? 0
        setSearchQuery('')
        setSearchCursor(0)
        setSearchCurrent(0)
        setSearchCount(0)
        dispatchOverlay({ type: 'open', overlay: { kind: 'search' } })
        event.stopImmediatePropagation()
      }
    } else if (key.ctrl && (input === 'c' || input === 'd')) {
      // Ctrl+C interrupts a running turn; idle Ctrl+C
      // CLEARS a non-empty prompt (single press) and only arms the
      // double-press exit when the input is empty; ctrl+d keeps the
      // time-based double-press exit regardless.
      if (channel.working) {
        interruptRunningTurn()
      } else if (input === 'c' && promptControllerRef.current?.consumeSelectionCopy()) {
        // A mouse selection is active: Ctrl+C copies it to the clipboard
        // (via the prompt controller — Chat's listener registers first) and
        // KEEPS the selection for further editing. The key is consumed.
        exitPendingRef.current = false
        if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
      } else if (input === 'c' && promptControllerRef.current?.hasText()) {
        promptControllerRef.current.clear()
        // A pending exit arm no longer makes sense once the user is editing.
        exitPendingRef.current = false
        if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
      } else {
        requestExit()
      }
    } else if (actionMatches('redraw', input, key)) {
      // Redraw (default Ctrl+L) — clear the physical terminal and
      // repaint.
      instances.get(process.stdout)?.forceRedraw()
      // Consume: same readline-shadowing rule as dashboard/showAll below.
      event.stopImmediatePropagation()
    } else if (actionMatches('showAll', input, key)) {
      setShowAllMessages(previous => !previous)
      // Ctrl+E is also the editor's line-end binding — stop the press from
      // additionally moving the caret (one press, one meaning).
      event.stopImmediatePropagation()
    } else if (actionMatches('todoFold', input, key)) {
      // Fold/unfold the GoalTodoPanel todo section (default Ctrl+Q) — works
      // mid-turn too: the collapsed line keeps the done/total count and the
      // live task preview, so long todo lists stop crowding the prompt.
      setTodoCollapsed(previous => !previous)
      // Consume: same readline-shadowing rule as dashboard/showAll above.
      event.stopImmediatePropagation()
    } else if (plainReturn && !isSticky) {
      // Enter while scrolled up returns to the bottom: the
      // affordance now exists whenever the view is off the bottom, not
      // only with unseen rows).
      handle?.scrollToBottom()
    } else if (key.end && !isSticky) {
      // End = jump to bottom, less/vim semantics (G stays selection-mode
      // only: the composer is focused while browsing, and a printable
      // binding here would eat every capital G the user types). Global on
      // the chat screen (search/history overlays consume their own End
      // first — cursor-to-line-end there). At the bottom already: no-op,
      // so the key stays harmless in muscle memory.
      handle?.scrollToBottom()
      event.stopImmediatePropagation()
    } else if (extensionShortcuts !== undefined && extensionShortcuts.dispatch(input, key)) {
      // Plugin shortcut (tuiShortcuts seam): matched only after every
      // built-in global binding above declined — locals always win, and the
      // registry additionally refuses the prompt editor's own combos at
      // registration, so a plugin can never shadow anything. The handler
      // runs fire-and-forget; its errors arrive via the onError hook
      // (wired to the toast below).
      event.stopImmediatePropagation()
    }
  })

  // Working-activity line (spinner slot): context-pressure prefix shares the
  // StatusLine thresholds (amber ≥ 80, red ≥ 95).
  const activityWarnPct = contextPressurePct(channel.lastUsage, channel.contextWindow)

  // ── Interrupt lane ─────────────────────────────────────────────────────
  // The approval and ask_user_question panels park the agent until the user
  // answers, but they render inside the conversation layout — every screen
  // early-return below (plugin scene, browser, settings, subagent, trace)
  // used to win over them, leaving the session stuck with no visible cause.
  // While one is pending and a screen is up, the panel takes the whole
  // terminal INSTEAD of the screen. The screen's open flag survives, so the
  // decision lands back on the screen (remounted fresh — the same lifecycle
  // as closing and reopening it); keyboard exclusivity holds because the
  // covered screen is unmounted, exactly like the chat-state prompt slot.
  // The panel elements are shared with the prompt-slot chain below so the
  // two mount sites cannot drift.
  const approvalPanelNode = approvalSnapshot !== null ? (
    <ApprovalPanel
      key={approvalSnapshot.key}
      approval={approvalSnapshot}
      background={approvalSnapshot.agentId !== channel.agentId}
      onDecide={outcome => approvals.decide(outcome)}
    />
  ) : null
  const questionPanelNode = questionSnapshot !== null ? (
    <AskUserQuestionPanel
      key={questionSnapshot.key}
      question={questionSnapshot.question}
      position={questionSnapshot.position}
      total={questionSnapshot.total}
      answered={questionSnapshot.answered}
      initialDraft={questionSnapshot.draft}
      onAnswer={selection => questionStore.answerCurrent(selection)}
      onCancel={() => questionStore.cancelCurrent()}
      onBack={questionSnapshot.canGoBack
        ? draft => questionStore.backCurrent(draft)
        : undefined}
      collapsed={questionMinimized}
      onExpand={() => setMinimizedQuestionKey(null)}
      onToggleFold={() => setMinimizedQuestionKey(previous =>
        previous === questionSnapshot.key ? null : questionSnapshot.key)}
      fullscreen={fullscreen}
    />
  ) : null
  const interruptPanel = approvalPanelNode ?? questionPanelNode
  const screenOpen = channel.pluginScene !== undefined || supervisorOpen || settingsOpen
    || subagentDetailId !== null || subagentDashboardOpen || sceneOpen
  if (interruptPanel !== null && screenOpen) {
    const node = (
      <Box flexDirection="column" width="100%" paddingX={1}>
        {interruptPanel}
      </Box>
    )
    return fullscreen ? node : <AlternateScreen>{node}</AlternateScreen>
  }

  // A plugin scene (dsh-tui-scenes) takes the whole terminal the same way
  // the trajectory scene does, and sits at the TOP of this return chain:
  // an open() landing while the session browser or the trajectory scene is
  // up must still take the screen (and the keyboard, via the useInput guard
  // above), not queue silently behind them. Closing the plugin scene lands
  // back on whatever screen was up before, so these early returns read as a
  // stack. The component comes from the registry, so its identity is stable
  // across renders and its hook state survives re-renders; it receives the
  // TUI's own React + ui kit because a plugin importing its own React copy
  // would die on the first hook call under this reconciler.
  // The scene is third-party code, so it renders inside a boundary: a render
  // crash reports to the transcript and closes the scene instead of taking
  // the whole TUI down through ink's app-level boundary.
  const pluginScene = channel.pluginScene
  if (pluginScene !== undefined) {
    const node = (
      <PluginSceneBoundary
        id={pluginScene.id}
        onError={(id, error) => {
          channel.notify(t('plugin-scene-crashed', { id, err: error.message }), { color: 'error' })
          channel.closePluginScene()
        }}
      >
        {renderScene ? renderScene(pluginScene.id, channel) : <Text>Scene unavailable: {pluginScene.id}</Text>}
      </PluginSceneBoundary>
    )
    return fullscreen ? node : <AlternateScreen>{node}</AlternateScreen>
  }

  /**
   * The session supervisor: a screen in the same sense as the tree — an early
   * return after every hook above has run, so there is no transcript
   * underneath to repaint or bled through.
   *
   * It sits ABOVE the session tree because it is the surface a launch can
   * start on (`openHomeOnBoot`): a first launch has no conversation to come
   * back to, and every action it offers either mounts a session (which closes
   * it) or starts a new one.
   *
   * Behind it, every session this terminal hosts keeps running — that is the
   * runtime the screen describes, not an implementation detail of it. A turn
   * that was in flight when the user opened this screen is still in flight
   * while they read the list, which is why closing the screen only repaints
   * the transcript when the attached session actually changed.
   */
  if (supervisorOpen) {
    /**
     * Live state per session, from the channel's own agent-view projection.
     * Reading the projection rather than a parallel source is what keeps this
     * screen and the attention hints in the composer footer from disagreeing
     * about which session is waiting for input.
     */
    const agentRowOf = (sessionId: string) => agentViewRows.find(row => row.id === sessionId)
    const supervisorNode = (
      <SessionSupervisor
        channel={channel}
        home={homeDir()}
        onClose={closeHome}
        onToggleTranscript={toggleTranscriptMode}
        approval={approvalSnapshot}
        onApprove={outcome => approvals.decide(outcome)}
        onOpenSession={async (sessionId) => {
          const result = await channel.resumeTo(sessionId)
          if (!result.ok) {
            const text = resumeFailureText(result)
            if (text !== undefined) channel.notify(text, { color: 'error', timeoutMs: 8000 })
            return false
          }
          channel.notify(t('resume-resumed'))
          suppressLogoIntroRef.current = true
          setAgentViewReturnId(undefined)
          setSupervisorOpen(false)
          repaintTranscript()
          return true
        }}
        onNewSession={async (target) => {
          const ok = await channel.switchWorkspace(target)
          if (ok) {
            suppressLogoIntroRef.current = true
            setAgentViewReturnId(undefined)
            setSupervisorOpen(false)
            repaintTranscript()
          }
          return ok
        }}
        onStopSession={async (sessionId) => channel.stopBackgroundAgent?.(sessionId) ?? false}
        liveStateOf={(sessionId) => {
          const row = agentRowOf(sessionId)
          return row === undefined
            ? undefined
            : { status: row.status, live: row.live, current: row.current, summary: row.summary }
        }}
      />
    )
    // Inline hosts enter the alternate screen for the duration; full-screen
    // hosts are already in it and must not nest a second one.
    return fullscreen ? supervisorNode : <AlternateScreen>{supervisorNode}</AlternateScreen>
  }

  // The session tree follows the browser's rule exactly: it REPLACES the
  // conversation (an early return after every hook above has run), so there
  // is no transcript underneath to be repainted or bled through. The dropped
  // turn's prompt returns through the same fill path a rewind picker uses.
  if (treeOpen) {
    const tree = (
      <SessionTree
        channel={channel}
        currentSessionId={channel.agentId}
        onToggleTranscript={toggleTranscriptMode}
        onClose={() => setTreeOpen(false)}
        onRestoreText={(text) => {
          // The tree rewound to a node and is handing that turn's prompt back,
          // exactly like the picker does. It belongs to the binding the tree
          // action just created.
          pendingFillRef.current = String(channel.agentId)
          setHistoryFill(text)
        }}
      />
    )
    return fullscreen ? tree : <AlternateScreen>{tree}</AlternateScreen>
  }

  // The settings screen follows the browser's rule exactly: it REPLACES the
  // conversation (an early return after every hook above has run), so there
  // is no transcript underneath to be repainted or bled through.
  if (settingsOpen) {
    const screen = <Settings channel={channel} onClose={() => setSettingsOpen(false)} />
    return fullscreen ? screen : <AlternateScreen>{screen}</AlternateScreen>
  }

  // Subagent detail scene: displays detailed view of a specific subagent.
  // Like the browser and settings, it replaces the conversation entirely.
  if (subagentDetailId !== null) {
    const subagent = channel.subagents.find(s => s.agentId === subagentDetailId)
    if (!subagent) {
      // Agent not found, go back to dashboard
      setSubagentDetailId(null)
      setSubagentDashboardOpen(true)
      return null
    }
    const scene = (
      <SubagentDetailScene
        subagent={subagent}
        onInterrupt={(id) => channel.subagentControl.interrupt(id)}
        followUpEnabled={subagentContinuableIds.has(subagent.agentId)}
        onFollowUp={followUpSubagent}
        onBack={() => {
          setSubagentDetailId(null)
          setSubagentDashboardOpen(true)
        }}
      />
    )
    return fullscreen ? scene : <AlternateScreen>{scene}</AlternateScreen>
  }

  // Jobs panel: background jobs (running/killed) with kill/inspect actions.
  // Like the browser and settings, it replaces the conversation entirely.
  if (jobsPanelOpen) {
    const panel = (
      <JobsPanel
        jobs={channel.backgroundJobs ?? []}
        onClose={() => setJobsPanelOpen(false)}
        onKill={(id) => {
          // Stub channels (verify harnesses) have no jobControl — surface
          // the same failure toast as a refused kill instead of throwing.
          if (channel.jobControl?.kill(id) !== true) {
            channel.notify(t('jobs-kill-failed', { id }), { color: 'error' })
          }
        }}
      />
    )
    return fullscreen ? panel : <AlternateScreen>{panel}</AlternateScreen>
  }

  // Subagent dashboard: displays all active and completed subagents.
  // Like the browser and settings, it replaces the conversation entirely.
  if (subagentDashboardOpen) {
    const dashboard = (
      <SubagentDashboard
        subagents={[...channel.subagents]}
        onSelect={(id) => {
          setSubagentDashboardOpen(false)
          setSubagentDetailId(id)
        }}
        continuableIds={subagentContinuableIds}
        onFollowUp={followUpSubagent}
        onClose={() => setSubagentDashboardOpen(false)}
      />
    )
    return fullscreen ? dashboard : <AlternateScreen>{dashboard}</AlternateScreen>
  }

  // Task center: the unified classified panel (jobs + subagents) with its
  // own detail scene for subagent rows.
  if (taskCenterOpen) {
    const panel = (
      <TaskCenterPanel
        jobs={channel.backgroundJobs ?? []}
        subagents={[...channel.subagents]}
        continuableIds={subagentContinuableIds}
        onClose={() => setTaskCenterOpen(false)}
        onKillJob={(id) => {
          // Stub channels (verify harnesses) have no jobControl — surface
          // the same failure toast as a refused kill instead of throwing.
          if (channel.jobControl?.kill(id) !== true) {
            channel.notify(t('jobs-kill-failed', { id }), { color: 'error' })
          }
        }}
        onInterrupt={(id) => channel.subagentControl?.interrupt(id)}
        onDeleteSubagent={(id) => {
          const outcome = channel.subagentControl?.remove?.(id)
          if (outcome === 'running') channel.notify(t('subagent-delete-running'), { color: 'error' })
          else if (outcome === 'removed') channel.notify(t('subagent-delete-done'), { color: 'success' })
        }}
        onFollowUp={followUpSubagent}
        onOpenSubagent={(id) => {
          // Enter from the panel: Esc returns HERE, to the panel.
          setTaskCenterDetailFromPanel(true)
          setTaskCenterOpen(false)
          setTaskCenterDetailId(id)
        }}
      />
    )
    return fullscreen ? panel : <AlternateScreen>{panel}</AlternateScreen>
  }
  if (taskCenterDetailId !== null) {
    const subagent = (channel.subagents ?? []).find(s => s.agentId === taskCenterDetailId)
    if (subagent === undefined) {
      setTaskCenterDetailId(null)
      if (taskCenterDetailFromPanel) setTaskCenterOpen(true)
    } else {
      // The transcript scene re-reads on every channel.subagents snapshot
      // change (streaming bumps) — same defensive optionality as above for
      // stub verify channels.
      const detail = (
        <TaskCenterDetail
          subagent={subagent}
          version={channel}
          readTranscript={(id: string) => channel.subagentTranscript?.(id) ?? Promise.resolve([])}
          onInterrupt={(id: string) => channel.subagentControl?.interrupt(id)}
          followUpEnabled={subagentContinuableIds.has(subagent.agentId)}
          onFollowUp={followUpSubagent}
          onBack={() => {
            setTaskCenterDetailId(null)
            // Return where the user came from: the panel (Enter on a row)
            // or the main session (strip click).
            if (taskCenterDetailFromPanel) setTaskCenterOpen(true)
          }}
        />
      )
      return fullscreen ? detail : <AlternateScreen>{detail}</AlternateScreen>
    }
  }

  /** Prompt input is inert while a modal dialog owns the keyboard. The
   *  overlay union covers every picker/dialog and /tips in one check;
   *  message-selection mode and the /btw panel live outside it. */
  const promptSelectionActive =
    selectionActive || overlay.kind !== 'none' || btw !== null

  // These panels replace the visible composer, but PromptInput remains
  // mounted (suspended) so an async registry command cannot lose its exact
  // text/image draft while it waits for a user decision.
  const promptReplacementOpen =
    approvalPanelNode !== null
    || dialogSnapshot !== null
    || overlay.kind === 'tips'
    || (recap !== null && (!recap.auto || recap.expanded))
    || btw !== null
    || questionPanelNode !== null

  // The trajectory scene replaces the conversation for as long as it is open.
  // Rendering it INSTEAD of (not above) the transcript is what makes it a
  // screen rather than an overlay: it owns the full viewport, and the
  // conversation's own frame is never resized while it is up. Chat stays
  // mounted, so every hook above has already run and no state is lost.
  // `<AlternateScreen>` is skipped when the app is already fullscreen —
  // nesting it would emit a second DEC 1049, and its unmount would drop the
  // whole app back to the main screen.
  if (sceneOpen) {
    const scene = <TrajectoryScene channel={channel} build={trajectory} onClose={closeScene} />
    return fullscreen ? scene : <AlternateScreen>{scene}</AlternateScreen>
  }

  // 浮层整体挂载条件：与内部各面板的可见条件同值（数据门在
  // dialogOverlayVisible 里逐面板镜像）。关闭时把整个 absolute 浮层从树里
  // 移除——渲染器的"移除 absolute 节点"检测只看被移除子树自身的
  // style.position（dom.ts collectRemovedRects），若浮层常驻、只移除其
  // 普通子节点，blit 解毒不触发，被覆盖的转录行会在 blit-skip 后留空
  // （Esc 关 picker 一片空白的根因）。
  const dialogOverlayOpen = dialogOverlayVisible(overlay, {
    workspaceTargetCount: workspaceTargets.length,
    effortOptionCount: effortOptions.length,
    presetOptionCount: presetOptions.length,
  }) && !(overlay.kind === 'permission'
    && (approvalSnapshot !== null || questionSnapshot !== null || dialogSnapshot !== null))

  // The sticky header pins the turn owning the viewport top row
  // (timeline.activeId, reported by MessageList) — scrolled up to an old
  // turn, it carries THAT turn's prompt, not the latest one.
  // channel.rows is a live in-place array, so the lookup is per-render.
  const anchorUserRowId = timeline.activeId
  const anchorUserText =
    anchorUserRowId === null
      ? null
      : channel.rows.find(row => row.id === anchorUserRowId)?.text ?? null

  // Modal image preview, shared by the composer's [Image #N] tokens and the
  // transcript thumbnails. It normally lives INSIDE the transcript row, so
  // the card centers over the conversation and the sticky header, prompt
  // and status rows stay visible. While the fullscreen draft editor is open
  // it moves to the root, after PromptEditorLayer, so it still paints above
  // the editor (the editor state stays put; closing the preview restores it).
  // The layer needs its region before its first paint (see the component):
  // the transcript viewport height from the ScrollBox handle and the content
  // column width. The full-screen (editor-open) placement uses the terminal.
  const imagePreviewRegion = promptEditorOpen
    ? { columns: terminalColumns, rows: terminalRows }
    : { columns: terminalColumns, rows: handle?.getViewportHeight() ?? terminalRows }
  const imagePreviewNode = activePreview !== null && (activePreview.peek || imagePreviewOwned)
    ? (
      <ImagePreviewOverlay
        image={activePreview.image}
        title={activePreview.title}
        navigation={previewGallery.length > 1 && previewIndex >= 0 ? {
          index: previewIndex, total: previewGallery.length,
          onPrevious: () => stepPreview(-1), onNext: () => stepPreview(1),
        } : undefined}
        onClose={activePreview.peek
          ? () => setPeekSuppressed(peekKey(activePreview.image, activePreview.title))
          : () => dispatchOverlay({ type: 'close-if', kind: 'image-preview' })}
        region={imagePreviewRegion}
      />
    )
    : null

  return (
    <Box ref={wakeTickRef} flexDirection="column" flexGrow={1} width="100%">
      {!isSticky && anchorUserText && (
        <PinnedTurnHeader
          text={anchorUserText}
          onClick={() => {
            // Click snaps the pinned prompt to the viewport top. Jump by the
            // SAME content coordinate the
            // rail's tick uses (timeline turn top = the prompt TEXT top):
            // the element-based seek lands the row wrapper's margin at the
            // top instead — one row shy of the text top the anchor rule
            // compares against — and the header would flip to the previous
            // turn immediately after the click.
            const turn = timeline.turns.find(t => t.id === anchorUserRowId)
            if (turn) handle?.scrollTo(turn.top)
            else if (anchorUserRowId !== null) seekRow(anchorUserRowId)
            else handle?.scrollToBottom()
          }}
        />
      )}
      {/* Transcript row. Under PageMargin the negative right margin makes
          the row stretch past the content column to the terminal edge —
          the gutter (timeline rail / scrollbar) thus lands at the very
          edge while the transcript TEXT stays inside the page margin
          (structural chrome convention: dividers and the rail bleed, text
          and cards keep the content column). No explicit width: cross-axis
          stretch with the margin yields exactly content+margin. */}
      <Box flexDirection="row" flexGrow={1} flexShrink={1} marginRight={-pageInsetX}>
        <ScrollBox ref={setHandle} flexDirection="column" flexGrow={1} flexShrink={1} stickyScroll>
        <LogoHeader
          key={logoNonce}
          model={channel.model}
          effort={channel.reasoningEffort}
          cwd={channel.displayCwd}
          whale={channel.whale}
          whaleIdle={channel.whaleIdle && whaleArtVisible}
          working={channel.working}
          // Resuming a long session skips the ~3.4s opening animation: it
          // keeps firing low-frequency React commits that compete with the
          // transcript mount batches (and the first wheel events) for the
          // frame budget right when the user wants to read history. Fresh
          // sessions keep the full intro; restored ones settle instantly.
          // A remount after a whole screen closed also settles instantly
          // (see suppressLogoIntroRef).
          skipIntro={suppressLogoIntroRef.current || channel.rows.length > 30}
        />
        {/* The startup loaded-context panel: before the first message the
            transcript is empty, so the inventory of what this conversation
            will load (system prompt, workspace instructions, skills, tools)
            sits at the top, collapsed to a summary line and expandable with
            Ctrl+P; the first rows take over. */}
        {loadedContextVisible && (
          <LoadedContextPanel
            context={channel.loadedContext}
            open={loadedContextOpen}
            onToggle={toggleLoadedContext}
          />
        )}
        <MessageList
          rows={channel.rows}
          failureHintRowId={failureHintRowId}
          failureHint={t('traj-hint-failure', { key: `${modLabel}t` })}
          expanded={expanded}
          expandedRows={expandedRows}
          selectedId={selectionActive ? selectedId : null}
          onToggleRow={toggleRowExpanded}
          streamViewToggledRows={streamViewToggledRows}
          onToggleStreamView={toggleStreamView}
          model={channel.model}
          diffLayout={channel.diffLayout}
          thinkingFold={channel.thinkingFold}
          toolBodyLines={channel.toolBodyLines}
          toolBackground={channel.toolBackground}
          foldTerminalCommand={channel.foldTerminalCommand}
          smoothStreaming={channel.smoothStreaming}
          activityFrames={channel.activityFrames}
          showAll={showAllMessages}
          thinkingVisible={thinkingVisible}
          historyPaintEnabled={!fullscreen}
          onToggleAll={() =>{  setShowAllMessages(previous => !previous) }}
          onLoadOlder={() => channel.loadOlder()}
          registerRowRef={registerRowRef}
          scrollHandle={handle}
          forceMountRowId={forceMountRowId}
          newSinceRowId={isSticky ? null : lastSeenRowIdRef.current}
          onUnseenCount={setUnseenCount}
          onTimeline={setTimeline}
          onOpenSubagent={setSubagentDetailId}
          onOpenJobs={openJobsPanel}
          onOpenFile={openFileActions}
          sessionCwd={channel.cwd}
          onPreviewImage={openImagePreview}
          suppressImageGraphics={activePreview !== null}
        />
        </ScrollBox>
        {(() => {
          // Gutter mode (settings `dsh-tui.scrollGutter`): the timeline
          // rail (default), the proportional scrollbar, or nothing. The
          // slot keeps its 2 columns in both rendered modes (Qwen's
          // permanent-gutter rule — an appearing/disappearing gutter
          // changes the transcript width and rewraps everything).
          const gutter = normalizeScrollGutter(channel.scrollGutter)
          if (gutter === 'hidden') return null
          if (gutter === 'scrollbar') {
            return <ScrollbarGutter handle={handle} terminalWidth={terminalColumns} />
          }
          return (
            <TimelineRail
              handle={handle}
              turns={timeline.turns}
              activeId={timeline.activeId}
              upId={timeline.upId}
              downId={timeline.downId}
              terminalWidth={terminalColumns}
              hoverEnabled={!promptSelectionActive}
              onRevealTurn={revealAndSeekRow}
            />
          )
        })()}
        {!promptEditorOpen && imagePreviewNode}
        {overlay.kind === 'row-detail' && (() => {
          const detailRow = channel.rows.find(r => r.id === overlay.rowId)
          return detailRow !== undefined ? (
            <RowDetailOverlay
              row={detailRow}
              scrollRef={rowDetailScrollRef}
              maxRows={handle?.getViewportHeight()}
              onClose={() => dispatchOverlay({ type: 'close-if', kind: 'row-detail' })}
            />
          ) : null
        })()}
      </Box>
      {/* Bottom chrome (pill, spinners, dialogs, prompt, statusline): never
          let flex shrink squeeze these fixed-height rows — the ScrollBox
          above absorbs all overflow (it is the scroll container). */}
      <Box flexDirection="column" flexShrink={0}>
        {showPill && (
          <NewMessagesPill
            count={unseenCount}
            onClick={() => handle?.scrollToBottom()}
          />
        )}
        {channel.working &&
          (channel.activityEnabled &&
          !channel.minimal &&
          workingActivity !== undefined &&
          workingActivity.line !== '' &&
          workingActivity.phase !== 'idle' ? (
            // The working-activity line replaces the random-verb spinner
            // while a turn runs: the plugin's live line (thinking copy /
            // running tool / narration) is the status, led by the shared
            // blinking-diamond bullet. Only real activity data replaces the
            // spinner — before the first event, or with `activity: false`,
            // the classic spinner still renders. The line hugs the left
            // edge (no padding) so the self-narration reads as part of the
            // transcript, aligned with the `❯` prompt below.
              <Box marginTop={1}>
                <ActivityLine
                  activity={{
                    ...workingActivity,
                    line: workingActivity.phase === 'thinking'
                      ? liveThinkingTail(channel.rows) ?? grokWorkingLine(workingActivity)
                      : grokWorkingLine(workingActivity),
                  }}
                  activityFrames={channel.activityFrames}
                  warnPct={activityWarnPct}
                  warnDanger={activityWarnPct !== undefined && activityWarnPct >= 95}
                />
              </Box>
            ) : (
              <WorkingSpinner
                mode={channel.spinnerMode}
                hasActiveTools={channel.activeToolCount > 0}
                responseLengthRef={responseLengthRef}
                uploadTokensRef={uploadTokensRef}
                loadingStartTimeRef={loadingStartTimeRef}
                totalPausedMsRef={totalPausedMsRef}
                pauseStartTimeRef={pauseStartTimeRef}
                thinkingStatus={thinkingStatus}
              />
            ))}
        <GoalTodoPanel
          channel={channel}
          collapsed={todoCollapsed}
          onToggle={() => setTodoCollapsed(previous => !previous)}
        />
        {recap !== null && recap.auto && !recap.expanded && (
          <AutoRecapRow
            summary={recap.summary}
            streaming={!recap.done}
            onExpand={() => setRecap(prev => (prev ? { ...prev, expanded: true } : prev))}
            onDismiss={() => closeRecap()}
          />
        )}
        {balance !== null && (
          <BalanceReportRow
            result={balance.result}
            refreshing={balance.refreshing}
            tokens={channel.tokens}
            model={channel.model}
            onRefresh={runBalance}
            onDismiss={() => setBalance(null)}
          />
        )}
        {statusEntries.length > 0 && (
          // Plugin status contributions (tuiStatus seam): one joined line,
          // truncated by the Text wrap contract — the host owns the layout,
          // plugins own only their text.
          <Text dimColor wrap="truncate">
            {statusEntries.map(entry => entry.text).join(' · ')}
          </Text>
        )}
        {activePreview === null && statusViews.map(view => (
          <PluginStatusViewBoundary
            key={`${view.key}:${view.registrationId}`}
            viewKey={view.key}
            onError={(key, error) => statusContributions.reportViewError(key, error)}
          >
            <Box
              flexDirection="column"
              flexShrink={0}
              maxHeight={view.maxRows}
              overflow="hidden"
            >
              <Box flexDirection="column" flexShrink={0}>
                {React.createElement(view.component, {
                  React,
                  ui: STATUS_VIEW_UI,
                })}
              </Box>
            </Box>
          </PluginStatusViewBoundary>
        ))}
        {/* 输入簇：可替换输入行链 + 状态行 + 瞬态浮层。浮层锚点收窄到本簇
            顶边（= 输入行顶边），picker 紧贴输入框向上展开，盖住其上
            todo/spinner/转录尾部行（用户接受的取舍），自身零布局高度、
            不推动帧布局。 */}
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
                  hint: trajectorySeen ? undefined : `${modLabel}t`,
                  tick: Math.floor(wakeTime / 120),
                }
          }
        />
        {/* 瞬态面板浮层：absolute + bottom:'100%' 钉在输入簇 Box 顶边（=
            输入行顶边），紧贴输入框向上覆盖其上 todo/spinner/转录尾部行，
            自身零布局高度。in-flow 挂载会让帧高随面板开关涨落，把帧顶行滚进
            scrollback 并在关闭重绘时二次写入（每切一次 /model 多一份启动画
            的根因）。浮层盖住 todo 是刻意取舍（贴输入框优先）；maxHeight
            预留 prompt/statusline 行，防短会话高列表探出帧顶。整体条件
            挂载：见 dialogOverlayOpen 注释。 */}
        {dialogOverlayOpen && (
        <OverlayAbove maxHeight={Math.max(terminalRows - 8, 1)}>
          {overlay.kind === 'thinking' && (
            <ThinkingToggle
              currentValue={thinkingVisible}
              focusIndex={overlay.focus}
              onPick={(index) => {
                // 点击行 = 设焦点 + 应用（与 Enter 同一条路径）
                const visible = index === 0
                setThinkingVisible(visible)
                dispatchOverlay({ type: 'close' })
                channel.notify(t('thinking-toggled', { state: visible ? t('thinking-on') : t('thinking-off') }))
              }}
            />
          )}
          {overlay.kind === 'workspace-picker' && workspaceTargets.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <WorkspacePicker
                targets={workspaceTargets}
                focusIndex={overlay.index}
                currentCwd={channel.cwd}
                onPick={(index) => {
                  // 点击行 = 切换该行目标（与 Enter 同一条路径）
                  const target = workspaceTargets[index]
                  dispatchOverlay({ type: 'close' })
                  if (target !== undefined) void channel.switchWorkspace(target)
                }}
              />
            </Box>
          )}
          {overlay.kind === 'workspace-menu' && (
            <Box flexDirection="column" marginTop={1}>
              <WorkspaceMenuPicker
                options={workspaceMenuOptions}
                focusIndex={overlay.index}
                onPick={(index) => {
                  // 点击行 = 执行该行（与 Enter 同一条路径）
                  runWorkspaceMenuOption(workspaceMenuOptions[index])
                }}
              />
            </Box>
          )}
          {overlay.kind === 'workspace-flow' && (
            <Box flexDirection="column" marginTop={1}>
              <WorkspaceFlowPicker
                title={overlay.flow.title}
                choices={overlay.flow.choices}
                focusIndex={overlay.index}
                busy={overlay.busy}
                input={overlay.input}
                onPick={(index) => {
                  // 点击行 = 设焦点 + 执行分支（与 Enter 同一条路径）；
                  // busy/输入态在组件侧禁点
                  const choice = overlay.flow.choices[index]
                  if (choice === undefined) return
                  dispatchOverlay({ type: 'set-index', kind: 'workspace-flow', index })
                  runWorkspaceFlowAction(signal => choice.choose(signal))
                }}
              />
            </Box>
          )}
          {overlay.kind === 'model' && (
            <Box flexDirection="column" marginTop={1}>
              {models.length === 0 ? (
                <ModelPickerLoading />
              ) : activeModelGroup === undefined ? (
                <ModelPicker
                  groups={modelGroups}
                  focusIndex={overlay.index}
                  currentProvider={channel.provider}
                  onPick={(index) => {
                    // 点击分组行 = 进入该组（与 Enter 同一条路径）
                    const group = modelGroups[index]
                    if (!group) return
                    setModelGroup(group.provider)
                    if (group.provider === RECENTS_GROUP_PROVIDER) {
                      dispatchOverlay({ type: 'set-index', kind: 'model', index: 0 })
                      return
                    }
                    const landing = modelPickerLanding(
                      models.filter(model => model.provider === group.provider),
                      channel.provider,
                      channel.model,
                    )
                    dispatchOverlay({ type: 'set-index', kind: 'model', index: landing.index })
                  }}
                />
              ) : (
                <ModelPicker
                  models={groupModels}
                  groupLabel={activeModelGroup === RECENTS_GROUP_PROVIDER
                    ? t('picker-group-recent')
                    : modelGroups.find(group => group.provider === activeModelGroup)?.label}
                  showBack={modelGroups.length > 1 && !modelPickerDirect}
                  showProviderPrefix={activeModelGroup === RECENTS_GROUP_PROVIDER}
                  focusIndex={overlay.index}
                  currentModel={`${channel.provider}/${channel.model}`}
                  onPick={(index) => {
                    // 点击行 = 应用该行模型（与 Enter 同一条路径）
                    const model = groupModels[index]
                    if (!model) return
                    dispatchOverlay({ type: 'close' })
                    void switchModelRecorded(model.provider, model.id, model.name)
                  }}
                />
              )}
            </Box>
          )}
          {overlay.kind === 'skills' && (
            <Box flexDirection="column" marginTop={1}>
              {skillsList === null ? (
                <SkillsPickerLoading />
              ) : (
                <SkillsPicker
                  skills={skillsList}
                  focusIndex={overlay.index}
                  onPick={(index) => {
                    const skill = skillsList[index]
                    if (!skill) return
                    dispatchOverlay({ type: 'close' })
                    if (skill.userInvocable) setHistoryFill(`/${skill.name} `)
                  }}
                />
              )}
            </Box>
          )}
          {overlay.kind === 'activity' && (
            <Box flexDirection="column" marginTop={1}>
              <ActivityPicker
                focusIndex={overlay.index}
                currentPreset={channel.activityFrames}
                onPick={(index) => {
                  dispatchOverlay({ type: 'close' })
                  const name = PRESET_NAMES[index]
                  if (name) channel.setActivityFrames(name)
                }}
              />
            </Box>
          )}
          {overlay.kind === 'color' && (
            <Box flexDirection="column" marginTop={1}>
              <ColorPicker
                focusIndex={overlay.index}
                currentColor={channel.sessionColor}
                onPick={(index) => {
                  dispatchOverlay({ type: 'close' })
                  const name = SESSION_COLOR_NAMES[index]
                  if (name) {
                    channel.setSessionColor(name)
                    channel.notify(t('color-set', { name }), { color: 'success' })
                  }
                }}
              />
            </Box>
          )}
          {overlay.kind === 'effort' && effortOptions.length > 1 && (
            <Box flexDirection="column" marginTop={1}>
              <EffortSlider
                options={effortOptions}
                focusIndex={overlay.index}
                currentId={channel.reasoningEffort}
                // 点击档位 = 移到该档并即时应用（与 ←/→ 同语义）
                onPick={(index) => {
                  dispatchOverlay({ type: 'set-index', kind: 'effort', index })
                  const option = effortOptions[index]
                  if (option) void channel.setEffort(option.id)
                }}
              />
            </Box>
          )}
          {overlay.kind === 'preset' && presetOptions.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <PresetPicker
                presets={presetOptions}
                focusIndex={overlay.index}
                currentPreset={channel.agentPreset}
                onPick={(index) => {
                  dispatchOverlay({ type: 'close' })
                  const option = presetOptions[index]
                  if (option) void channel.switchPreset(option.id)
                }}
              />
            </Box>
          )}
          {overlay.kind === 'permission' && overlay.snapshot.options.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <PermissionsPicker
                options={overlay.snapshot.options}
                focusIndex={overlay.index}
                currentValue={overlay.snapshot.current?.value}
                cwd={channel.cwd}
                onPick={(index) => {
                  if (approvalSnapshot !== null || questionSnapshot !== null || dialogSnapshot !== null) return
                  const option = overlay.snapshot.options[index]
                  dispatchOverlay({ type: 'close' })
                  if (option !== undefined) void runPermissionCommand(` ${option.value}`)
                }}
              />
            </Box>
          )}
          {overlay.kind === 'plan' && (
            <Box flexDirection="column" marginTop={1}>
              <PlanPicker
                focusIndex={overlay.index}
                currentOn={channel.mode.plan === true}
                onPick={(index) => {
                  dispatchOverlay({ type: 'close' })
                  const on = index === 0
                  void runExternalCommand('plan', on ? '' : ' off')
                }}
              />
            </Box>
          )}
          {overlay.kind === 'lang' && (
            <Box flexDirection="column" marginTop={1}>
              <LangPicker
                focusIndex={overlay.index}
                currentLang={getLang()}
                onPick={(index) => {
                  const lang = LANGS[index]
                  if (lang === undefined) return
                  dispatchOverlay({ type: 'close' })
                  applyLang(lang)
                }}
              />
            </Box>
          )}
          {overlay.kind === 'theme' && (
            <Box flexDirection="column" marginTop={1}>
              <ThemePicker
                focusIndex={overlay.index}
                currentTheme={themeName}
                themeHost={themeHost}
                onPick={(index) => {
                  dispatchOverlay({ type: 'close' })
                  const name = getThemeOptions(themeHost)[index]?.value
                  if (name !== undefined) {
                    const ok = setTheme(name)
                    channel.notify(
                      ok ? t('theme-switched-saved', { name }) : t('theme-switch-failed', { name }),
                      { color: ok ? 'success' : 'error' },
                    )
                  }
                }}
              />
            </Box>
          )}
          {overlay.kind === 'history' && (
            <Box flexDirection="column" marginTop={1}>
              <HistorySearchDialog
                query={overlay.query}
                cursorOffset={overlay.cursor}
                matches={historyMatches}
                focusIndex={overlay.focus}
                onPick={(index) => {
                  // 点击行 = 填入该历史命令（与 Enter 同路径）
                  const entry = historyMatches[index]
                  if (entry) {
                    setHistoryFill(entry.text)
                    dispatchOverlay({ type: 'close' })
                  }
                }}
              />
            </Box>
          )}
          {overlay.kind === 'rewind' && (
            <Box flexDirection="column" marginTop={1}>
              <RewindPicker
                rows={rewindRows}
                focusIndex={overlay.index}
                confirmRow={overlay.confirm}
                modes={overlay.modes}
                modeIndex={overlay.modeIndex}
                busy={overlay.busy}
                onPickRow={(index) => {
                  // 列表页点击只选中：进入确认态保留键盘 Enter 显式触发
                  dispatchOverlay({ type: 'set-index', kind: 'rewind', index })
                }}
                onConfirm={() => {
                  // 确认页即显式确认层，点击直接执行（与 Enter 同路径）
                  const row = overlay.confirm
                  if (row === null) return
                  dispatchOverlay({ type: 'close' })
                  void performRewind(row)
                }}
                onPickMode={(index) => {
                  // 模式列表点击直接执行该模式（与 Enter 同路径）
                  const row = overlay.confirm
                  if (row === null) return
                  // 模式页仅当 modes 非空才渲染，这里空安全取值
                  const mode = index === 0 ? null : (overlay.modes?.[index - 1]?.id ?? null)
                  dispatchOverlay({ type: 'close' })
                  void performRewind(row, mode)
                }}
              />
            </Box>
          )}
          {overlay.kind === 'file-actions' && (
            <Box flexDirection="column" marginTop={1}>
              <FileActionsPanel
                path={overlay.path}
                isDir={overlay.isDir}
                focusIndex={overlay.index}
                onPick={(index) => {
                  // 点击行直接执行该动作（与 Enter 同路径）
                  const path = overlay.path
                  dispatchOverlay({ type: 'close' })
                  runFileAction(index, path)
                }}
              />
            </Box>
          )}
          {overlay.kind === 'search' && <TranscriptSearch query={searchQuery} cursorOffset={searchCursor} count={searchCount} current={searchCurrent} />}
        </OverlayAbove>
        )}
        </Box>
      </Box>
      {/* Tooltip 悬停浮层：absolute 零布局高度，挂在根 Box 最后确保盖在
          其余内容之上（yoga 的 absolute 相对父级，根 Box 原点即屏原点，
          指针 anchor 的屏幕坐标可直接使用）。订阅模块级 store，锚点/
          内容由各处的 useTooltip hover props 写入；resize 时自行隐藏
          （几何失效）。 */}
      <TooltipLayer
        invalidationKey={`${overlay.kind}:${dialogOverlayOpen}:${btw !== null}`}
        subscribeInvalidation={subscribeTooltipInvalidation}
      />
      {/* 全屏草稿编辑浮层：必须挂在 TooltipLayer 之后，才能盖住包括
          状态栏在内的全部普通后绘兄弟。内容由 PromptInput 经 module
          store 发布（见 PromptEditor.tsx）。图片预览是唯一有意后绘于它
          的 top modal：这样编辑器状态留在原处，关闭预览即可原样恢复。 */}
      <PromptEditorLayer />
      {/* 模态图片预览的全屏位：只在全屏草稿编辑器展开时用（编辑器盖住了
          transcript 行，预览必须作为根的最后一个孩子才压得过它）；平时
          预览挂在上面的 transcript 行内，见 imagePreviewNode。 */}
      {promptEditorOpen && imagePreviewNode}
    </Box>
  )
}
