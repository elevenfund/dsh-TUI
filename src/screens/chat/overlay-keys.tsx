import React from 'react'
import type { Key } from '../../ink/events/input-event.js'
import { wrapIndex, type ChatOverlay, type ChatOverlayAction, type WorkspaceFlowInput } from '../chatOverlay.js'
import { t } from '../../i18n.js'
import { LANGS } from '../../i18n.js'
import { actionMatches } from '../../utils/keymap.js'
import { isMod } from '../../utils/modifiers.js'
import { getThemeOptions } from '../../components/ThemePicker.js'
import { RECENTS_GROUP_PROVIDER, modelPickerLanding } from '../../modelGroups.js'
import { PRESET_NAMES } from '../../components/activityFrames.js'
import { SESSION_COLOR_NAMES } from '../../terminal-utils/sessionColors.js'
import { FILE_ACTION_COUNT } from '../../components/FileActionsPanel.js'
import type { ChannelUi } from '../../adapter/channel/ui-policy.js'
import type { TuiWorkspaceTarget, TuiWorkspaceCommandResult } from '../../workspaces.js'
import type { TuiThemeHost } from '../../dsh-adapter/themes.js'
import type { LlmModelInfo } from '../../adapter/ports/channel-view.js'
import type { ModelGroupRow } from '../../modelGroups.js'
import type { ChatRow, ComposerImageRef } from '../../dsh-adapter/channel.js'
import type { ScrollBoxHandle } from '../../ui.js'

/**
 * Overlay keyboard routing: one handler per open overlay kind, dispatched
 * through the kind → handler table returned by `createOverlayKeyHandlers`.
 * Each handler body is the old useInput branch verbatim — a handler decides
 * for itself whether to stopImmediatePropagation (e.g. thinking does not,
 * so the prompt still sees plain keys while that picker is up).
 */
export type OverlayKeyEvent = { stopImmediatePropagation(): void }
export type OverlayKeyHandler = (input: string, key: Key, plainReturn: boolean, event: OverlayKeyEvent) => void

/** Shared vertical navigation for the list overlays: arrows plus vim j/k,
 *  g/G (with Home/End) jumping to the list ends. Character keys stop here —
 *  arrows are harmless downstream, letters would reach the composer. One
 *  spelling for every picker so the vim set cannot drift between surfaces.
 *  Returns true when the key was consumed. */
function pickerNav(
  dispatchOverlay: (action: ChatOverlayAction) => void,
  event: OverlayKeyEvent | undefined,
  input: string,
  key: Key,
  count: number,
): boolean {
  const plain = !isMod(key) && !key.meta
  if (key.upArrow || (plain && input === 'k')) {
    dispatchOverlay({ type: 'move', delta: -1, count })
  } else if (key.downArrow || (plain && input === 'j')) {
    dispatchOverlay({ type: 'move', delta: 1, count })
  } else if (key.home || (plain && input === 'g')) {
    dispatchOverlay({ type: 'jump', to: 'top', count })
  } else if (key.end || (plain && input === 'G')) {
    dispatchOverlay({ type: 'jump', to: 'bottom', count })
  } else {
    return false
  }
  event?.stopImmediatePropagation()
  return true
}

