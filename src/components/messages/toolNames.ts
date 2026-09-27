import { t, type I18nKey } from '../../i18n.js'

/** Tool display names localize through the `tool-name-*` dictionary family
 *  (i18n.ts): DSH emits lowercase tool ids (`bash`), display names resolve
 *  per language — proper nouns (Bash, PowerShell) stay identical in zh.
 *  Unmapped ids (plugins, new upstream tools) fall back to the id with its
 *  first letter uppercased: that is a name, not copy — there is nothing to
 *  translate. Keys appear as literals here, so verify-i18n's dead-key scan
 *  sees them without a DYNAMIC_PREFIXES entry. Shared by the transcript
 *  tool card (AssistantToolUseMessage) and the selection-mode detail card
 *  (RowDetailOverlay) so both surfaces show the same name. */
const TOOL_NAME_KEYS: Record<string, I18nKey> = {
  bash: 'tool-name-bash',
  powershell: 'tool-name-powershell',
  read: 'tool-name-read',
  glob: 'tool-name-glob',
  grep: 'tool-name-grep',
  write: 'tool-name-write',
  edit: 'tool-name-edit',
  todo_write: 'tool-name-todo_write',
  subagent: 'tool-name-subagent',
  web_search: 'tool-name-web_search',
}

export function toolDisplayName(name: string): string {
  const key = TOOL_NAME_KEYS[name]
  if (key !== undefined) return t(key)
  if (name.length === 0) return name
  return name[0]!.toUpperCase() + name.slice(1)
}
