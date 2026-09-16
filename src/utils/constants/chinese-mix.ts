/**
 * 中文网页夹英文词（功能路线图阶段四第 6 条）的开关、密度和难度范围。
 *
 * 默认关：这个功能会改动网页正文，得由用户自己决定要不要——
 * 和生词高亮（只加下划线，不改字）不一样，那个默认开。
 * 不放进 Config：独立开关单独一个键，不用做配置迁移。
 */

import type { MixDensity } from "@/utils/chinese-mix/mixer"

export const CHINESE_MIX_ENABLED_KEY = "local:chineseMixEnabled" as const
export const CHINESE_MIX_DENSITY_KEY = "local:chineseMixDensity" as const
/** 换上去的词多难（相对「我的英语水平」，见 utils/wordlist/reverse.ts 的 MixBand） */
export const CHINESE_MIX_BAND_KEY = "local:chineseMixBand" as const

export const CHINESE_MIX_DEFAULT_ENABLED = false
export const CHINESE_MIX_DEFAULT_DENSITY: MixDensity = "medium"

export const CHINESE_MIX_DENSITY_LABEL: Record<MixDensity, string> = {
  low: "较少（每页约 6 处）",
  medium: "适中（每页约 14 处）",
  high: "较多（每页约 30 处）",
}