/** Everything the per-kind handlers close over, passed fresh each render. */
export interface OverlayKeyDeps {
  overlay: ChatOverlay
  dispatchOverlay: (action: ChatOverlayAction) => void
  channel: ChannelUi
  handle: ScrollBoxHandle | null
  searchAnchorRef: React.RefObject<number>
  searchQuery: string
  searchCount: number
  searchCursor: number
  setHighlight: (query: string) => void
  setSearchQuery: (query: string) => void
  setSearchCursor: (cursor: number | ((prev: number) => number)) => void
  setThinkingVisible: (visible: boolean) => void
  interruptRunningTurn: () => void
  rowDetailScrollRef: React.RefObject<ScrollBoxHandle | null>
  workspaceFlowAbortRef: React.RefObject<AbortController | null>
  workspaceFlowRequestRef: React.RefObject<number>
  runWorkspaceFlowAction: (run: (signal: AbortSignal) => TuiWorkspaceCommandResult | Promise<TuiWorkspaceCommandResult>) => void
  workspaceTargets: readonly TuiWorkspaceTarget[]
  workspaceMenuOptions: ReadonlyArray<{ id: string; label: string; description: string }>
  runWorkspaceMenuOption: (option: { id: string } | undefined) => void
  activeModelGroup: string | undefined
  modelGroups: ReadonlyArray<ModelGroupRow>
  groupModels: readonly LlmModelInfo[]
  setModelGroup: (provider: string | undefined) => void
  models: readonly LlmModelInfo[]
  switchModelRecorded: (provider: string, id: string, name?: string) => Promise<boolean>
  modelPickerDirect: boolean
  skillsList: readonly { name: string; userInvocable?: boolean }[] | null
  setHistoryFill: (text: string) => void
  effortOptions: readonly { id: string }[]
  presetOptions: readonly { id: string }[]
  permissionOverlayFocusRef: React.RefObject<{ overlay: unknown; index: number } | null>
  runPermissionCommand: (arg: string) => Promise<unknown>
  runExternalCommand: (name: string, rawInput: string, images?: readonly ComposerImageRef[]) => Promise<boolean>
  applyLang: (lang: 'zh' | 'en') => void
  themeHost: TuiThemeHost | undefined
  setTheme: (name: string) => boolean
  historyMatches: readonly { text: string }[]
  rewindRequestRef: React.RefObject<number>
  performRewind: (row: ChatRow, mode?: string | null) => Promise<void>
  rewindRows: readonly ChatRow[]
  requestRewindConfirm: (row: ChatRow) => Promise<void>
  runFileAction: (index: number, path: string) => void
  imagePreviewZoomRef: React.RefObject<{ zoomIn(): void; zoomOut(): void } | null>
}

