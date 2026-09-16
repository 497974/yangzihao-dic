import { describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { getBuiltInDictionaryAction } from "@/utils/custom-actions"

vi.mock("../../config", () => ({
  ensureInitializedConfig: vi.fn<(...args: any[]) => any>(),
}))

const { getToolbarForDesktop } = await import("../toolbar")

describe("桌面版划词工具栏的按钮", () => {
  it("和网页工具栏同一份设置：翻译、朗读开没开，启用的动作按顺序（词典在最前）", async () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.selectionToolbar.features.speak.enabled = false
    const dictionary = getBuiltInDictionaryAction(config.selectionToolbar)
    config.selectionToolbar.customActions = [
      { ...dictionary, id: "polish", name: "润色", icon: "tabler:pencil-check" },
      { ...dictionary, id: "off", name: "关掉的动作", enabled: false },
    ]

    const toolbar = await getToolbarForDesktop({ getConfig: async () => config })

    expect(toolbar.translate).toBe(config.selectionToolbar.features.translate.enabled)
    expect(toolbar.speak).toBe(false)
    expect(toolbar.actions).toEqual([
      { id: dictionary.id, name: dictionary.name, icon: dictionary.icon, isDictionary: true },
      { id: "polish", name: "润色", icon: "tabler:pencil-check", isDictionary: false },
    ])
  })

  it("扩展配置还没准备好：说明原因", async () => {
    await expect(getToolbarForDesktop({ getConfig: async () => null })).rejects.toThrow(
      "扩展的配置还没准备好",
    )
  })
})
