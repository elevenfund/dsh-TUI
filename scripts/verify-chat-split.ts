#!/usr/bin/env node
/**
 * 同步单测：chat/ 拆分出的纯模块（selection-mode / input-guard /
 * overlay-keys 的表结构）直接派发按键对象断言 next state —— 无渲染挂载、
 * 无 FakeStdout、无按键节奏 sleep（T0 层：构造即数据）。
 */
import { strict as assert } from 'node:assert'
import { selectionKeyIntent, selectionRestoreTarget, selectionStepId } from '../src/screens/chat/selection-mode.js'
import { inputGuardAction } from '../src/screens/chat/input-guard.js'
import { createOverlayKeyHandlers } from '../src/screens/chat/overlay-keys.js'
import type { Key } from '../src/ink/events/input-event.js'

let failures = 0
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) console.log(`PASS: ${name}`)
  else { failures++; console.log(`FAIL: ${name}${detail ? `  (${detail})` : ''}`) }
}

// ---- Key 构造器：布尔旗标全默认 false，只开需要的 ----
const key = (over: Partial<Key> & { input?: string } = {}): Key => ({
  upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
  pageDown: false, pageUp: false, wheelUp: false, wheelDown: false,
  wheelLeft: false, wheelRight: false, home: false, end: false,
  return: false, escape: false, ctrl: false, shift: false, fn: false,
  tab: false, backspace: false, delete: false, meta: false, super: false,
  ...over,
} as Key)

const selCtx = (over: Partial<Parameters<typeof selectionKeyIntent>[2]> = {}) => ({
  working: false,
  helpOpen: false,
  plainReturn: false,
  selectedId: 7,
  selectedKind: 'tool' as const,
  expanded: false,
  expandedRows: new Set<number>(),
  ...over,
})

// ---- selectionKeyIntent：典型按键序列 ----
check('j → move down', selectionKeyIntent('j', key(), selCtx()).type === 'move' && (selectionKeyIntent('j', key(), selCtx()) as { delta: number }).delta === 1)
check('k → move up', selectionKeyIntent('k', key(), selCtx()).type === 'move' && (selectionKeyIntent('k', key(), selCtx()) as { delta: number }).delta === -1)
check('↓ → move down', selectionKeyIntent('', key({ downArrow: true }), selCtx()).type === 'move')
check('g → jump-top', selectionKeyIntent('g', key(), selCtx()).type === 'jump-top')
check('G（带 shift 旗标）→ jump-bottom', selectionKeyIntent('G', key({ shift: true }), selCtx()).type === 'jump-bottom')
check('G（无 shift 旗标）→ jump-bottom', selectionKeyIntent('G', key(), selCtx()).type === 'jump-bottom')
check('Ctrl+G 不是 G 跳底（被 guard 拦截）', selectionKeyIntent('G', key({ ctrl: true }), selCtx()).type === 'none')
check('Enter → open-detail', selectionKeyIntent('', key({ return: true }), selCtx({ plainReturn: true, selectedId: 7 })).type === 'open-detail')
check('Enter 但 plainReturn=false（双发去抖）→ none', selectionKeyIntent('', key({ return: true }), selCtx({ plainReturn: false })).type === 'none')
check('l 折叠类行未展开 → expand', selectionKeyIntent('l', key(), selCtx()).type === 'expand')
check('l 但全局已展开 → none', selectionKeyIntent('l', key(), selCtx({ expanded: true })).type === 'expand' ? false : true)
check('l 非折叠类行（assistant）→ none', selectionKeyIntent('l', key(), selCtx({ selectedKind: 'assistant' })).type === 'none')
check('h 已展开行 → collapse', selectionKeyIntent('h', key(), selCtx({ expandedRows: new Set([7]) })).type === 'collapse')
check('h 未展开行 → none', selectionKeyIntent('h', key(), selCtx()).type === 'none')
check('Esc → exit', selectionKeyIntent('', key({ escape: true }), selCtx()).type === 'exit')
check('Tab → exit', selectionKeyIntent('\t', key({ tab: true }), selCtx()).type === 'exit')
check('Ctrl+C idle → interrupt-or-exit', selectionKeyIntent('c', key({ ctrl: true }), selCtx()).type === 'interrupt-or-exit')
check('Ctrl+F → page down', selectionKeyIntent('f', key({ ctrl: true }), selCtx()).type === 'page')
check('普通字母 → none', selectionKeyIntent('x', key(), selCtx()).type === 'none')

