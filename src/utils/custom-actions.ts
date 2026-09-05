import type { Config } from "@/types/config/config"
import type { ProvidersConfig } from "@/types/config/provider"
import type {
  SelectionToolbarBuiltInActionState,
  SelectionToolbarCustomAction,
} from "@/types/config/selection-toolbar"
import { createDefaultDictionaryAction } from "@/utils/constants/config"
import { BUILT_IN_DICTIONARY_ACTION_ID } from "@/utils/constants/custom-action"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import { getUniqueName } from "@/utils/name"
import {
  doesProviderSupportsCapability,
  getProviderIdsForCapability,
} from "@/utils/providers/provider-registry"

type SelectionToolbarConfig = Config["selectionToolbar"]

export function getBuiltInDictionaryAction(
  selectionToolbar: SelectionToolbarConfig,
): SelectionToolbarCustomAction {
  const definition = createDefaultDictionaryAction()
  if (!definition) {
    throw new Error("Built-in Dictionary action definition is unavailable")
  }

  const state = selectionToolbar.builtInActions?.dictionary ?? {
    enabled: definition.enabled !== false,
    providerId: definition.providerId,
  }
  return {
    ...definition,
    enabled: state.enabled,
    providerId: state.providerId,
    ...(state.notebaseConnection ? { notebaseConnection: state.notebaseConnection } : {}),
  }
}

export function getSelectionToolbarActions(
  selectionToolbar: SelectionToolbarConfig,
): SelectionToolbarCustomAction[] {
  return [getBuiltInDictionaryAction(selectionToolbar), ...selectionToolbar.customActions]
}

export function findSelectionToolbarAction(
  selectionToolbar: SelectionToolbarConfig,
  actionId: string,
): SelectionToolbarCustomAction | undefined {
  if (actionId === BUILT_IN_DICTIONARY_ACTION_ID) {
    return getBuiltInDictionaryAction(selectionToolbar)
  }
  return selectionToolbar.customActions.find((action) => action.id === actionId)
}

export function resolveNoteSuggestionAction(
  selectionToolbar: SelectionToolbarConfig,
): SelectionToolbarCustomAction {
  const actionId = selectionToolbar.noteSuggestion.actionId
  const action = findSelectionToolbarAction(selectionToolbar, actionId)
  if (!action) {
    throw new Error(
      `Note suggestion action "${actionId}" is missing from the validated configuration.`,
    )
  }
  return action
}

function toBuiltInDictionaryState(
  action: SelectionToolbarCustomAction,
): SelectionToolbarBuiltInActionState {
  return {
    enabled: action.enabled !== false,
    providerId: action.providerId,
    ...(action.notebaseConnection ? { notebaseConnection: action.notebaseConnection } : {}),
  }
}

export function replaceSelectionToolbarAction(
  selectionToolbar: SelectionToolbarConfig,
  action: SelectionToolbarCustomAction,
): SelectionToolbarConfig {
  if (action.id === BUILT_IN_DICTIONARY_ACTION_ID) {
    return {
      ...selectionToolbar,
      builtInActions: {
        ...selectionToolbar.builtInActions,
        dictionary: toBuiltInDictionaryState(action),
      },
    }
  }

  return {
    ...selectionToolbar,
    customActions: selectionToolbar.customActions.map((current) =>
      current.id === action.id ? action : current,
    ),
  }
}

export function patchSelectionToolbarAction(
  selectionToolbar: SelectionToolbarConfig,
  actionId: string,
  patch: Partial<
    Pick<SelectionToolbarCustomAction, "enabled" | "providerId" | "notebaseConnection">
  >,
): SelectionToolbarConfig {
  const action = findSelectionToolbarAction(selectionToolbar, actionId)
  if (!action) {
    return selectionToolbar
  }

  return replaceSelectionToolbarAction(selectionToolbar, { ...action, ...patch })
}

/**
 * 复制一个动作成为新的自定义动作。
 *
 * providersConfig 传进来是为了给供应商兜底：内置词典允许挂纯翻译引擎（免密钥，
 * 见 resolveDictionaryProviderRef），但**普通自定义动作不行**——它靠 systemPrompt
 * 做结构化抽取，脱离大模型跑不动，schema 也会拒绝。
 *
 * 不兜底的后果是真实存在的 bug：全新安装时词典默认挂 Microsoft Translate，
 * 用户点「自定义」把它复制成自定义动作，写配置时 schema 校验失败抛错，
 * 按钮看起来毫无反应。这里在复制时就把供应商换成可用的大模型。
 */
export function duplicateSelectionToolbarAction(
  action: SelectionToolbarCustomAction,
  allActions: SelectionToolbarCustomAction[],
  providersConfig?: ProvidersConfig,
): SelectionToolbarCustomAction {
  const duplicated = {
    ...structuredClone(action),
    id: getRandomUUID(),
    name: getUniqueName(action.name, new Set(allActions.map((candidate) => candidate.name))),
  }

  if (
    providersConfig &&
    !doesProviderSupportsCapability("customAction", providersConfig, duplicated.providerId, {
      requireEnable: true,
    })
  ) {
    const fallback = getProviderIdsForCapability("customAction", providersConfig, {
      requireEnable: true,
    })[0]
    if (fallback) {
      duplicated.providerId = fallback
    }
  }

  return duplicated
}
