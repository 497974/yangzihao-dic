import { describe, expect, it } from "vitest"
import { ROUTE_DEFS } from "../nav-items"
import {
  buildFeatureNavGroups,
  buildSettingsNavGroup,
  isEntryActive,
  type NavEntry,
} from "../nav-model"

const GROUPS = [buildSettingsNavGroup(), ...buildFeatureNavGroups()]
const ENTRIES: NavEntry[] = GROUPS.flatMap((group) => group.items)
const MENU_PATHS = ENTRIES.map((entry) => entry.to).filter((to): to is string => !!to)

/**
 * 不出现在菜单里的路由：都是从某个页面点进去的下级页面（面包屑或按钮），
 * 不该在侧边栏再占一行。新加的**顶层**页面必须进菜单，否则下面第二条测试会失败——
 * 「功能做好了却没人找得到」正是这次要治的毛病。
 */
const DRILL_DOWN_ONLY = new Set([
  "/", // 默认页，等于 /api-providers
  "/notebase/:notebaseId", // 保存成功后的深链
  "/preference/config-backup",
  "/preference/extension-activation",
  "/page-translation/custom-css",
  "/page-translation/prompts",
  "/page-translation/translation-control",
  "/page-translation/translation-control/auto-translate-websites",
  "/page-translation/translation-control/never-auto-translate-websites",
  "/page-translation/translation-control/site-rules",
  "/page-translation/translation-queue",
  "/video-subtitles/style",
  "/video-subtitles/style/custom-css",
  "/video-subtitles/prompts",
  "/video-subtitles/subtitles-queue",
])

describe("侧边栏菜单", () => {
  it("每个菜单入口都有对应的路由", () => {
    const routes = new Set<string>(ROUTE_DEFS.map((route) => route.path))
    expect(MENU_PATHS.filter((path) => !routes.has(path))).toEqual([])
  })

  it("每个顶层页面都能从菜单点到（下级页面除外）", () => {
    const missing = ROUTE_DEFS.map((route) => route.path as string)
      .filter((path) => !DRILL_DOWN_ONLY.has(path))
      .filter((path) => !MENU_PATHS.includes(path))

    expect(missing).toEqual([])
  })

  it("同一个页面不会在菜单里出现两次", () => {
    expect(new Set(MENU_PATHS).size).toBe(MENU_PATHS.length)
  })

  it("每一组都有名字、有条目，且一组不超过六条（再多就该拆组了）", () => {
    for (const group of GROUPS) {
      expect(group.label).not.toBe("")
      expect(group.items.length).toBeGreaterThan(0)
      expect(group.items.length).toBeLessThanOrEqual(6)
    }
  })

  it("每个条目都有图标和名字，站内和站外链接二选一", () => {
    for (const entry of ENTRIES) {
      expect(entry.icon).not.toBe("")
      expect(entry.label).not.toBe("")
      expect(Boolean(entry.to) !== Boolean(entry.href)).toBe(true)
    }
  })
})

describe("高亮哪一条", () => {
  it("精确匹配的只在自己那一页高亮", () => {
    const entry: NavEntry = { to: "/review", icon: "i", label: "闪卡复习" }

    expect(isEntryActive(entry, "/review")).toBe(true)
    expect(isEntryActive(entry, "/review/x")).toBe(false)
  })

  it("prefix 的连子页面一起高亮", () => {
    const entry: NavEntry = {
      to: "/page-translation",
      icon: "i",
      label: "网页翻译",
      match: "prefix",
    }

    expect(isEntryActive(entry, "/page-translation/custom-css")).toBe(true)
  })

  it("默认页 / 落在供应商那一条上", () => {
    const providers = buildSettingsNavGroup().items[0]!

    expect(isEntryActive(providers, "/")).toBe(true)
  })

  it("站外链接（翻译中心那种）永远不高亮", () => {
    expect(isEntryActive({ href: "https://example.com", icon: "i", label: "外链" }, "/")).toBe(
      false,
    )
  })
})