// ---- selectionRestoreTarget：退出/重进的光标恢复 ----
const rows = [
  { id: 1, kind: 'user', text: 'a' },
  { id: 2, kind: 'assistant', text: 'b' },
  { id: 3, kind: 'user', text: 'c' },
] as never
const isSelectable = (row: { kind: string }) => ['user', 'assistant', 'tool', 'reasoning'].includes(row.kind) as never
check('rows 未变 → 恢复原光标', selectionRestoreTarget(rows, { maxId: 3, count: 3 }, 2, isSelectable) === 2)
check('rows 增多（新回合）→ 追底', selectionRestoreTarget([...rows, { id: 9, kind: 'user', text: 'd' }] as never, { maxId: 3, count: 3 }, 2, isSelectable) === 9)
check('无快照 → 追底', selectionRestoreTarget(rows, null, 2, isSelectable) === 3)
check('无可选行 → null', selectionRestoreTarget([], null, null, isSelectable) === null)

// ---- selectionStepId：单步移动 ----
check('从中间下移', selectionStepId(rows as never, 1, 1) === 2)
check('从中间上移', selectionStepId(rows as never, 2, -1) === 1)
check('末尾下移 → null（不动）', selectionStepId(rows as never, 3, 1) === null)
check('光标 null → null', selectionStepId(rows as never, null, 1) === null)
check('选中项不在列表 → null', selectionStepId(rows as never, 99, 1) === null)

// ---- inputGuardAction：surface 路由 ----
const guardCtx = (over: Partial<Parameters<typeof inputGuardAction>[0]> = {}) => ({
  btwOpen: false, tipsOverlay: false, recapVisible: false,
  treeOpen: false, supervisorOpen: false, settingsOpen: false,
  subagentSurfaces: false, taskCenterSurfaces: false, jobsPanelOpen: false, sceneOpen: false, pluginScene: false,
  helpOpen: false, approvalPending: false, dialogPending: false, questionPending: false,
  questionMinimized: false, isSticky: true, fullscreen: true,
  overlayKind: 'none', workspaceTargetsCount: 0, pageStep: 20,
  isPlainReturn: false, keyEnd: false, wheel: null, page: null,
  ...over,
})
check('空闲无面板 → continue', inputGuardAction(guardCtx()).type === 'continue')
check('btw 打开 → yield', inputGuardAction(guardCtx({ btwOpen: true })).type === 'yield')
check('场景打开 → yield', inputGuardAction(guardCtx({ sceneOpen: true })).type === 'yield')
check('任务中心面板打开 → yield（Esc 留给面板，不打断）', inputGuardAction(guardCtx({ taskCenterSurfaces: true })).type === 'yield')
check('wheel 回落 → scroll -3', inputGuardAction(guardCtx({ wheel: 'up' })).type === 'scroll' && (inputGuardAction(guardCtx({ wheel: 'up' })) as { rows: number }).rows === -3)
check('wheel + 打开的浮窗 → yield', inputGuardAction(guardCtx({ wheel: 'down', overlayKind: 'model' })).type === 'yield')
check('wheel + 目标未落的 picker → 照常滚动', inputGuardAction(guardCtx({ wheel: 'down', overlayKind: 'workspace-picker', workspaceTargetsCount: 0 })).type === 'scroll')
check('全屏 PgUp → scroll -pageStep', inputGuardAction(guardCtx({ page: 'up' })).type === 'scroll' && (inputGuardAction(guardCtx({ page: 'up' })) as { rows: number }).rows === -20)
check('内联 PgUp → continue（终端自己的回滚）', inputGuardAction(guardCtx({ page: 'up', fullscreen: false })).type === 'continue')
check('问卷挂起 → yield', inputGuardAction(guardCtx({ questionPending: true })).type === 'yield')
check('问卷最小化 + 非吸底 + Enter → scroll-bottom', inputGuardAction(guardCtx({ questionPending: true, questionMinimized: true, isSticky: false, isPlainReturn: true })).type === 'scroll-bottom')
check('审批面板 → yield', inputGuardAction(guardCtx({ approvalPending: true })).type === 'yield')

