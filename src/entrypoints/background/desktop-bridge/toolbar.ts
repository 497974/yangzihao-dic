/**
 * 桌面版划词工具栏要显示哪些按钮——和网页划词工具栏同一份设置（设置 → 划词工具栏）：
 * 翻译、朗读开没开，以及所有启用的动作（内置词典 + 用户自己加的）。
 * 顺序也和网页一致：翻译、朗读、各个动作。
 */

import type { Config } from "@/types/config/config"
import { BUILT_IN_DICTIONARY_ACTION_ID } from "@/utils/constants/custom-action"
import { getSelectionToolbarActions } from "@/utils/custom-actions"
import { ensureInitializedConfig } from "../config"

export interface DesktopToolbarAction {
  id: string
  name: string
  /** Iconify 图标名，比如 tabler:book-2 */
  icon: string
  isDictionary: boolean
}

export interface DesktopToolbarInfo {
  translate: boolean
  speak: boolean
  actions: DesktopToolbarAction[]
}

export async function getToolbarForDesktop(
  deps: { getConfig: () => Promise<Config | null | undefined> } = {
    getConfig: ensureInitializedConfig,
  },
): Promise<DesktopToolbarInfo> {
  const config = await deps.getConfig()
  if (!config) {
    throw new Error("扩展的配置还没准备好，请稍后再试")
  }
  const { selectionToolbar } = config
  return {
    translate: selectionToolbar.features.translate.enabled,
    speak: selectionToolbar.features.speak.enabled,
    actions: getSelectionToolbarActions(selectionToolbar)
      .filter((action) => action.enabled !== false)
      .map((action) => ({
        id: action.id,
        name: action.name,
        icon: action.icon,
        isDictionary: action.id === BUILT_IN_DICTIONARY_ACTION_ID,
      })),
  }
}