export function createOverlayKeyHandlers(deps: OverlayKeyDeps): Partial<Record<ChatOverlay['kind'], OverlayKeyHandler>> {
  const {
    overlay, dispatchOverlay, channel, handle,
    searchAnchorRef, searchQuery, searchCount, searchCursor, setHighlight, setSearchQuery, setSearchCursor,
    setThinkingVisible, interruptRunningTurn, rowDetailScrollRef,
    workspaceFlowAbortRef, workspaceFlowRequestRef, runWorkspaceFlowAction,
    workspaceTargets, workspaceMenuOptions, runWorkspaceMenuOption,
    activeModelGroup, modelGroups, groupModels, setModelGroup, models,
    switchModelRecorded, modelPickerDirect,
    skillsList, setHistoryFill, effortOptions, presetOptions,
    permissionOverlayFocusRef, runPermissionCommand,
    runExternalCommand, applyLang, themeHost, setTheme,
    historyMatches, rewindRequestRef, performRewind, rewindRows,
    requestRewindConfirm, runFileAction, imagePreviewZoomRef,
  } = deps
  const onImagePreviewKeys: OverlayKeyHandler = (input, key, plainReturn, event) => {
    // Modal gallery owns plain left/right. Caret peeks below still leave
    // navigation with PromptInput. Esc/Ctrl+C/Enter keep their close
    // semantics — except Ctrl+C while a turn runs, which stays an
    // interrupt (grok keeps Cancel global; Esc still closes).
    if (key.ctrl && input === 'c' && channel.working) {
      interruptRunningTurn()
    } else if (key.escape || (key.ctrl && input === 'c') || plainReturn) {
      dispatchOverlay({ type: 'close' })
    } else if (!key.ctrl && !key.meta && !key.shift && (key.leftArrow || key.rightArrow)) {
      dispatchOverlay({ type: 'image-step', delta: key.leftArrow ? -1 : 1 })
    } else if (!key.ctrl && !key.meta && (input === '+' || input === '=' || input === '-')) {
      // The documented +/− zoom finally has keys (the buttons were
      // mouse-only); `=` rides along for the shifted-+ layout.
      if (input === '-') imagePreviewZoomRef.current?.zoomOut()
      else imagePreviewZoomRef.current?.zoomIn()
    }
    event.stopImmediatePropagation()
  }
  const onRowDetailKeys: OverlayKeyHandler = (input, key, plainReturn, event) => {
    // The detail card owns the keyboard while up: scroll keys go to its
    // ScrollBox, Esc/Enter/q close back into selection mode (the cursor
    // stays on the row that opened the card). Same vim set as selection
    // mode so the hands never switch rows.
    const detail = rowDetailScrollRef.current
    if (key.ctrl && input === 'c' && channel.working) {
      // Ctrl+C while a turn runs stays an interrupt even with the card
      // up (grok keeps Cancel global); the card stays, Esc/Enter/q still
      // close it.
      interruptRunningTurn()
    } else if (key.escape || (key.ctrl && input === 'c') || plainReturn || (!isMod(key) && !key.meta && input === 'q')) {
      dispatchOverlay({ type: 'close' })
    } else if (key.upArrow || (!isMod(key) && !key.meta && input === 'k')) {
      detail?.scrollBy(-1)
    } else if (key.downArrow || (!isMod(key) && !key.meta && input === 'j')) {
      detail?.scrollBy(1)
    } else if (key.pageUp || (isMod(key) && input === 'b') || (!isMod(key) && !key.meta && input === 'u')) {
      detail?.scrollBy(-Math.max(1, Math.floor((detail?.getViewportHeight() ?? 20) / 2)))
    } else if (key.pageDown || (isMod(key) && input === 'f') || (!isMod(key) && !key.meta && input === 'd')) {
      detail?.scrollBy(Math.max(1, Math.floor((detail?.getViewportHeight() ?? 20) / 2)))
    } else if (key.home || (!isMod(key) && !key.meta && input === 'g')) {
      detail?.scrollTo(0)
    } else if (key.end || (!isMod(key) && !key.meta && input === 'G')) {
      detail?.scrollTo(Math.max(0, detail?.getScrollHeight() ?? 0))
    }
    event.stopImmediatePropagation()
  }
  const onSearchKeys: OverlayKeyHandler = (input, key, plainReturn, event) => {
    // Transcript search bar (less-style): edit the query, Enter commits
    // (query persists for n/N), Esc/ctrl+c cancels back to the anchor.
    if (key.escape || (key.ctrl && input === 'c')) {
      dispatchOverlay({ type: 'close' })
      setHighlight('')
      handle?.scrollTo(searchAnchorRef.current)
    } else if (plainReturn) {
      // Enter commits; 0-match junk queries don't persist.
      if (searchCount === 0) setSearchQuery('')
      dispatchOverlay({ type: 'close' })
    } else if (key.backspace) {
      if (searchCursor > 0) {
        setSearchQuery(searchQuery.slice(0, searchCursor - 1) + searchQuery.slice(searchCursor))
        setSearchCursor(searchCursor - 1)
      }
    } else if (key.delete) {
      if (searchCursor < searchQuery.length) {
        setSearchQuery(searchQuery.slice(0, searchCursor) + searchQuery.slice(searchCursor + 1))
      }
    } else if (key.leftArrow) {
      setSearchCursor(c => Math.max(0, c - 1))
    } else if (key.rightArrow) {
      setSearchCursor(c => Math.min(searchQuery.length, c + 1))
    } else if (key.home) {
      setSearchCursor(0)
    } else if (key.end) {
      setSearchCursor(searchQuery.length)
    } else if (!key.ctrl && !key.meta && !key.super && input) {
      const next = searchQuery.slice(0, searchCursor) + input + searchQuery.slice(searchCursor)
      setSearchQuery(next)
      setSearchCursor(searchCursor + input.length)
    }
    event.stopImmediatePropagation()
  }
  const onThinkingKeys: OverlayKeyHandler = (_input, key, plainReturn, _event) => {
    if (key.upArrow || key.downArrow) {
      dispatchOverlay({ type: 'move', delta: key.upArrow ? -1 : 1, count: 2 })
    } else if (plainReturn) {
      const visible = (overlay as Extract<ChatOverlay, { kind: 'thinking' }>).focus === 0
      setThinkingVisible(visible)
      dispatchOverlay({ type: 'close' })
      channel.notify(t('thinking-toggled', { state: visible ? t('thinking-on') : t('thinking-off') }))
    } else if (key.escape) {
      dispatchOverlay({ type: 'close' })
    }
  }
  const onWorkspaceFlowKeys: OverlayKeyHandler = (input, key, plainReturn, event) => {
    const { flow, busy, input: flowInput } = overlay as Extract<ChatOverlay, { kind: 'workspace-flow' }>
    if (key.escape) {
      if (flowInput !== null && !busy) {
        dispatchOverlay({ type: 'flow-input', input: null })
        return
      }
      workspaceFlowAbortRef.current?.abort()
      workspaceFlowAbortRef.current = null
      workspaceFlowRequestRef.current += 1
      dispatchOverlay({ type: 'close' })
      return
    }
    if (busy) return
    if (flowInput !== null) {
      const choice = flow.choices.find(candidate => candidate.id === flowInput.choiceId)
      const editor = choice?.input
      if (plainReturn) {
        const value = flowInput.value.trim()
        if (value.length === 0) {
          channel.notify(t('workspace-flow-input-empty'), { color: 'warning' })
        } else if (editor !== undefined) {
          runWorkspaceFlowAction(signal => editor.submit(value, signal))
        }
      } else if (key.backspace && flowInput.cursor > 0) {
        dispatchOverlay({
          type: 'flow-input-edit',
          value: flowInput.value.slice(0, flowInput.cursor - 1) + flowInput.value.slice(flowInput.cursor),
          cursor: flowInput.cursor - 1,
        })
      } else if (key.delete && flowInput.cursor < flowInput.value.length) {
        dispatchOverlay({
          type: 'flow-input-edit',
          value: flowInput.value.slice(0, flowInput.cursor) + flowInput.value.slice(flowInput.cursor + 1),
          cursor: flowInput.cursor,
        })
      } else if (key.leftArrow) {
        dispatchOverlay({
          type: 'flow-input-edit',
          value: flowInput.value,
          cursor: Math.max(0, flowInput.cursor - 1),
        })
      } else if (key.rightArrow) {
        dispatchOverlay({
          type: 'flow-input-edit',
          value: flowInput.value,
          cursor: Math.min(flowInput.value.length, flowInput.cursor + 1),
        })
      } else if (input.length > 0 && !key.ctrl && !key.meta && !key.super && !key.tab) {
        dispatchOverlay({
          type: 'flow-input-edit',
          value: flowInput.value.slice(0, flowInput.cursor) + input + flowInput.value.slice(flowInput.cursor),
          cursor: flowInput.cursor + input.length,
        })
      }
      return
    }
    if (pickerNav(dispatchOverlay, event, input, key, flow.choices.length)) {
      // arrows / vim j/k / g-G jumps
    } else if (key.tab && !key.shift) {
      const choice = flow.choices[(overlay as Extract<ChatOverlay, { kind: 'workspace-flow' }>).index]
      if (choice?.input !== undefined) {
        const value = choice.input.initialValue ?? ''
        const flowInputNext: WorkspaceFlowInput = {
          choiceId: choice.id,
          value,
          cursor: value.length,
          ...(choice.input.placeholder === undefined ? {} : { placeholder: choice.input.placeholder }),
        }
        dispatchOverlay({ type: 'flow-input', input: flowInputNext })
      }
    } else if (plainReturn) {
      const choice = flow.choices[(overlay as Extract<ChatOverlay, { kind: 'workspace-flow' }>).index]
      if (choice !== undefined) {
        runWorkspaceFlowAction(signal => choice.choose(signal))
      }
    }
  }
  const onWorkspacePickerKeys: OverlayKeyHandler = (input, key, plainReturn, event) => {
    if (pickerNav(dispatchOverlay, event, input, key, workspaceTargets.length)) {
      // arrows / vim j/k / g-G jumps
    } else if (plainReturn) {
      const target = workspaceTargets[(overlay as Extract<ChatOverlay, { kind: 'workspace-picker' }>).index]
      dispatchOverlay({ type: 'close' })
      if (target !== undefined) void channel.switchWorkspace(target)
    } else if (key.escape) {
      dispatchOverlay({ type: 'close' })
    }
  }
  const onWorkspaceMenuKeys: OverlayKeyHandler = (input, key, plainReturn, event) => {
    const menu = workspaceMenuOptions
    if (pickerNav(dispatchOverlay, event, input, key, menu.length)) {
      // arrows / vim j/k / g-G jumps
    } else if (plainReturn) {
      const option = menu[(overlay as Extract<ChatOverlay, { kind: 'workspace-menu' }>).index]
      runWorkspaceMenuOption(option)
    } else if (key.escape) {
      dispatchOverlay({ type: 'close' })
    }
  }
  const onModelKeys: OverlayKeyHandler = (input, key, plainReturn, event) => {
    // Two-level picker: group rows at the top (Enter drills in), one
    // provider's models below (Enter switches, the same live-fork path as
    // the flat picker always had). Esc/⌫ climbs one level and only closes
    // at the top; a single-group catalog never shows the group level, so
    // Esc there closes directly.
    const rowCount = activeModelGroup === undefined ? modelGroups.length : groupModels.length
    if (pickerNav(dispatchOverlay, event, input, key, rowCount)) {
      // arrows / vim j/k / g-G jumps
    } else if (plainReturn) {
      if (activeModelGroup === undefined) {
        const group = modelGroups[(overlay as Extract<ChatOverlay, { kind: 'model' }>).index]
        if (!group) {
          dispatchOverlay({ type: 'close' })
          return
        }
        setModelGroup(group.provider)
        // The recents group opens on its most-recent entry; a provider
        // group on its current model when it owns one, else its first row.
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
        return
      }
      const model = groupModels[(overlay as Extract<ChatOverlay, { kind: 'model' }>).index]
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- runtime guard: out-of-range index on an empty list
      if (model) {
        // Enter switches the live model right away: the conversation is
        // forked at its end and continued with an agent routed to the new
        // model (history replays unchanged) — and feeds the recents group.
        dispatchOverlay({ type: 'close' })
        void switchModelRecorded(model.provider, model.id, model.name)
      } else {
        dispatchOverlay({ type: 'close' })
      }
    } else if (key.escape || key.backspace) {
      if (activeModelGroup !== undefined && modelGroups.length > 1 && !modelPickerDirect) {
        setModelGroup(undefined)
        const groupIndex = Math.max(0, modelGroups.findIndex(group => group.provider === activeModelGroup))
        dispatchOverlay({ type: 'set-index', kind: 'model', index: groupIndex })
      } else {
        dispatchOverlay({ type: 'close' })
      }
    }
  }
  const onSkillsKeys: OverlayKeyHandler = (input, key, plainReturn, event) => {
    const list = skillsList ?? []
    if (pickerNav(dispatchOverlay, event, input, key, list.length)) {
      // count 0 (snapshot still loading) is a no-op inside the reducer.
    } else if (plainReturn) {
      const skill = list[(overlay as Extract<ChatOverlay, { kind: 'skills' }>).index]
      dispatchOverlay({ type: 'close' })
      // 可直调技能 Enter 填入 `/name `——与 / 菜单选中技能同一条
      // completion-only 分发路径；模型专用技能（userInvocable=false）只关闭。
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- runtime guard: out-of-range index on an empty list
      if (skill?.userInvocable) setHistoryFill(`/${skill.name} `)
    } else if (key.escape) {
      dispatchOverlay({ type: 'close' })
    }
  }
  const onActivityKeys: OverlayKeyHandler = (input, key, plainReturn, event) => {
    if (pickerNav(dispatchOverlay, event, input, key, PRESET_NAMES.length)) {
      // arrows / vim j/k / g-G jumps
    } else if (plainReturn) {
      const name = PRESET_NAMES[(overlay as Extract<ChatOverlay, { kind: 'activity' }>).index]
      dispatchOverlay({ type: 'close' })
      if (name) channel.setActivityFrames(name)
    } else if (key.escape) {
      dispatchOverlay({ type: 'close' })
    }
  }
  const onColorKeys: OverlayKeyHandler = (input, key, plainReturn, event) => {
    if (pickerNav(dispatchOverlay, event, input, key, SESSION_COLOR_NAMES.length)) {
      // arrows / vim j/k / g-G jumps
    } else if (plainReturn) {
      const name = SESSION_COLOR_NAMES[(overlay as Extract<ChatOverlay, { kind: 'color' }>).index]
      dispatchOverlay({ type: 'close' })
      if (name) {
        channel.setSessionColor(name)
        channel.notify(t('color-set', { name }), { color: 'success' })
      }
    } else if (key.escape) {
      dispatchOverlay({ type: 'close' })
    }
  }
  const onEffortKeys: OverlayKeyHandler = (_input, key, plainReturn, _event) => {
    if (key.leftArrow || key.rightArrow) {
      const delta = key.leftArrow ? -1 : 1
      // The same wrap rule the reducer applies — computed here too so the
      // newly focused level is applied in this very keystroke.
      const next = wrapIndex((overlay as Extract<ChatOverlay, { kind: 'effort' }>).index, delta, effortOptions.length)
      dispatchOverlay({ type: 'move', delta, count: effortOptions.length })
      const option = effortOptions[next]
      // Live-apply: the slider IS the control; Esc does not revert.
      if (option) void channel.setEffort(option.id)
    } else if (plainReturn || key.escape) {
      dispatchOverlay({ type: 'close' })
    }
  }
  const onPresetKeys: OverlayKeyHandler = (input, key, plainReturn, event) => {
    if (pickerNav(dispatchOverlay, event, input, key, presetOptions.length)) {
      // arrows / vim j/k / g-G jumps
    } else if (plainReturn) {
      const option = presetOptions[(overlay as Extract<ChatOverlay, { kind: 'preset' }>).index]
      dispatchOverlay({ type: 'close' })
      if (option) void channel.switchPreset(option.id)
    } else if (key.escape) {
      dispatchOverlay({ type: 'close' })
    }
  }
  const onPermissionKeys: OverlayKeyHandler = (_input, key, plainReturn, _event) => {
    if (key.upArrow || key.downArrow) {
      const currentIndex = permissionOverlayFocusRef.current?.overlay === overlay
        ? permissionOverlayFocusRef.current.index
        : (overlay as Extract<ChatOverlay, { kind: 'permission' }>).index
      const nextIndex = wrapIndex(currentIndex, key.upArrow ? -1 : 1, (overlay as Extract<ChatOverlay, { kind: 'permission' }>).snapshot.options.length)
      permissionOverlayFocusRef.current = { overlay, index: nextIndex }
      dispatchOverlay({ type: 'set-index', kind: 'permission', index: nextIndex })
    } else if (plainReturn) {
      const currentIndex = permissionOverlayFocusRef.current?.overlay === overlay
        ? permissionOverlayFocusRef.current.index
        : (overlay as Extract<ChatOverlay, { kind: 'permission' }>).index
      const option = (overlay as Extract<ChatOverlay, { kind: 'permission' }>).snapshot.options[currentIndex]
      permissionOverlayFocusRef.current = null
      dispatchOverlay({ type: 'close' })
      if (option !== undefined) void runPermissionCommand(` ${option.value}`)
    } else if (key.escape) {
      permissionOverlayFocusRef.current = null
      dispatchOverlay({ type: 'close' })
    }
  }
  const onPlanKeys: OverlayKeyHandler = (input, key, plainReturn, event) => {
    if (pickerNav(dispatchOverlay, event, input, key, 2)) {
      // arrows / vim j/k / g-G jumps
    } else if (plainReturn) {
      const on = (overlay as Extract<ChatOverlay, { kind: 'plan' }>).index === 0
      dispatchOverlay({ type: 'close' })
      void runExternalCommand('plan', on ? '' : ' off')
    } else if (key.escape) {
      dispatchOverlay({ type: 'close' })
    }
  }
  const onLangKeys: OverlayKeyHandler = (input, key, plainReturn, event) => {
    if (pickerNav(dispatchOverlay, event, input, key, 2)) {
      // arrows / vim j/k / g-G jumps
    } else if (plainReturn) {
      const lang = LANGS[(overlay as Extract<ChatOverlay, { kind: 'lang' }>).index]
      dispatchOverlay({ type: 'close' })
      if (lang !== undefined) applyLang(lang)
    } else if (key.escape) {
      dispatchOverlay({ type: 'close' })
    }
  }
  const onThemeKeys: OverlayKeyHandler = (input, key, plainReturn, event) => {
    const options = getThemeOptions(themeHost)
    if (pickerNav(dispatchOverlay, event, input, key, options.length)) {
      // arrows / vim j/k / g-G jumps
    } else if (plainReturn) {
      dispatchOverlay({ type: 'close' })
      const name = options[(overlay as Extract<ChatOverlay, { kind: 'theme' }>).index]?.value
      if (name !== undefined) {
        const ok = setTheme(name)
        channel.notify(
          ok ? t('theme-switched-saved', { name }) : t('theme-switch-failed', { name }),
          { color: ok ? 'success' : 'error' },
        )
      }
    } else if (key.escape) {
      dispatchOverlay({ type: 'close' })
    }
  }
  const onHistoryKeys: OverlayKeyHandler = (input, key, plainReturn, _event) => {
    const { query, cursor, focus } = overlay as Extract<ChatOverlay, { kind: 'history' }>
    if (key.escape) {
      dispatchOverlay({ type: 'close' })
    } else if (key.ctrl && (input === 'c' || input === 'd')) {
      // History search cancels on ctrl+c/ctrl+d too.
      dispatchOverlay({ type: 'close' })
    } else if (plainReturn) {
      const entry = historyMatches[focus]
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- runtime guard: out-of-range index on an empty match list
      if (entry) {
        setHistoryFill(entry.text)
        dispatchOverlay({ type: 'close' })
      }
    } else if (key.upArrow) {
      if (historyMatches.length > 0) {
        dispatchOverlay({ type: 'move', delta: -1, count: historyMatches.length })
      }
    } else if (key.downArrow || actionMatches('history', input, key)) {
      // History search next — ↓ and the history key (default Ctrl+R)
      // walk to the next match.
      if (historyMatches.length > 0) {
        dispatchOverlay({ type: 'move', delta: 1, count: historyMatches.length })
      }
    } else if (key.backspace) {
      if (cursor > 0) {
        dispatchOverlay({
          type: 'history-edit',
          query: query.slice(0, cursor - 1) + query.slice(cursor),
          cursor: cursor - 1,
          focus: 0,
        })
      }
    } else if (key.delete) {
      if (cursor < query.length) {
        dispatchOverlay({
          type: 'history-edit',
          query: query.slice(0, cursor) + query.slice(cursor + 1),
          focus: 0,
        })
      }
    } else if (key.leftArrow) {
      // Step by code point, not UTF-16 unit: an emoji is two units, and
      // a mid-pair caret offset would split it in the SearchBox render.
      if (cursor > 0) {
        const ch = [...query.slice(0, cursor)].pop()!
        dispatchOverlay({ type: 'history-edit', cursor: cursor - ch.length })
      }
    } else if (key.rightArrow) {
      if (cursor < query.length) {
        const ch = [...query.slice(cursor)][0]!
        dispatchOverlay({ type: 'history-edit', cursor: cursor + ch.length })
      }
    } else if (key.home) {
      dispatchOverlay({ type: 'history-edit', cursor: 0 })
    } else if (key.end) {
      dispatchOverlay({ type: 'history-edit', cursor: query.length })
    } else if (!key.ctrl && !key.meta && !key.super && input) {
      dispatchOverlay({
        type: 'history-edit',
        query: query.slice(0, cursor) + input + query.slice(cursor),
        cursor: cursor + input.length,
        focus: 0,
      })
    }
  }
  const onRewindKeys: OverlayKeyHandler = (input, key, plainReturn, event) => {
    // While the plugin decision is in flight the picker is read-only;
    // Esc abandons the wait (the stale answer is dropped by the token).
    const rewindOverlay = overlay as Extract<ChatOverlay, { kind: 'rewind' }>
    if (rewindOverlay.busy) {
      if (key.escape) {
        rewindRequestRef.current += 1
        dispatchOverlay({ type: 'rewind-busy', busy: false })
      }
      return
    }
    if (rewindOverlay.confirm !== null) {
      const row = rewindOverlay.confirm
      if (rewindOverlay.modes !== null) {
        // Plugin offered modes: the confirm pane is a choice list —
        // option 0 is always the built-in conversation-only rewind.
        const optionCount = rewindOverlay.modes.length + 1
        if (pickerNav(dispatchOverlay, event, input, key, optionCount)) {
          // arrows / vim j/k / g-G jumps
        } else if (plainReturn) {
          const mode = rewindOverlay.modeIndex === 0 ? null : (rewindOverlay.modes[rewindOverlay.modeIndex - 1]?.id ?? null)
          dispatchOverlay({ type: 'close' })
          void performRewind(row, mode)
        } else if (key.escape) {
          dispatchOverlay({ type: 'rewind-back' })
        }
        return
      }
      // Confirmation state: Enter rewinds, Esc backs out to the list.
      if (plainReturn) {
        dispatchOverlay({ type: 'close' })
        void performRewind(row)
      } else if (key.escape) {
        dispatchOverlay({ type: 'rewind-back' })
      }
    } else if (pickerNav(dispatchOverlay, event, input, key, rewindRows.length)) {
      // arrows / vim j/k / g-G jumps
    } else if (plainReturn) {
      const row = rewindRows[rewindOverlay.index]
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- runtime guard: out-of-range index on an empty list
      if (row) void requestRewindConfirm(row)
    } else if (key.escape) {
      dispatchOverlay({ type: 'close' })
    }
  }
  const onFileActionsKeys: OverlayKeyHandler = (input, key, plainReturn, event) => {
    // Click-to-act file menu: ↑/↓/j/k move, g/G jump, Enter runs the
    // focused action, Esc closes.
    if (pickerNav(dispatchOverlay, event, input, key, FILE_ACTION_COUNT)) {
      // arrows / vim j/k / g-G jumps
    } else if (plainReturn) {
      const path = (overlay as Extract<ChatOverlay, { kind: 'file-actions' }>).path
      dispatchOverlay({ type: 'close' })
      runFileAction((overlay as Extract<ChatOverlay, { kind: 'file-actions' }>).index, path)
    } else if (key.escape) {
      dispatchOverlay({ type: 'close' })
    }
  }

  return {
    'image-preview': onImagePreviewKeys,
    'row-detail': onRowDetailKeys,
    search: onSearchKeys,
    thinking: onThinkingKeys,
    'workspace-flow': onWorkspaceFlowKeys,
    'workspace-picker': onWorkspacePickerKeys,
    'workspace-menu': onWorkspaceMenuKeys,
    model: onModelKeys,
    skills: onSkillsKeys,
    activity: onActivityKeys,
    color: onColorKeys,
    effort: onEffortKeys,
    preset: onPresetKeys,
    permission: onPermissionKeys,
    plan: onPlanKeys,
    lang: onLangKeys,
    theme: onThemeKeys,
    history: onHistoryKeys,
    rewind: onRewindKeys,
    'file-actions': onFileActionsKeys,
  }
}
