import React from 'react'
import { t as ti18n, getLang, isLang, readLangPref, type Lang } from '../../i18n.js'
import { readThemePref } from '../../themePrefs.js'
import { readPresetPref } from '../../presetPrefs.js'
import { readModelPref } from '../../modelPrefs.js'
import { readActivityFrames } from '../../activityPrefs.js'
import { envThemeOverride } from '../../components/design-system/ThemeProvider.js'
import { hasPath } from '../../dsh-adapter/settingsEditor.js'
import { modLabel } from '../../utils/modifiers.js'
import { formatTokens } from '../../terminal-utils/format.js'
import { modelPickerLanding } from '../../modelGroups.js'
import { recordModelUse } from '../../modelRecents.js'
import { runProviderWizard } from '../../dsh-adapter/providerWizard.js'
import { ThemePicker, getThemeOptions } from '../../components/ThemePicker.js'
import { AUTO_THEME_NAME, getAutoThemeBase } from '../../theme.js'
import { FRAME_PRESETS, PRESET_NAMES } from '../../components/activityFrames.js'
import { isValidSessionColor, SESSION_COLOR_NAMES } from '../../terminal-utils/sessionColors.js'
import instances from '../../ink/instances.js'
import { planReload, type ReloadKind } from '../../reload.js'
import type { ChannelUi } from '../../adapter/channel/ui-policy.js'
import type { ChatOverlayAction } from '../chatOverlay.js'
import type { SkillInfo, ComposerImageRef, PermissionPresetSnapshot, PresetOption, EffortOption } from '../../dsh-adapter/channel.js'
import type { LlmModelInfo, LlmProviderInfo } from '../../adapter/ports/channel-view.js'
import type { TuiWorkspaceCommandResult } from '../../workspaces.js'
import type { TuiThemeHost } from '../../dsh-adapter/themes.js'
import type { ModelRecentsRef } from '../../modelRecents.js'
import type { QuestionStore } from '../../dsh-adapter/questions.js'
import type { PromptController } from '../../components/PromptInput.js'
import { formatLoadedContextReport } from '../../utils/loaded-context.js'
import type { ScrollBoxHandle } from '../../ui.js'

/** `max` → `Max` (effort levels arrive lower-case from the adapter). */
function capitalize(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1)
}

type BtwState = { question: string; answer: string; error?: string; done: boolean }
type RecapState = {
  raw: string
  summary: string
  title?: string
  error?: string
  done: boolean
  titleApplied: boolean
  auto?: boolean
  expanded?: boolean
  rowsAtTrigger?: number
}

/** Everything runCommand closes over, passed fresh each render. */
export interface RunCommandDeps {
  channel: ChannelUi
  t: typeof ti18n
  dispatchOverlay: (action: ChatOverlayAction) => void
  handle: ScrollBoxHandle | null
  expanded: boolean
  models: readonly LlmModelInfo[]
  applyLang: (lang: 'zh' | 'en') => void
  backgroundToAgentView: () => void
  btwAbortRef: React.RefObject<AbortController | null>
  handleWorkspaceResult: (result: TuiWorkspaceCommandResult) => void
  openScene: () => void
  openWorkspaceResume: () => void
  openWorkspaceTarget: (reference: string) => void
  promptControllerRef: React.RefObject<PromptController | null>
  runBalance: () => void
  runExternalCommand: (name: string, rawInput: string, images?: readonly ComposerImageRef[]) => Promise<boolean>
  setBtw: React.Dispatch<React.SetStateAction<BtwState | null>>
  setExpanded: React.Dispatch<React.SetStateAction<boolean>>
  setExpandedRows: React.Dispatch<React.SetStateAction<ReadonlySet<number>>>
  setHelpOpen: React.Dispatch<React.SetStateAction<boolean>>
  setHistoryFill: React.Dispatch<React.SetStateAction<string | null>>
  setJobsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  setLoadedContextOpen: React.Dispatch<React.SetStateAction<boolean>>
  setModelGroup: React.Dispatch<React.SetStateAction<string | undefined>>
  setModelPickerDirect: React.Dispatch<React.SetStateAction<boolean>>
  setRecap: React.Dispatch<React.SetStateAction<RecapState | null>>
  setSelectedId: React.Dispatch<React.SetStateAction<number | null>>
  setSelectionActive: React.Dispatch<React.SetStateAction<boolean>>
  setSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>
  setShowAllMessages: React.Dispatch<React.SetStateAction<boolean>>
  setSkillsList: React.Dispatch<React.SetStateAction<readonly SkillInfo[] | null>>
  setStreamViewToggledRows: React.Dispatch<React.SetStateAction<ReadonlySet<number>>>
  setSupervisorOpen: React.Dispatch<React.SetStateAction<boolean>>
  setTheme: (name: string) => boolean
  setTreeOpen: React.Dispatch<React.SetStateAction<boolean>>
  switchModelRecorded: (provider: string, id: string, name?: string) => Promise<boolean>
  themeName: string
  themeHost: TuiThemeHost | undefined
  thinkingVisible: boolean
  questionStore: QuestionStore
  onUpdate: undefined | (() => void)
  onRestart: undefined | (() => void)
  onExit: () => void
  modelRecents: readonly ModelRecentsRef[]
  setModelRecents: React.Dispatch<React.SetStateAction<readonly ModelRecentsRef[]>>
  setModels: React.Dispatch<React.SetStateAction<readonly LlmModelInfo[]>>
  setProviderInfos: React.Dispatch<React.SetStateAction<readonly LlmProviderInfo[]>>
  setPresetOptions: React.Dispatch<React.SetStateAction<readonly PresetOption[]>>
  setEffortOptions: React.Dispatch<React.SetStateAction<readonly EffortOption[]>>
  presetOptions: readonly PresetOption[]
  setLogoNonce: React.Dispatch<React.SetStateAction<number>>
  suppressLogoIntroRef: React.RefObject<boolean>
  recapAbortRef: React.RefObject<AbortController | null>
  agentViewOpenSessionRef: React.RefObject<string | undefined>
  runPermissionCommand: (rawInput: string, images?: readonly ComposerImageRef[]) => Promise<boolean>
  openRewind: () => void
}

