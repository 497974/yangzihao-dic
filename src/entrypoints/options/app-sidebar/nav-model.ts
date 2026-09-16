/**
 * 设置页侧边栏菜单的唯一定义处。
 *
 * 分组按「你想干什么」来，不是按代码模块：
 *   设置       —— 先配好才好用的东西（供应商、偏好、快捷键）
 *   词汇       —— 积累单词：存词 → 复习 → 测水平 → 看进度
 *   练习       —— 把词用出来：造句、写作、对话
 *   阅读与翻译 —— 读东西的时候网页会变成什么样
 *   取词工具   —— 选中文字之后从哪儿弹出来、有哪些动作
 * 一组不超过六条，扫一眼就知道点哪个。
 *
 * 写成表而不是几百行重复 JSX：加一页只要加一行；
 * `__tests__/nav-model.test.ts` 会检查每个入口都有对应路由、每个页面都有入口，
 * 免得又出现「功能做好了却没人找得到」。
 */

import { browser } from "#imports"
import { TRANSLATION_HUB_PAGE_PATH } from "@/utils/constants/translation-hub"
import { i18n } from "@/utils/i18n"

export interface NavEntry {
  /** 站内路由；外部页面用 href */
  to?: string
  href?: string
  icon: string
  label: string
  /** 有子页面的用 prefix（如 /page-translation/custom-css 也要让父条目高亮） */
  match?: "exact" | "prefix"
  /** 还有哪些路径也算这一条选中（默认页 "/" 落在供应商那一条上） */
  alsoActiveOn?: string[]
}

export interface NavGroup {
  label: string
  items: NavEntry[]
}

/** 先配置、后用：这一组放最上面 */
export function buildSettingsNavGroup(): NavGroup {
  return {
    label: i18n.t("options.sidebar.settings"),
    items: [
      {
        to: "/api-providers",
        icon: "tabler:api",
        label: i18n.t("options.apiProviders.title"),
        alsoActiveOn: ["/"],
      },
      {
        to: "/preference",
        icon: "tabler:adjustments-horizontal",
        label: i18n.t("options.preference.title"),
        match: "prefix",
      },
      { to: "/shortcuts", icon: "tabler:command", label: i18n.t("options.shortcuts.title") },
    ],
  }
}

export function buildFeatureNavGroups(): NavGroup[] {
  return [
    {
      label: i18n.t("options.sidebar.vocabulary"),
      items: [
        { to: "/notebase", icon: "tabler:book", label: "生词本", match: "prefix" },
        { to: "/review", icon: "tabler:cards", label: "闪卡复习" },
        { to: "/vocab-test", icon: "tabler:ruler-measure", label: "词汇量测试" },
        { to: "/stats", icon: "tabler:chart-bar", label: "学习统计" },
      ],
    },
    {
      label: i18n.t("options.sidebar.practice"),
      items: [
        { to: "/sentence-practice", icon: "tabler:pencil-question", label: "造句练习" },
        { to: "/writing", icon: "tabler:pencil-check", label: "写作纠错" },
        { to: "/conversation", icon: "tabler:messages", label: "对话练习" },
      ],
    },
    {
      label: i18n.t("options.sidebar.reading"),
      items: [
        {
          to: "/page-translation",
          icon: "ri:translate",
          label: i18n.t("options.translation.title"),
          match: "prefix",
        },
        {
          to: "/video-subtitles",
          icon: "tabler:subtitles",
          label: i18n.t("options.videoSubtitles.title"),
          match: "prefix",
        },
        {
          to: "/reading-assist",
          icon: "tabler:highlight",
          label: i18n.t("options.readingAssist.title"),
        },
        {
          to: "/input-translation",
          icon: "tabler:keyboard",
          label: i18n.t("options.inputTranslation.title"),
        },
        { to: "/tts", icon: "tabler:speakerphone", label: i18n.t("options.tts.title") },
        {
          // 独立的一页，点了新开标签；不是路由，所以 nav-model 的路由测试不会管它
          href: browser.runtime.getURL(TRANSLATION_HUB_PAGE_PATH),
          icon: "tabler:language-hiragana",
          label: i18n.t("options.tools.translationHub"),
        },
      ],
    },
    {
      label: i18n.t("options.sidebar.selection"),
      items: [
        {
          to: "/selection-toolbar",
          icon: "tabler:cursor-text",
          label: i18n.t("options.selectionToolbar.title"),
        },
        {
          to: "/floating-button",
          icon: "tabler:circle-dot",
          label: i18n.t("options.floatingButton.title"),
        },
        { to: "/context-menu", icon: "tabler:menu-2", label: i18n.t("options.contextMenu.title") },
        {
          to: "/custom-actions",
          icon: "tabler:sparkles",
          label: i18n.t("options.selectionToolbar.customActions.title"),
        },
        { to: "/desktop", icon: "tabler:device-desktop", label: "桌面版" },
      ],
    },
  ]
}

export function isEntryActive(entry: NavEntry, pathname: string): boolean {
  if (!entry.to) {
    return false
  }
  if (entry.alsoActiveOn?.includes(pathname)) {
    return true
  }
  return entry.match === "prefix" ? pathname.startsWith(entry.to) : pathname === entry.to
}
