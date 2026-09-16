/**
 * 「这个网站要不要启用扩展」的轻量读法，给只需要这一个判断的内容脚本用。
 *
 * 为什么不直接用 getLocalConfig：那条路会把整份配置的 zod schema 拖进 bundle，
 * 而内容脚本各自打包、不共享 chunk——生词高亮和中文夹词这两个脚本本来只有一百多 KB，
 * 为了一个开关各背了 0.9 MB 的 zod。这里直接读存储里那份 JSON，只取网站控制那几项，
 * 读不懂就当「启用」（和 getLocalConfig 读不到配置时的行为一致）。
 *
 * 只读、不写：写配置仍然必须走 setLocalConfig 做完整校验。
 */

import { storage } from "#imports"
import { matchDomainPattern } from "@/utils/url"

/**
 * 配置在存储里的键。故意写成字面量而不是从 utils/constants/config 里导入：
 * 那个模块顺带把默认配置、动作模板、i18n 全拖进来，正好是这里要躲开的东西。
 * 和常量不一致会被 __tests__/site-control-light.test.ts 揪出来。
 */
const CONFIG_KEY = "local:config" as const

export interface SiteControlSnapshot {
  mode: "blacklist" | "whitelist"
  blacklistPatterns: string[]
  whitelistPatterns: string[]
}

function isPatternList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

/** 从存储里那份配置 JSON 里取出网站控制部分；缺字段、格式不对都返回 null */
export function pickSiteControl(config: unknown): SiteControlSnapshot | null {
  if (!config || typeof config !== "object") {
    return null
  }
  const siteControl = (config as { siteControl?: unknown }).siteControl
  if (!siteControl || typeof siteControl !== "object") {
    return null
  }
  const { mode, blacklistPatterns, whitelistPatterns } = siteControl as Record<string, unknown>
  if (
    (mode !== "blacklist" && mode !== "whitelist") ||
    !isPatternList(blacklistPatterns) ||
    !isPatternList(whitelistPatterns)
  ) {
    return null
  }
  return { mode, blacklistPatterns, whitelistPatterns }
}

/** 和 isSiteEnabled 同一套规则；读不到配置就当启用 */
export function isSiteEnabledBySnapshot(
  url: string,
  snapshot: SiteControlSnapshot | null,
): boolean {
  if (!snapshot) {
    return true
  }
  if (snapshot.mode === "blacklist") {
    return !snapshot.blacklistPatterns.some((pattern) => matchDomainPattern(url, pattern))
  }
  return snapshot.whitelistPatterns.some((pattern) => matchDomainPattern(url, pattern))
}

export async function readSiteControl(): Promise<SiteControlSnapshot | null> {
  return pickSiteControl(await storage.getItem<unknown>(CONFIG_KEY))
}
