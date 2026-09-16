/**
 * 行内释义提示与页面难度（阶段五实现方案 · 步骤 2）的设置键。
 * 独立开关单独一个键，不进 Config，不用做配置迁移。
 */

/** 行内释义提示：默认关——会在正文里插入小字，改变网页排版，要由用户自己决定 */
export const WORD_WISE_ENABLED_KEY = "local:wordWiseEnabled" as const
export const WORD_WISE_DEFAULT_ENABLED = false

/** 提示范围：高于我的水平一档起提示，还是两档起 */
export const WORD_WISE_RANGE_KEY = "local:wordWiseRange" as const

/** 页面难度角标：默认关——右下角多一个浮层，同样由用户决定 */
export const PAGE_DIFFICULTY_BADGE_KEY = "local:pageDifficultyBadge" as const
export const PAGE_DIFFICULTY_BADGE_DEFAULT = false

/** 我的英语水平（1~7，见 utils/word-wise/level.ts）；没设过时按词汇量测试结果推算 */
export const ENGLISH_LEVEL_KEY = "local:englishLevel" as const
