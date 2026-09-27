import React from 'react'
import { t } from '../../i18n.js'
import type { ChannelUi } from '../../adapter/channel/ui-policy.js'
import type { LlmModelInfo, LlmProviderInfo } from '../../adapter/ports/channel-view.js'
import { readModelRecents, recordModelUse, type ModelRecentsRef } from '../../modelRecents.js'
import { RECENTS_GROUP_PROVIDER, deriveModelGroups, recentCatalogModels } from '../../modelGroups.js'

/**
 * /model picker state: catalog + provider identities, the recents group,
 * the two-level drill (group → provider, with the single-provider fast
 * path), and the record-on-switch path every switch rides. Extracted
 * verbatim from Chat.
 */
export function useModelPicker(channel: ChannelUi) {
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
  return {
    models,
    setModels,
    providerInfos,
    setProviderInfos,
    modelRecents,
    setModelRecents,
    modelGroup,
    setModelGroup,
    modelPickerDirect,
    setModelPickerDirect,
    modelGroups,
    activeModelGroup,
    groupModels,
    switchModelRecorded,
  }
}