// ---- overlay-keys：表结构完整性（kind 全覆盖、不持状态） ----
const handlers = createOverlayKeyHandlers({
  overlay: { kind: 'none' },
  dispatchOverlay: () => {},
  channel: {} as never,
  handle: null,
  searchAnchorRef: { current: 0 },
  searchQuery: '', searchCount: 0, searchCursor: 0,
  setHighlight: () => {}, setSearchQuery: () => {}, setSearchCursor: () => {},
  setThinkingVisible: () => {}, interruptRunningTurn: () => {},
  rowDetailScrollRef: { current: null },
  workspaceFlowAbortRef: { current: null }, workspaceFlowRequestRef: { current: 0 },
  runWorkspaceFlowAction: () => {},
  workspaceTargets: [], workspaceMenuOptions: [], runWorkspaceMenuOption: () => {},
  activeModelGroup: undefined, modelGroups: [], groupModels: [],
  setModelGroup: () => {}, models: [], switchModelRecorded: async () => false, modelPickerDirect: false,
  skillsList: null, setHistoryFill: () => {},
  effortOptions: [], presetOptions: [],
  permissionOverlayFocusRef: { current: null }, runPermissionCommand: async () => true,
  runExternalCommand: async () => false, applyLang: () => {}, themeHost: undefined, setTheme: () => false,
  historyMatches: [], rewindRequestRef: { current: 0 }, performRewind: async () => {},
  rewindRows: [], requestRewindConfirm: async () => {}, runFileAction: () => {},
})
const expectedKinds = ['image-preview', 'row-detail', 'search', 'thinking', 'workspace-flow', 'workspace-picker', 'workspace-menu', 'model', 'skills', 'activity', 'color', 'effort', 'preset', 'permission', 'plan', 'lang', 'theme', 'history', 'rewind', 'file-actions']
check('overlay 键位表 20 个 kind 全注册', expectedKinds.every(k => typeof handlers[k as keyof typeof handlers] === 'function'),
  `missing: ${expectedKinds.filter(k => typeof handlers[k as keyof typeof handlers] !== 'function').join(',')}`)

// 一个行为级断言：image-preview 的 Esc 走 dispatchOverlay close（无渲染直接派发）
{
  let closed = false
  const h = createOverlayKeyHandlers({
    overlay: { kind: 'image-preview', image: { id: 'i', width: 1, height: 1, name: 'x' } },
    dispatchOverlay: (action) => { if (action.type === 'close') closed = true },
    channel: {} as never,
    handle: null,
    searchAnchorRef: { current: 0 },
    searchQuery: '', searchCount: 0, searchCursor: 0,
    setHighlight: () => {}, setSearchQuery: () => {}, setSearchCursor: () => {},
    setThinkingVisible: () => {}, interruptRunningTurn: () => {},
    rowDetailScrollRef: { current: null },
    workspaceFlowAbortRef: { current: null }, workspaceFlowRequestRef: { current: 0 },
    runWorkspaceFlowAction: () => {},
    workspaceTargets: [], workspaceMenuOptions: [], runWorkspaceMenuOption: () => {},
    activeModelGroup: undefined, modelGroups: [], groupModels: [],
    setModelGroup: () => {}, models: [], switchModelRecorded: async () => false, modelPickerDirect: false,
    skillsList: null, setHistoryFill: () => {},
    effortOptions: [], presetOptions: [],
    permissionOverlayFocusRef: { current: null }, runPermissionCommand: async () => true,
    runExternalCommand: async () => false, applyLang: () => {}, themeHost: undefined, setTheme: () => false,
    historyMatches: [], rewindRequestRef: { current: 0 }, performRewind: async () => {},
    rewindRows: [], requestRewindConfirm: async () => {}, runFileAction: () => {},
  })
  let stopped = false
  ;(h['image-preview'] as unknown as (a: string, k: Key, pr: boolean, e: { stopImmediatePropagation(): void }) => void)('', key({ escape: true }), false, { stopImmediatePropagation: () => { stopped = true } })
  check('image-preview Esc → close + stop', closed && stopped)
}

if (failures > 0) {
  console.error(`\nverify-chat-split: ${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nverify-chat-split: all checks passed')
