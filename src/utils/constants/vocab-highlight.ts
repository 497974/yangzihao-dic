/**
 * 网页生词高亮（优化清单第 9 条）的开关：生词本里的词出现在网页上时标出来。
 *
 * 默认开：这是背单词的核心体验，存了词就该在阅读里遇见它。
 * 不放进 Config：一个独立的开关单独一个键，不用做配置迁移（和「连接桌面版」一样）。
 */
export const VOCAB_HIGHLIGHT_ENABLED_KEY = "local:vocabHighlightEnabled" as const

export const VOCAB_HIGHLIGHT_DEFAULT_ENABLED = true

/**
 * 已掌握的词要不要也标出来。默认不标：掌握了的词满页都是下划线，
 * 反而把真正该留意的新词和学习中的词淹没了。
 */
export const VOCAB_HIGHLIGHT_SHOW_MASTERED_KEY = "local:vocabHighlightShowMastered" as const

export const VOCAB_HIGHLIGHT_DEFAULT_SHOW_MASTERED = false
