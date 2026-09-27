import React from 'react'
import { t } from '../../i18n.js'
import type { ChannelUi } from '../../adapter/channel/ui-policy.js'
import type { ChatOverlayAction } from '../chatOverlay.js'
import type { TuiWorkspaceCommandResult, TuiWorkspaceTarget } from '../../workspaces.js'

/**
 * /workspace command family: the bare menu, the resolver/open paths, the
 * extension flow runner (with its monotonic request token + abort
 * controller), and the result router (target switch vs. choices flow vs.
 * empty). Extracted verbatim from Chat.
 */
export function useWorkspaceCommands(
  channel: ChannelUi,
  dispatchOverlay: (action: ChatOverlayAction) => void,
  setWorkspaceTargets: (targets: readonly TuiWorkspaceTarget[]) => void,
) {
  const workspaceFlowRequestRef = React.useRef(0)
  const workspaceFlowAbortRef = React.useRef<AbortController | null>(null)

  const handleWorkspaceResult = (result: TuiWorkspaceCommandResult): void => {
    workspaceFlowAbortRef.current = null
    if (result.kind === 'target') {
      dispatchOverlay({ type: 'close-if', kind: 'workspace-flow' })
      void channel.switchWorkspace(result.target)
      return
    }
    if (result.choices.length === 0) {
      dispatchOverlay({ type: 'close-if', kind: 'workspace-flow' })
      channel.notify(t('workspace-command-empty'))
      return
    }
    // open-if: 'workspace-flow' stays allowed so an in-flow action can
    // transition to its next stage; a picker the user opened after leaving
    // the menu wins over a late command result.
    dispatchOverlay({
      type: 'open-if',
      overlay: { kind: 'workspace-flow', flow: result, index: 0, busy: false, input: null },
      when: ['none', 'workspace-flow'],
    })
  }

  const runWorkspaceFlowAction = (
    action: (signal: AbortSignal) => Promise<TuiWorkspaceCommandResult> | TuiWorkspaceCommandResult,
  ): void => {
    const request = ++workspaceFlowRequestRef.current
    const controller = new AbortController()
    workspaceFlowAbortRef.current = controller
    dispatchOverlay({ type: 'flow-busy', busy: true })
    void Promise.resolve()
      .then(() => action(controller.signal))
      .then((result) => {
        if (request === workspaceFlowRequestRef.current) handleWorkspaceResult(result)
      })
      .catch((error: unknown) => {
        if (request !== workspaceFlowRequestRef.current) return
        workspaceFlowAbortRef.current = null
        dispatchOverlay({ type: 'flow-busy', busy: false })
        channel.notify(
          t('workspace-command-failed', { err: error instanceof Error ? error.message : String(error) }),
          { color: 'error', timeoutMs: 8000 },
        )
      })
  }

  /** Bare `/workspace` menu rows: built-in subcommands first, then the
   *  dynamically registered extensions (same reserved-name filter the Tab
   *  completion applies). Recomputed per render — the extension list is
   *  live. */
  const workspaceMenuOptions: ReadonlyArray<{ id: string; label: string; description: string }> = [
    { id: 'resume', label: 'resume', description: t('workspace-menu-resume-desc') },
    { id: 'rename', label: 'rename', description: t('workspace-menu-rename-desc') },
    { id: 'open', label: 'open', description: t('workspace-menu-open-desc') },
    // Optional call: verify/repro scripts and embedders stub the channel
    // without the workspace-commands API — render must not throw for them
    // (a thrown render unmounts the whole Ink root).
    ...(channel.workspaceCommands?.() ?? [])
      .filter(command => !['resume', 'rename', 'open'].includes(command.name.toLowerCase()))
      .map(command => ({ id: command.name, label: command.name, description: command.description })),
  ]

  const openWorkspaceTarget = (reference: string): void => {
    void channel.resolveWorkspace(reference).then((target) => {
      if (target === undefined) {
        channel.notify(t('workspace-uri-invalid', { uri: reference }), { color: 'error', timeoutMs: 8000 })
        return
      }
      void channel.switchWorkspace(target)
    }).catch((error: unknown) => {
      channel.notify(
        t('workspace-uri-failed', { err: error instanceof Error ? error.message : String(error) }),
        { color: 'error', timeoutMs: 8000 },
      )
    })
  }

  const openWorkspaceResume = (): void => {
    void channel.listWorkspaces().then((targets) => {
      if (targets.length === 0) {
        channel.notify(t('workspace-none'))
        return
      }
      setWorkspaceTargets(targets)
      // open-if: the listing is async — whatever the user opened meanwhile wins.
      dispatchOverlay({
        type: 'open-if',
        overlay: {
          kind: 'workspace-picker',
          index: Math.max(0, targets.findIndex(target => target.cwd === channel.cwd)),
        },
        when: ['none'],
      })
    }).catch((error: unknown) => {
      channel.notify(
        t('workspace-list-failed', { err: error instanceof Error ? error.message : String(error) }),
        { color: 'error' },
      )
    })
  }

  /**
   * Run one /workspace menu row (Enter path, shared with the mouse click):
   * built-ins dispatch locally, extension commands go through the channel.
   */
  const runWorkspaceMenuOption = (option: { id: string } | undefined): void => {
    dispatchOverlay({ type: 'close-if', kind: 'workspace-menu' })
    if (option === undefined) return
    if (option.id === 'resume') {
      openWorkspaceResume()
    } else if (option.id === 'rename') {
      channel.notify(t('workspace-rename-usage'))
    } else if (option.id === 'open') {
      channel.notify(t('workspace-open-usage'))
    } else {
      void channel.runWorkspaceCommand(option.id, '').then((result) => {
        if (result !== undefined) handleWorkspaceResult(result)
      }).catch((error: unknown) => {
        channel.notify(
          t('workspace-command-failed', { err: error instanceof Error ? error.message : String(error) }),
          { color: 'error', timeoutMs: 8000 },
        )
      })
    }
  }

  return {
    handleWorkspaceResult,
    workspaceFlowAbortRef,
    workspaceFlowRequestRef,
    runWorkspaceFlowAction,
    workspaceMenuOptions,
    openWorkspaceTarget,
    openWorkspaceResume,
    runWorkspaceMenuOption,
  }
}
