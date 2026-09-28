/**
 * The pre-overlay keyboard guards of Chat's useInput, as a pure function:
 * which surface owns this key, whether the transcript scrolls, or whether
 * the overlay chain proceeds. Extracted verbatim from the inline chain so
 * the routing policy is unit-testable without a renderer.
 */

export type InputGuardAction =
  /** The key belongs to another surface (panel, scene, picker) — drop it. */
  | { type: 'yield' }
  /** Scroll the transcript by rows (wheel fallback / PgUp/PgDn) and consume. */
  | { type: 'scroll'; rows: number }
  /** Scroll to the bottom (minimized-question Enter/End) and consume. */
  | { type: 'scroll-bottom' }
  /** No guard claims it — continue into the overlay/selection chain. */
  | { type: 'continue' }

/** Plain-data snapshot of every surface the guard consults. */
export interface InputGuardContext {
  /** /btw side panel open. */
  btwOpen: boolean
  /** Tips overlay open. */
  tipsOverlay: boolean
  /** Full recap panel visible (auto row expanded or explicit /recap). */
  recapVisible: boolean
  /** Session tree owns the terminal. */
  treeOpen: boolean
  /** Session supervisor owns the terminal. */
  supervisorOpen: boolean
  /** Settings screen owns the terminal. */
  settingsOpen: boolean
  /** Subagent dashboard or detail scene open. */
  subagentSurfaces: boolean
  /** Task center panel (Ctrl+G) or its detail scene open. */
  taskCenterSurfaces: boolean
  /** /jobs panel open. */
  jobsPanelOpen: boolean
  /** Trajectory/plugin scene open. */
  sceneOpen: boolean
  /** A plugin scene id is set on the channel. */
  pluginScene: boolean
  /** Help overlay open. */
  helpOpen: boolean
  /** Approval panel pending. */
  approvalPending: boolean
  /** Extension dialog pending. */
  dialogPending: boolean
  /** Questionnaire pending. */
  questionPending: boolean
  /** Questionnaire minimized to a row. */
  questionMinimized: boolean
  /** Transcript is following the tail. */
  isSticky: boolean
  /** Fullscreen (alt-screen) mode — PgUp/PgDn only page there. */
  fullscreen: boolean
  /** Current overlay kind ('none' when closed). */
  overlayKind: string
  /** Loaded workspace picker targets (0 = picker paints nothing → wheel passes). */
  workspaceTargetsCount: number
  /** Transcript page step in rows (viewport minus one context row). */
  pageStep: number
  /** This keypress is a plain Enter (deduplicated upstream). */
  isPlainReturn: boolean
  /** Key reports End. */
  keyEnd: boolean
  /** Wheel direction, when the event is a wheel fallback. */
  wheel: 'up' | 'down' | null
  /** Page key direction, when the event is PgUp/PgDn. */
  page: 'up' | 'down' | null
}

export function inputGuardAction(ctx: InputGuardContext): InputGuardAction {
  // Prompt-slot panels own the keyboard while visible: yielding still lets
  // the panel's own useInput receive them, and Ctrl+C must never clear the
  // hidden composer draft.
  if (ctx.btwOpen || ctx.tipsOverlay || ctx.recapVisible) return { type: 'yield' }
  if (ctx.treeOpen) return { type: 'yield' }
  if (ctx.supervisorOpen) return { type: 'yield' }
  if (ctx.settingsOpen) return { type: 'yield' }
  if (ctx.subagentSurfaces) return { type: 'yield' }
  if (ctx.taskCenterSurfaces) return { type: 'yield' }
  if (ctx.jobsPanelOpen) return { type: 'yield' }
  if (ctx.sceneOpen || ctx.pluginScene) return { type: 'yield' }
  // Wheel fallback (over non-scroll areas): help stays yielded, an open
  // picker/dialog is modal — a workspace picker whose target list has not
  // landed paints nothing, so wheel-through keeps scrolling.
  if (ctx.wheel !== null) {
    if (ctx.helpOpen) return { type: 'yield' }
    const overlayModal =
      ctx.overlayKind !== 'none' &&
      (ctx.overlayKind !== 'workspace-picker' || ctx.workspaceTargetsCount > 0)
    if (overlayModal) return { type: 'yield' }
    return { type: 'scroll', rows: ctx.wheel === 'up' ? -3 : 3 }
  }
  // PgUp/PgDn page the transcript — fullscreen only (inline mode keeps the
  // terminal's own scrollback); same modality rules as the wheel branch.
  if (ctx.page !== null && ctx.fullscreen) {
    if (ctx.helpOpen) return { type: 'yield' }
    const overlayModal =
      ctx.overlayKind !== 'none' &&
      (ctx.overlayKind !== 'workspace-picker' || ctx.workspaceTargetsCount > 0)
    if (overlayModal) return { type: 'yield' }
    return { type: 'scroll', rows: (ctx.page === 'up' ? -1 : 1) * ctx.pageStep }
  }
  // Help is modal over Chat — PromptInput owns every remaining key.
  if (ctx.helpOpen) return { type: 'yield' }
  // Questionnaire / approval / dialog own the keyboard while pending; a
  // minimized questionnaire still lets Enter/End jump back to the tail.
  if (ctx.approvalPending || ctx.dialogPending) return { type: 'yield' }
  if (ctx.questionPending) {
    if (ctx.questionMinimized && !ctx.isSticky && (ctx.isPlainReturn || ctx.keyEnd)) {
      return { type: 'scroll-bottom' }
    }
    return { type: 'yield' }
  }
  return { type: 'continue' }
}