/**
 * The slash-command dispatcher: every built-in /command's local switch lives
 * here (plugin commands still route through runExternalCommand). Extracted
 * verbatim from Chat behind an explicit deps object.
 */
function clonePermissionPresetSnapshot(snapshot: PermissionPresetSnapshot): PermissionPresetSnapshot {
  return {
    availability: snapshot.availability,
    options: snapshot.options.map(option => ({ ...option })),
    ...(snapshot.current === undefined ? {} : { current: { ...snapshot.current } }),
  }
}

export function createRunCommand(deps: RunCommandDeps) {
  const {
    channel, t, dispatchOverlay, handle, expanded, models,
    applyLang, backgroundToAgentView, btwAbortRef, handleWorkspaceResult,
    openScene, openWorkspaceResume, openWorkspaceTarget, promptControllerRef,
    runBalance, runExternalCommand,
    setBtw, setExpanded, setExpandedRows, setHelpOpen, setHistoryFill,
    setJobsPanelOpen, setLoadedContextOpen, setModelGroup, setModelPickerDirect,
    setRecap, setSelectedId, setSelectionActive, setSettingsOpen,
    setShowAllMessages, setSkillsList, setStreamViewToggledRows,
    setSupervisorOpen, setTheme, setTreeOpen, switchModelRecorded,
    themeName, themeHost, thinkingVisible, questionStore,
    onUpdate, onRestart, onExit,
    modelRecents, setModelRecents, setModels, setProviderInfos,
    setPresetOptions, setEffortOptions, presetOptions,
    setLogoNonce, suppressLogoIntroRef, recapAbortRef, agentViewOpenSessionRef,
    runPermissionCommand, openRewind,
  } = deps
  /** Localized label of one /reload surface, for the change report. */
  const reloadKindLabel = (kind: ReloadKind): string => {
    switch (kind) {
      case 'theme': return t('reload-kind-theme')
      case 'lang': return t('reload-kind-lang')
      case 'preset': return t('reload-kind-preset')
      case 'model': return t('reload-kind-model')
      case 'activity': return t('reload-kind-activity')
    }
  }

  const runCommand = (
    name: string,
    rawInput = '',
    images: readonly ComposerImageRef[] = [],
  ): boolean | Promise<boolean> => {
    switch (name) {
      case 'activity': {
        // Ported from the pi working-activity extension: bare `/activity`
        // opens the interactive indicator picker; `/activity frames <name>`
        // switches directly; `/activity frames` lists presets; `/activity
        // status` shows the current choice. The choice persists to
        // ~/.dsh-tui/working-activity.json and survives restarts.
        const parts = rawInput.trim().split(/\s+/).filter(Boolean)
        if (parts[0] === 'status') {
          setHelpOpen(false)
          channel.pushLocal('/activity', [
            t('activity-current-preset', { name: channel.activityFrames ?? 'moon8' }),
            t('activity-switch-hint'),
            t('activity-persist-hint'),
          ])
          return true
        }
        if (parts[0] === 'frames') {
          setHelpOpen(false)
          if (parts[1]) {
            channel.setActivityFrames(parts[1].toLowerCase())
            return true
          }
          const current = channel.activityFrames
          channel.pushLocal('/activity', [
            t('activity-current-direct', { name: current ?? 'moon8' }),
            ...PRESET_NAMES.map(name =>
              `${name.padEnd(10)} ${name === 'random' ? t('activity-random-each') : FRAME_PRESETS[name].frames.slice(0, 5).join(' ')}${name === current ? t('activity-current-marker') : ''}`,
            ),
          ])
          return true
        }
        if (parts.length > 0) {
          channel.notify(t('activity-usage'), { color: 'warning' })
          return true
        }
        setHelpOpen(false)
        dispatchOverlay({
          type: 'open',
          overlay: {
            kind: 'activity',
            index: Math.max(0, PRESET_NAMES.indexOf(channel.activityFrames ?? 'random')),
          },
        })
        return true
      }
      case 'preset': {
        // issue #8: bare `/preset` opens the roster picker (standard/ptc/
        // minimal/cordis plus any user-authored presets); `/preset <id>`
        // switches directly; `/preset status` shows the current choice. A
        // blank session swaps composition in place (official blank-only
        // rule); a started session is locked and the choice persists as the
        // default for future sessions (~/.dsh-tui/agent-preset.json).
        const parts = rawInput.trim().split(/\s+/).filter(Boolean)
        if (parts[0] === 'status') {
          setHelpOpen(false)
          channel.pushLocal('/preset', [
            t('preset-current', { name: channel.agentPreset ?? t('preset-roster-missing') }),
            t('preset-switch-hint'),
            t('preset-persist-hint'),
            t('preset-lock-hint'),
          ])
          return true
        }
        if (parts.length > 0) {
          setHelpOpen(false)
          void channel.switchPreset(parts[0])
          return true
        }
        setHelpOpen(false)
        // The picker opens immediately over the cached roster (no loading
        // pane — deliberate contrast with /model); the fresh list lands with
        // the authoritative focus. Both loader writes are kind-guarded, so a
        // picker the user already left is not resurrected or re-focused.
        dispatchOverlay({
          type: 'open',
          overlay: {
            kind: 'preset',
            index: Math.max(0, presetOptions.findIndex(preset => preset.id === channel.agentPreset)),
          },
        })
        void channel.listPresets().then((list) => {
          if (list.length === 0) {
            dispatchOverlay({ type: 'close-if', kind: 'preset' })
            channel.notify(t('preset-roster-unmounted'), { color: 'warning' })
            return
          }
          setPresetOptions(list)
          const index = list.findIndex(preset => preset.id === channel.agentPreset)
          dispatchOverlay({ type: 'set-index', kind: 'preset', index: index >= 0 ? index : 0 })
        })
        return true
      }
      case 'effort': {
        // Bare `/effort` opens the rheostat slider over the live route's
        // adapter levels (←/→ applies each step immediately); `/effort <id>`
        // sets directly (validated by the channel); `/effort status` prints
        // the current level. The choice persists to ~/.dsh-tui/effort.json.
        const parts = rawInput.trim().split(/\s+/).filter(Boolean)
        if (parts[0] === 'status') {
          setHelpOpen(false)
          channel.pushLocal('/effort', [
            t('effort-current', { name: channel.reasoningEffort ?? '—' }),
            t('effort-usage'),
          ])
          return true
        }
        if (parts.length > 0) {
          setHelpOpen(false)
          void channel.setEffort(parts[0])
          return true
        }
        setHelpOpen(false)
        void channel.listEfforts().then(({ efforts, defaultEffort }) => {
          // 0/1-tier routes were already notified by listEfforts.
          if (efforts.length <= 1) return
          setEffortOptions(efforts)
          const current = channel.reasoningEffort ?? defaultEffort
          const index = efforts.findIndex(effort => effort.id === current)
          // open-if: a picker the user opened during the round trip wins
          // over this late-arriving slider.
          dispatchOverlay({
            type: 'open-if',
            overlay: { kind: 'effort', index: index >= 0 ? index : 0 },
            when: ['none'],
          })
        })
        return true
      }
      case 'lang': {
        // `/lang` shows the current UI language, `/lang en|zh` switches
        // (hot-swap, persisted to ~/.dsh-tui/lang.json), bare `/lang` opens
        // the en/zh picker. Precedence on next launch: DSH_TUI_LANG >
        // settings.yaml `dsh-tui.lang` > cordis.yml `lang` > the persisted
        // choice.
        const parts = rawInput.trim().split(/\s+/).filter(Boolean)
        if (parts[0] === 'status') {
          setHelpOpen(false)
          channel.pushLocal('/lang', [
            t('lang-current', { lang: getLang() }),
            t('lang-switch-hint'),
            t('lang-persist-hint'),
          ])
          return true
        }
        if (parts.length > 0) {
          setHelpOpen(false)
          if (isLang(parts[0])) {
            applyLang(parts[0])
          } else {
            channel.notify(t('lang-unknown', { lang: parts[0] }), { color: 'error' })
          }
          return true
        }
        setHelpOpen(false)
        dispatchOverlay({
          type: 'open',
          overlay: { kind: 'lang', index: getLang() === 'zh' ? 0 : 1 },
        })
        return true
      }
      case 'theme': {
        // Bare `/theme` opens the interactive color picker (`auto` + built-in
        // palettes + static/runtime themes); `/theme <name>`
        // switches directly; `/theme status` shows the current choice.
        // `auto` follows the terminal background (OSC 11). Selection
        // persists to ~/.dsh-tui/theme.json and hot swaps via the
        // ThemeProvider setter (DSH_TUI_THEME still wins on next launch).
        const parts = rawInput.trim().split(/\s+/).filter(Boolean)
        if (parts[0] === 'status') {
          setHelpOpen(false)
          channel.pushLocal('/theme', [
            t('theme-current', { name: themeName }),
            // `auto` resolves through terminal-background detection; show
            // which palette it currently maps to.
            ...(themeName === AUTO_THEME_NAME
              ? [t('theme-auto-resolved', { name: getAutoThemeBase() })]
              : []),
            t('theme-switch-hint'),
            t('theme-persist-hint'),
            t('theme-custom-hint'),
          ])
          return true
        }
        if (parts.length > 0) {
          setHelpOpen(false)
          // setTheme rejects unknown names via isThemeAvailable, so pass the
          // raw argument instead of resolving it against the catalog first.
          const ok = setTheme(parts[0])
          channel.notify(
            ok ? t('theme-switched-saved', { name: parts[0] }) : t('theme-unknown', { name: parts[0] }),
            { color: ok ? 'success' : 'error' },
          )
          return true
        }
        setHelpOpen(false)
        dispatchOverlay({
          type: 'open',
          overlay: {
            kind: 'theme',
            index: Math.max(0, getThemeOptions(themeHost).findIndex(option => option.value === themeName)),
          },
        })
        return true
      }
      case 'color': {
        // `/color`（按会话持久化的 accent）：无参打开调色板选择器，
        // `/color <name>` 直接设置，`/color status` 显示当前，`/color
        // reset` 清除回主题默认。颜色经 `session/color` 事件按会话保存
        // ——resume/rewind 后仍是这个会话自己的颜色（见 channel.ts）。
        setHelpOpen(false)
        const parts = rawInput.trim().split(/\s+/).filter(Boolean)
        if (parts.length === 0) {
          dispatchOverlay({
            type: 'open',
            overlay: {
              kind: 'color',
              index: Math.max(0, SESSION_COLOR_NAMES.indexOf(channel.sessionColor)),
            },
          })
          return true
        }
        if (parts[0] === 'status') {
          channel.pushLocal('/color', [
            channel.sessionColor === ''
              ? t('color-current-none')
              : t('color-current', { name: channel.sessionColor }),
            t('color-usage', { list: SESSION_COLOR_NAMES.join('/') }),
          ])
          return true
        }
        if (parts[0] === 'reset') {
          channel.setSessionColor('')
          channel.notify(t('color-reset'))
          return true
        }
        const colorName = parts[0]!.toLowerCase()
        if (!isValidSessionColor(colorName)) {
          channel.notify(
            t('color-unknown', { name: colorName, list: SESSION_COLOR_NAMES.join(' · ') }),
            { color: 'error' },
          )
          return true
        }
        channel.setSessionColor(colorName)
        channel.notify(t('color-set', { name: colorName }), { color: 'success' })
        return true
      }
      case 'new': {
        // One-shot `/new` (issue #25): the old session stays persisted and
        // is recoverable via /resume, so discarding the live view is
        // non-destructive — no second confirmation is required.
        setHelpOpen(false)
        void channel.newSession().then((ok) => {
          if (!ok) return
          // A new session is a fresh terminal page, not merely an emptied
          // transcript. Reset view-local state, return the ScrollBox to the
          // top, then clear native scrollback and repaint the whale homepage.
          setExpanded(false)
          setExpandedRows(new Set())
          setStreamViewToggledRows(new Set())
          setSelectedId(null)
          setSelectionActive(false)
          setShowAllMessages(false)
          setLoadedContextOpen(false)
          handle?.scrollTo(0)
          channel.notify(t('new-session-started'))
          const ink = instances.get(process.stdout) ?? instances.values().next().value
          // Wait one task so React commits the empty transcript/homepage tree;
          // clearing before that would immediately repaint the old session.
          setTimeout(() => {
            handle?.scrollTo(0)
            ink?.clearScrollbackAndRedraw()
          }, 0)
        })
        return true
      }
      case 'clear':
        channel.clear()
        // channel.clear() resets row ids to 0; stale expanded/selection
        // state would mis-highlight fresh rows (known-limitation fix).
        setExpandedRows(new Set())
        setStreamViewToggledRows(new Set())
        setSelectedId(null)
        setSelectionActive(false)
        return true
      case 'compact':
        channel.compact()
        return true
      case 'trace':
        // `/trace` is kept as the discoverable spelling of Ctrl+T: the
        // command menu is where a user finds out the trajectory exists.
        setHelpOpen(false)
        openScene()
        return true
      case 'context': {
        setHelpOpen(false)
        const context = channel.loadedContext
        if (context === undefined) {
          channel.notify(t('context-unavailable'), { color: 'warning' })
          return true
        }
        channel.pushLocal('/context', formatLoadedContextReport(context))
        return true
      }
      case 'help':
        setHelpOpen(true)
        return true
      case 'model': {
        // `/model <provider/model>` switches directly (same live-fork path
        // as the picker's Enter), bare `/model` opens the picker.
        const parts = rawInput.trim().split(/\s+/).filter(Boolean)
        if (parts.length > 0) {
          setHelpOpen(false)
          const spec = parts[0]!
          const slash = spec.indexOf('/')
          const provider = slash >= 0 ? spec.slice(0, slash) : undefined
          const id = slash >= 0 ? spec.slice(slash + 1) : spec
          if (provider === undefined || id.length === 0 || provider.length === 0) {
            channel.notify(t('model-usage'), { color: 'warning' })
            return true
          }
          void channel.listModels().then((list) => {
            const model = list.find(m => m.provider === provider && m.id === id)
            if (model === undefined) {
              channel.notify(t('model-unknown', { spec }), { color: 'error', timeoutMs: 8000 })
              return
            }
            void switchModelRecorded(provider, id, model.name)
          })
          return true
        }
        setHelpOpen(false)
        // Opens over the cached catalog (empty cache shows the loading
        // pane); the fresh list lands with the authoritative focus, and the
        // kind-guarded set-index cannot re-focus a picker the user left.
        // Seed-on-open: the model in use IS a use — recording it here means
        // the recents group exists before the first post-update switch, and
        // switching A→B keeps A in the list (the file records what was
        // used, not only switches made after the file appeared).
        let recentsNow = modelRecents
        if (channel.provider !== '' && channel.model !== ''
          && !recentsNow.some(ref => ref.provider === channel.provider && ref.id === channel.model)) {
          recentsNow = recordModelUse({ provider: channel.provider, id: channel.model })
          setModelRecents(recentsNow)
        }
        // Two-level landing: recents (when catalogued) focus their pinned
        // row; else multi-provider catalogs focus the current provider's
        // group row; a single-provider catalog without a meaningful recents
        // list drills straight into its model list (pre-grouping UX).
        {
          const landing = modelPickerLanding(models, channel.provider, channel.model, recentsNow)
          setModelGroup(landing.group)
          setModelPickerDirect(landing.group !== undefined)
          dispatchOverlay({ type: 'open', overlay: { kind: 'model', index: landing.index } })
        }
        void channel.listModels().then((list) => {
          setModels(list)
          const landing = modelPickerLanding(list, channel.provider, channel.model, recentsNow)
          setModelGroup(landing.group)
          setModelPickerDirect(landing.group !== undefined)
          dispatchOverlay({ type: 'set-index', kind: 'model', index: landing.index })
        })
        void channel.listProviders().then(setProviderInfos).catch(() => setProviderInfos([]))
        return true
      }
      case 'skills': {
        // issue #204: 列出当前 agent 的完整技能目录（名称 + 来源 + 简述），
        // Enter 把可直调技能以 `/name ` 填回输入行（completion-only 分发的
        // 同一路径）。注册表读取走 channel（快照 scoped 到 live agent）。
        // `/skills <name>` 直达同一个填回动作，跳过选择器。
        const parts = rawInput.trim().split(/\s+/).filter(Boolean)
        if (parts.length > 0) {
          setHelpOpen(false)
          void channel.listSkills().then((list) => {
            if (list === undefined) {
              channel.notify(t('skills-load-failed'), { color: 'error' })
              return
            }
            const skill = list.find(s => s.name === parts[0])
            if (skill === undefined) {
              channel.notify(t('skills-unknown', { name: parts[0] }), { color: 'error' })
              return
            }
            if (skill.userInvocable) setHistoryFill(`/${skill.name} `)
            else channel.notify(t('skills-not-invocable', { name: parts[0] }), { color: 'warning' })
          })
          return true
        }
        setHelpOpen(false)
        setSkillsList(null)
        dispatchOverlay({ type: 'open', overlay: { kind: 'skills', index: 0 } })
        void channel.listSkills().then((list) => {
          if (list === undefined) {
            dispatchOverlay({ type: 'close-if', kind: 'skills' })
            channel.notify(t('skills-load-failed'), { color: 'error' })
            return
          }
          setSkillsList(list)
        })
        return true
      }
      case 'provider': {
        // Interactive add-provider wizard (/provider): drives the shared
        // question panel, persists profile + key via the channel's settings/
        // credentials seams. No picker state — AskUserQuestionPanel renders it.
        setHelpOpen(false)
        const host = channel.providerSetup()
        if (!host) {
          channel.notify(t('provider-unavailable'), { color: 'warning', timeoutMs: 8000 })
          return true
        }
        void runProviderWizard({
          host,
          ask: (request, options) => questionStore.ask(request, options),
          notify: (text, options) => channel.notify(text, options),
          pushLocal: (title, lines) => channel.pushLocal(title, lines),
          working: () => channel.working,
          switchModel: (provider, model) => switchModelRecorded(provider, model),
        }).then((outcome) => {
          // A catalog-changing outcome invalidates every cached model surface
          // so `/model` (picker + completion) reflects it immediately — the
          // same consistency the picker's per-open refetch provides, minus
          // the stale flash on the next open. The wizard's live-switch branch
          // already dropped the completion cache via switchModelRecorded;
          // this covers keep-current, add, edit, delete and OAuth login/logout.
          if (outcome === 'added' || outcome === 'updated'
            || outcome === 'deleted' || outcome === 'signed-out') {
            channel.invalidateModelCompletion()
            void channel.listModels().then(setModels)
            void channel.listProviders().then(setProviderInfos).catch(() => setProviderInfos([]))
          }
        }).catch(() => {
          // The wizard notifies on every handled failure; this only swallows
          // an unexpected reject so it never surfaces as an unhandled promise.
        })
        return true
      }
      case 'thinking':
        setHelpOpen(false)
        dispatchOverlay({
          type: 'open',
          overlay: { kind: 'thinking', focus: thinkingVisible ? 0 : 1 },
        })
        return true
      case 'tokens': {
        const usage = t('tokens-usage', { in: formatTokens(channel.tokens.input), out: formatTokens(channel.tokens.output) })
        if (channel.contextWindow === undefined) {
          channel.notify(usage)
        } else {
          const percent = Math.max(
            0,
            Math.min(100, Math.round((channel.tokens.input / channel.contextWindow) * 100)),
          )
          channel.notify(t('tokens-usage-context', { usage, percent }))
        }
        return true
      }
      case 'resume':
      /**
       * `/resume`, `/home` and `/agentview` are one screen.
       *
       * They were three implementations of one domain and drifted apart: the
       * same session could be listed by all three, each with its own selection
       * model and its own idea of what opening one does. Keeping the three
       * commands is about muscle memory, not about three surfaces — every one
       * of them lands here, on the same runtime.
       */
      case 'home':
      case 'agentview': {
        setHelpOpen(false)
        // The screen opens immediately and loads its own list. Waiting for the
        // listing here would make it feel slower the more history a project
        // has, which is exactly backwards.
        agentViewOpenSessionRef.current = channel.agentId
        setSupervisorOpen(true)
        return true
      }
      case 'bg':
      case 'background': {
        // `/background`: the attached session moves to the background
        // (it keeps running in this process), the terminal lands on a fresh
        // session, and the supervisor opens on top.
        setHelpOpen(false)
        backgroundToAgentView()
        return true
      }
      case 'workspace': {
        setHelpOpen(false)
        const trimmed = rawInput.trim()
        const separator = trimmed.search(/\s/u)
        const subcommand = (separator < 0 ? trimmed : trimmed.slice(0, separator)).toLowerCase()
        const input = separator < 0 ? '' : trimmed.slice(separator).trim()
        if (subcommand === '') {
          // Bare `/workspace` opens the action menu (resume / rename / open
          // plus any registered extensions) instead of a text usage line.
          dispatchOverlay({ type: 'open', overlay: { kind: 'workspace-menu', index: 0 } })
        } else if (subcommand === 'resume') {
          openWorkspaceResume()
        } else if (subcommand === 'rename') {
          if (input.length === 0) channel.notify(t('workspace-rename-usage'))
          else void channel.renameWorkspace(input)
        } else if (subcommand === 'open') {
          if (input.length === 0) channel.notify(t('workspace-open-usage'))
          else openWorkspaceTarget(input)
        } else if (channel.workspaceCommands().some(command =>
          command.name.toLowerCase() === subcommand
          || command.aliases?.some(alias => alias.toLowerCase() === subcommand))) {
          void channel.runWorkspaceCommand(subcommand, input).then((result) => {
            if (result !== undefined) handleWorkspaceResult(result)
          }).catch((error: unknown) => {
            channel.notify(
              t('workspace-command-failed', { err: error instanceof Error ? error.message : String(error) }),
              { color: 'error', timeoutMs: 8000 },
            )
          })
        } else {
          channel.notify(t('workspace-command-unknown', { command: subcommand }), { color: 'error' })
        }
        return true
      }
      case 'rename': {
        setHelpOpen(false)
        const title = rawInput.trim()
        if (title.length === 0) {
          channel.pushLocal('/rename', [
            t('rename-current', { title: channel.sessionTitle || '—' }),
            t('rename-usage'),
          ])
          return true
        }
        channel.renameSession(title)
        channel.notify(t('rename-done', { title }))
        return true
      }
      case 'rewind':
        // Same picker as PromptInput's double-Esc on an empty input;
        // `openRewind` notifies when there is nothing to rewind.
        setHelpOpen(false)
        openRewind()
        return true
      case 'tree': {
        // The session family tree (pi's Session Tree): every fork branch
        // stitched back, hover previews, per-node rewind/fork/adopt.
        setHelpOpen(false)
        setTreeOpen(true)
        return true
      }
      case 'fork': {
        // Tip fork (kimi-code semantics): a persisted copy of the whole
        // conversation the user enters via /resume — the live session and
        // its running turn stay untouched.
        setHelpOpen(false)
        void channel.forkSession()
        return true
      }
      case 'exit':
      case 'quit':
      case 'q':
        onExit()
        return true
      case 'status': {
        const usage = channel.lastUsage
        const pct =
          channel.contextWindow === undefined
            ? undefined
            : Math.max(0, Math.min(100, Math.round((channel.tokens.input / channel.contextWindow) * 100)))
        const lines: string[] = [
          `${t('status-model', { model: channel.model })}${channel.reasoningEffort ? ` · ${capitalize(channel.reasoningEffort)} effort` : ''}`,
          `${t('status-state', { state: channel.working ? t('status-working') : t('status-idle') })}`,
          `${t('status-session', { id: channel.agentId })}`,
          `${t('status-dir', { cwd: channel.displayCwd })}${channel.gitBranch ? ` · ${channel.gitBranch}` : ''}`,
          `Tokens ${formatTokens(channel.tokens.input)} in → ${formatTokens(channel.tokens.output)} out`,
        ]
        if (usage !== undefined) {
          const total = usage.input + usage.cacheRead + usage.cacheWrite
          const rate = total > 0 ? ((usage.cacheRead / total) * 100).toFixed(1) : '0.0'
          lines.push(t('cost-cache-rate', { rate, read: formatTokens(usage.cacheRead), write: formatTokens(usage.cacheWrite) }))
        }
        if (pct !== undefined) lines.push(t('cost-context', { pct }))
        if (channel.sessionTitle) lines.push(t('status-title', { title: channel.sessionTitle }))
        setHelpOpen(false)
        channel.pushLocal('/status', lines)
        return true
      }
      case 'cost': {
        const usage = channel.lastUsage
        const lines = [
          `Tokens ${formatTokens(channel.tokens.input)} in → ${formatTokens(channel.tokens.output)} out`,
        ]
        if (usage !== undefined) {
          const total = usage.input + usage.cacheRead + usage.cacheWrite
          const rate = total > 0 ? ((usage.cacheRead / total) * 100).toFixed(1) : '0.0'
          lines.push(t('cost-cache-hit-rate', { rate, read: formatTokens(usage.cacheRead), write: formatTokens(usage.cacheWrite) }))
        }
        lines.push(t('cost-note'))
        setHelpOpen(false)
        channel.pushLocal('/cost', lines)
        return true
      }
      case 'balance': {
        // DeepSeek official account balance (free read-only endpoint): the
        // channel resolves DEEPSEEK_API_KEY through the credentials seam and
        // queries api.deepseek.com/user/balance. The result renders as the
        // interactive BalanceReportRow (hover for details, click to refresh).
        setHelpOpen(false)
        runBalance()
        return true
      }
      case 'settings': {
        // Plugin settings screen (issue #165): opens immediately; the screen
        // reads sections + namespaces from the channel itself.
        setHelpOpen(false)
        setSettingsOpen(true)
        return true
      }
      case 'config': {
        const userHome = process.env.USERPROFILE ?? ''
        const lines = [
          t('doctor-example-config', { path: 'dsh --profile dsh-tui' }),
          t('doctor-user-config', { path: `${userHome}/.dsh/profiles/dsh-tui/cordis.patch.yml` }),
          '',
          t('doctor-launch-hint'),
          t('doctor-route-hint'),
        ]
        setHelpOpen(false)
        channel.pushLocal('/config', lines)
        return true
      }
      case 'doctor':
        setHelpOpen(false)
        channel.pushLocal('/doctor', channel.doctorInfo())
        return true
      case 'plugins':
        // Plugin diagnostics (C-070): trust banner first, then descriptor /
        // grant matrix / ledger tail — or validate+negotiate for
        // `/plugins check <path>` (rawInput carries the subcommand).
        setHelpOpen(false)
        channel.pushLocal('/plugins', channel.pluginsInfo(rawInput))
        return true
      case 'export': {
        const target = channel.exportSession()
        channel.notify(
          target === null
            ? t('export-failed')
            : t('export-saved', { target }),
          target === null ? { color: 'error', timeoutMs: 8000 } : { timeoutMs: 8000 },
        )
        return true
      }
      case 'init': {
        const result = channel.initWorkspace()
        if (result === null) channel.notify(t('agentsmd-create-failed'), { color: 'error' })
        else if (result === 'exists') channel.notify(t('agentsmd-exists'))
        else channel.notify(t('agentsmd-created', { result }))
        return true
      }
      case 'jobs':
        setHelpOpen(false)
        setJobsPanelOpen(true)
        return true
      case 'agents':
        setHelpOpen(false)
        void channel.listSubagents().then((lines) => {
          channel.pushLocal('/agents', lines)
        })
        return true
      case 'login': {
        setHelpOpen(false)
        void channel.describeCredential('DEEPSEEK_API_KEY')
          .catch(() => undefined)
          .then(async status => {
            const keyStatus = status === undefined
              ? t('login-credentials-unavailable')
              : status.configured
                ? t('login-key-configured', { ref: 'DEEPSEEK_API_KEY' })
                : t('login-key-missing')
            // OAuth account states ride along only while a dsh-auth-style
            // plugin is mounted; absent it the lines below are exactly the
            // pre-plugin set.
            const oauth = await channel.oauthProviderStatuses().catch(() => undefined)
            channel.pushLocal('/login', [
              t('login-api-key', { status: keyStatus }),
              ...(status === undefined
                ? []
                : [
                    t('login-credential-source', { source: status.source ?? t('login-source-none') }),
                    t('login-credential-storage', {
                      mode: t(status.writable ? 'login-storage-writable' : 'login-storage-read-only'),
                    }),
                  ]),
              t('login-base-url', { url: process.env.DEEPSEEK_BASE_URL ?? t('login-official-endpoint') }),
              ...(oauth === undefined
                ? []
                : [
                    t('login-oauth-heading'),
                    ...oauth.map(row => t('login-oauth-row', {
                      provider: row.provider,
                      state: row.signedIn
                        ? t('login-oauth-in', { time: new Date(row.expiresAt ?? 0).toISOString() })
                        : row.expired
                          ? t('login-oauth-expired')
                          : t('login-oauth-signed-out'),
                    })),
                    t('login-oauth-hint'),
                  ]),
            ])
          })
        return true
      }
      case 'logout':
        channel.notify(t('login-logout-hint'))
        return true
      case 'permission': {
        // The command itself is registered by the permission-presets row
        // (dsh-base): bare `/permission` opens the preset picker and Enter
        // dispatches `/permission <preset>`; `/permission status` prints the
        // policy explainer; other arguments pass through verbatim.
        // The row may be mounted as a service without its command ever
        // reaching this agent's registry (composition-dependent) — when the
        // service snapshot is usable the TUI still owns the entry and
        // switches through the service write path (never the model).
        const mounted = channel.commandList.some(command => command.external && command.name === 'permission')
        let serviceUsable = false
        try {
          serviceUsable = channel.permissionPresets().availability === 'runtime'
        } catch {
          serviceUsable = false
        }
        const reachable = mounted || serviceUsable
        const parts = rawInput.trim().split(/\s+/).filter(Boolean)
        if (reachable && parts[0] === 'status') {
          setHelpOpen(false)
          const snapshot = channel.permissionPresets()
          if (snapshot.options.some(option => option.value === 'status')) {
            return runPermissionCommand(rawInput, images)
          }
          const currentName = snapshot.availability === 'unavailable'
            ? t('permission-roster-unavailable')
            : snapshot.current?.name ?? '—'
          channel.pushLocal('/permission', [
            t('permission-current', { name: currentName }),
            t('permission-policy-hint'),
            t('permission-approval-hint'),
            t('permission-root-hint', { cwd: channel.cwd }),
            t('permission-path-hint'),
          ])
          return true
        }
        if (reachable && parts.length === 0) {
          setHelpOpen(false)
          const snapshot = channel.permissionPresets()
          if (snapshot.availability === 'unavailable' || snapshot.options.length === 0) {
            return runPermissionCommand(rawInput, images)
          }
          const currentValue = snapshot.current?.kind === 'preset' ? snapshot.current.value : undefined
          const currentIndex = currentValue === undefined
            ? -1
            : snapshot.options.findIndex(option => option.value === currentValue)
          const index = currentIndex >= 0
            ? currentIndex
            : Math.min(1, snapshot.options.length - 1)
          dispatchOverlay({
            type: 'open',
            overlay: {
              kind: 'permission',
              index,
              snapshot: clonePermissionPresetSnapshot(snapshot),
            },
          })
          return true
        }
        if (reachable) {
          setHelpOpen(false)
          return runPermissionCommand(rawInput, images)
        }
        return false
      }
      case 'plan': {
        // Registered by dsh-plan-mode: bare `/plan` opens an on/off picker
        // marked with the current state instead of toggling blindly; Enter
        // dispatches `/plan` or `/plan off`. Arguments pass through verbatim
        // (`/plan off`), and an unmounted row falls back to the default
        // external path.
        const mounted = channel.commandList.some(command => command.external && command.name === 'plan')
        const parts = rawInput.trim().split(/\s+/).filter(Boolean)
        if (mounted && parts.length === 0) {
          setHelpOpen(false)
          dispatchOverlay({
            type: 'open',
            overlay: { kind: 'plan', index: channel.mode.plan === true ? 0 : 1 },
          })
          return true
        }
        if (mounted) {
          setHelpOpen(false)
          return runExternalCommand('plan', rawInput, images)
        }
        return false
      }
      case 'add-dir':
        setHelpOpen(false)
        channel.pushLocal('/add-dir', [
          t('permission-root-hint', { cwd: channel.cwd }),
          t('permission-path-hint'),
        ])
        return true
      case 'hooks':
        setHelpOpen(false)
        channel.pushLocal('/hooks', [
          t('hooks-not-mounted'),
          t('hooks-mount-hint'),
        ])
        return true
      case 'mcp':
        setHelpOpen(false)
        channel.pushLocal('/mcp', channel.mcpStatus())
        return true
      case 'update':
        setHelpOpen(false)
        if (onUpdate === undefined) {
          channel.notify(t('update-unavailable'), { color: 'warning' })
        } else if (channel.working) {
          channel.notify(t('update-working'), { color: 'warning' })
        } else {
          channel.notify(t('update-starting'))
          onUpdate()
        }
        return true
      case 'reload': {
        // pi-style soft reload: re-read the persisted preference files
        // (~/.dsh-tui/{theme,lang,agent-preset,model,working-activity}.json)
        // and re-apply live, honoring the boot-time precedence (env >
        // cordis.yml > settings user layer > pref). The dsh-tui settings
        // namespace is NOT re-read here — its watch applies edits live and
        // the platform watcher hot-reloads settings.yaml itself. What no
        // reload can re-read (cordis.yml root config, frozen fullscreen,
        // newly built code) is listed in the footer and served by /restart.
        setHelpOpen(false)
        const tuiNamespace = channel.settingsHost()
          ?.listNamespaces()
          .find(entry => entry.ns === 'dsh-tui')
        const plan = planReload({
          envTheme: envThemeOverride(),
          envLang: isLang(process.env.DSH_TUI_LANG) ? process.env.DSH_TUI_LANG : undefined,
          themePref: readThemePref(),
          currentTheme: themeName,
          langPref: readLangPref(),
          currentLang: getLang(),
          langOverriddenBySettings: tuiNamespace !== undefined && hasPath(tuiNamespace.user, ['lang']),
          configuredLang: channel.configuredLang,
          configuredPreset: channel.configuredPreset,
          presetPref: readPresetPref(),
          currentPreset: channel.agentPreset,
          configuredModel: {
            provider: channel.configuredProvider,
            model: channel.configuredModel,
          },
          modelPref: readModelPref(),
          currentModel: { provider: channel.provider, model: channel.model },
          configuredActivity: channel.configuredActivityFrames,
          activityPref: readActivityFrames(),
          currentActivity: channel.activityFrames,
        })
        for (const item of plan.apply) {
          switch (item.kind) {
            case 'theme':
              setTheme(item.to)
              break
            case 'lang':
              applyLang(item.to as Lang)
              break
            case 'preset':
              void channel.switchPreset(item.to)
              break
            case 'model':
              if (item.route !== undefined) {
                void switchModelRecorded(item.route.provider, item.route.model)
              }
              break
            case 'activity':
              channel.setActivityFrames(item.to)
              break
          }
        }
        const lines = [t('reload-header')]
        for (const item of plan.apply) {
          lines.push(t('reload-applied', {
            kind: reloadKindLabel(item.kind),
            from: item.from,
            to: item.to,
          }))
        }
        for (const kind of plan.unchanged) {
          lines.push(t('reload-unchanged', { kind: reloadKindLabel(kind) }))
        }
        for (const skip of plan.skipped) {
          const key = skip.reason === 'env-wins'
            ? 'reload-skipped-env'
            : skip.reason === 'config-wins' ? 'reload-skipped-config' : 'reload-skipped-invalid'
          lines.push(t(key, { kind: reloadKindLabel(skip.kind) }))
        }
        lines.push(t('reload-footer'))
        channel.pushLocal('/reload', lines)
        return true
      }
      case 'restart':
        // pi-style reload tail: /reload cannot re-read boot-time-only state
        // (cordis.yml root config, frozen fullscreen layout, newly built
        // code), so /restart respawns the process with the original argv and
        // resumes this session — the /update handoff minus the pnpm step.
        setHelpOpen(false)
        if (onRestart === undefined) {
          channel.notify(t('restart-unavailable'), { color: 'warning' })
        } else if (channel.working) {
          channel.notify(t('update-working'), { color: 'warning' })
        } else {
          channel.notify(t('restart-starting'))
          onRestart()
        }
        return true
      case 'vim': {
        // `/vim`：切换输入框的 vim 编辑开关。状态在
        // PromptInput 内部（controllerRef.toggleVim），每次切换落回 insert
        // 子模式；Esc 进 normal、i/a/o 回 insert。会话级、不持久化。
        setHelpOpen(false)
        const on = promptControllerRef.current?.toggleVim() ?? false
        channel.notify(t(on ? 'vim-on' : 'vim-off'))
        return true
      }
      case 'terminal-setup':
        setHelpOpen(false)
        channel.pushLocal('/terminal-setup', [
          t('terminal-setup-hint'),
          t('terminal-paste-hint', { mod: modLabel }),
        ])
        return true
      case 'recap': {
        // `/recap`（pi-recap 语义）：对会话最近活动做一次无工具单轮
        // 调用，生成一行摘要 + 建议标题。摘要是纯 UI 状态（不进 transcript
        // 也不进 session log）；建议标题经「应用」按钮走 /rename 路径。
        setHelpOpen(false)
        recapAbortRef.current?.abort()
        const controller = new AbortController()
        recapAbortRef.current = controller
        setRecap({ raw: '', summary: '', error: undefined, done: false, titleApplied: false, auto: false, expanded: true })
        void channel.recapRecent({
          signal: controller.signal,
          onText: delta => setRecap(prev => (prev ? { ...prev, raw: prev.raw + delta } : prev)),
        }).then(result => {
          if (controller.signal.aborted) return
          setRecap(prev => (prev
            ? {
                ...prev,
                summary: result.summary ?? prev.raw,
                title: result.title,
                error: result.error,
                done: true,
              }
            : prev))
        }).catch(error => {
          if (controller.signal.aborted) return
          setRecap(prev => prev ? { ...prev, error: error instanceof Error ? error.message : String(error), done: true } : prev)
        })
        return true
      }
      case 'btw': {
        // `/btw`：单轮无工具侧问，overlay 态纯 UI，不打断主回合、不写
        // 会话历史。空参数只提示用法。
        setHelpOpen(false)
        const question = rawInput.trim()
        if (!question) {
          channel.notify(t('btw-usage'), { timeoutMs: 3000 })
          return true
        }
        btwAbortRef.current?.abort()
        const controller = new AbortController()
        btwAbortRef.current = controller
        setBtw({ question, answer: '', done: false })
        void channel.sideQuestion(question, {
          signal: controller.signal,
          onText: delta => setBtw(prev => (prev ? { ...prev, answer: prev.answer + delta } : prev)),
        }).then(result => {
          if (controller.signal.aborted) return
          setBtw(prev => (prev ? { ...prev, answer: result.answer ?? prev.answer, error: result.error, done: true } : prev))
        }).catch(error => {
          if (controller.signal.aborted) return
          setBtw(prev => prev ? { ...prev, error: error instanceof Error ? error.message : String(error), done: true } : prev)
        })
        return true
      }
      case 'deepseek': {
        // Hidden easter egg: replay the logo header's whale spout + text
        // shimmer. The command is intentionally not in the suggestion/help
        // catalogs; PromptInput recognizes it through HIDDEN_COMMAND_NAMES.
        setHelpOpen(false)
        suppressLogoIntroRef.current = false
        setLogoNonce(n => n + 1)
        // Bring the logo back into view if the transcript has scrolled.
        setTimeout(() => {
          handle?.scrollTo(0)
        }, 0)
        return true
      }
      case 'tips':
        setHelpOpen(false)
        dispatchOverlay({ type: 'open', overlay: { kind: 'tips' } })
        return true
      case 'connect':
        setHelpOpen(false)
        channel.pushLocal('/connect', [t('connect-none')])
        return true
      default: {
        // Plugin-registered command (DSH command registry): dispatch through
        // the channel, whose execution logs command/run + command/done (the
        // plan-mode projection folds those records, so /plan state stays
        // consistent). Unknown names fall through to the model.
        const external = channel.commandList.find(
          command => command.external && command.name === name,
        )
        if (external) {
          setHelpOpen(false)
          return runExternalCommand(name, rawInput, images)
        }
        return false
      }
    }
  }
  return runCommand
}
