import type React from 'react'
import { Box, Text } from '../../ui.js'
import { EditorButton } from '../PromptEditor.js'
import { t } from '../../i18n.js'
import type { ClickEvent } from '../../ink/events/click-event.js'
import type { DragEvent } from '../../ink/events/drag-event.js'

/**
 * The fullscreen draft editor subtree, extracted verbatim from
 * PromptInput.tsx's `editorNode`: title row, gutter+text area with the full
 * pointer-protocol wiring, vim status row, and the action buttons. Every
 * binding the inline JSX closed over arrives as a same-named prop, so the
 * body reads exactly as it did inline.
 */
type ExpandedEditorProps = {
  value: string
  cursor: number
  promptAccent: React.ComponentProps<typeof Text>['color']
  editorGutterCols: number
  editorRows: React.ReactNode
  vimEnabled: boolean
  vimInsert: boolean
  valueBoxRef: React.ComponentProps<typeof Box>['ref']
  editorViewportRef: React.RefObject<{ maxRows: number; total: number } | null>
  editorFreeScrollRef: React.RefObject<boolean>
  expandedScrollRef: React.RefObject<number>
  setExpandedTick: React.Dispatch<React.SetStateAction<number>>
  cursorLine: (text: string, cursorOffset: number) => number
  cursorColumn: (text: string, cursorOffset: number) => number
  submitFromEditor: () => void
  collapseEditor: () => void
  handleValueClick: (e: ClickEvent, colOffset?: number) => void
  handleDragStart: (e: DragEvent, colOffset?: number) => void
  handleDragMove: (e: DragEvent, colOffset?: number) => void
  handleDragEnd: () => void
}

export function ExpandedEditor(props: ExpandedEditorProps): React.ReactElement {
  const {
    value, cursor, promptAccent, editorGutterCols, editorRows,
    vimEnabled, vimInsert, valueBoxRef, editorViewportRef, editorFreeScrollRef,
    expandedScrollRef, setExpandedTick, cursorLine, cursorColumn,
    submitFromEditor, collapseEditor,
    handleValueClick, handleDragStart, handleDragMove, handleDragEnd,
  } = props
  return (
    <Box
      flexDirection="column"
      width="100%"
      height="100%"
      borderStyle="round"
      borderColor={promptAccent}
      backgroundColor="toolCardBackground"
    >
      {/* 标题行：编辑图标 + 标题 · 右侧实时统计 */}
      <Box flexDirection="row" flexShrink={0} paddingLeft={1} paddingRight={1}>
        <Text bold color={promptAccent}>{`✎ ${t('input-expand-editor-title')}`}</Text>
        <Box flexGrow={1} />
        <Text dimColor>
          {t('input-fold-stats', {
            lines: value.split('\n').length,
            chars: value.length,
          })}
        </Text>
      </Box>
      {/* 编辑区：行号槽 + 全套选区/caret 高亮，点击定位/拖选/双击选词。
          坐标换算：localCol 相对 Box 外缘（含 paddingLeft），故偏移 =
          padding 1 + 行号槽宽（见 handleValueClick 的 colOffset）。滚轮走
          位置路由（onWheel），驱动展开态自己的滚动窗口。 */}
      <Box
        ref={valueBoxRef}
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        paddingLeft={1}
        paddingRight={1}
        onClick={(event) => {
          handleValueClick(event, editorGutterCols + 1)
        }}
        onDragStart={(event) => {
          handleDragStart(event, editorGutterCols + 1)
        }}
        onDragMove={(event) => {
          handleDragMove(event, editorGutterCols + 1)
        }}
        onDragEnd={handleDragEnd}
        onWheel={(event) => {
          const viewport = editorViewportRef.current
          if (!viewport) return
          editorFreeScrollRef.current = true
          const max = Math.max(0, viewport.total - viewport.maxRows)
          expandedScrollRef.current = Math.max(
            0,
            Math.min(expandedScrollRef.current + Math.round(event.deltaY), max),
          )
          setExpandedTick(tick => tick + 1)
        }}
      >
        {editorRows}
      </Box>
      {/* 状态行：vim 徽标 · 行列 · 右侧键位提示 */}
      <Box flexDirection="row" flexShrink={0} paddingLeft={1} paddingRight={1}>
        {vimEnabled && (
          <Text bold color={vimInsert ? 'success' : 'warning'}>
            {vimInsert ? 'INSERT' : 'NORMAL'}{' '}
          </Text>
        )}
        <Text dimColor>
          {t('input-expand-editor-position', {
            line: cursorLine(value, cursor) + 1,
            col: cursorColumn(value, cursor) + 1,
          })}
        </Text>
        <Box flexGrow={1} />
        <Text dimColor>
          {`${t('input-expand-editor-hint-send')} · ${t('input-expand-editor-hint-collapse')}`}
        </Text>
      </Box>
      {/* 按钮行：主操作发送（accent 填充）+ 次操作收起，均可点击/hover */}
      <Box flexDirection="row" flexShrink={0} paddingLeft={1} paddingRight={1} columnGap={1}>
        <EditorButton
          label={`⏎ ${t('input-expand-editor-send')}`}
          hint="Ctrl+Enter"
          primary
          accent={promptAccent}
          onClick={submitFromEditor}
        />
        <EditorButton
          label={t('input-expand-editor-collapse')}
          hint="Esc"
          onClick={collapseEditor}
        />
        <Box flexGrow={1} />
        <Text dimColor>{t('input-expand-editor-scroll')}</Text>
      </Box>
    </Box>
  )
}
