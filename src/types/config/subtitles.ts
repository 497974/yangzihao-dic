import { z } from "zod"
import { BUILT_IN_SUBTITLE_TRANSLATE_PROMPT_IDS } from "@/utils/constants/prompt"
import {
  MAX_BACKGROUND_OPACITY,
  MAX_FONT_SCALE,
  MAX_FONT_WEIGHT,
  MIN_BACKGROUND_OPACITY,
  MIN_FONT_SCALE,
  MIN_FONT_WEIGHT,
} from "@/utils/constants/subtitles"
import {
  batchQueueConfigSchema,
  createCustomPromptsConfigSchema,
  MAX_CUSTOM_CSS_LENGTH,
  pageTranslationShortcutSchema,
  requestQueueConfigSchema,
} from "./translate"

export const subtitleCustomPromptsConfigSchema = createCustomPromptsConfigSchema(
  BUILT_IN_SUBTITLE_TRANSLATE_PROMPT_IDS,
)

export const subtitlesDisplayModeSchema = z.enum(["bilingual", "originalOnly", "translationOnly"])
/**
 * 译文相对原文的位置。
 *
 * `farApart` 是学习向的：双语两行贴在一起时，眼睛会顺手先扫到中文，
 * 原文等于白放。把译文甩到画面顶端、原文留在底部，中间隔着整个画面，
 * 就不会一眼同时看到——想看译文得特意抬眼，于是先读原文成了默认动作。
 */
export const subtitlesTranslationPositionSchema = z.enum(["above", "below", "farApart"])
export const subtitlesFontFamilySchema = z.enum(["system", "roboto", "noto-sans", "noto-serif"])

export const subtitleTextStyleSchema = z.object({
  fontFamily: subtitlesFontFamilySchema,
  fontScale: z.number().min(MIN_FONT_SCALE).max(MAX_FONT_SCALE),
  color: z.string(),
  fontWeight: z.number().min(MIN_FONT_WEIGHT).max(MAX_FONT_WEIGHT),
})

export const subtitleContainerStyleSchema = z.object({
  backgroundOpacity: z.number().min(MIN_BACKGROUND_OPACITY).max(MAX_BACKGROUND_OPACITY),
})

export const subtitlesStyleSchema = z.object({
  displayMode: subtitlesDisplayModeSchema,
  translationPosition: subtitlesTranslationPositionSchema,
  main: subtitleTextStyleSchema,
  translation: subtitleTextStyleSchema,
  container: subtitleContainerStyleSchema,
  /** Extra CSS for the subtitle lines, on top of the picked fonts and colours. `null` is off. */
  customCSS: z.string().max(MAX_CUSTOM_CSS_LENGTH, "Custom CSS cannot exceed 8KB").nullable(),
})

export const subtitlePositionSchema = z.object({
  percent: z.number().min(0).max(100),
  anchor: z.enum(["top", "bottom"]),
})

export const videoSubtitlesSchema = z.object({
  enabled: z.boolean(),
  autoStart: z.boolean(),
  toggleShortcut: pageTranslationShortcutSchema,
  providerId: z.string().nonempty(),
  style: subtitlesStyleSchema,
  aiSegmentation: z.boolean(),
  requestQueueConfig: requestQueueConfigSchema,
  batchQueueConfig: batchQueueConfigSchema,
  customPromptsConfig: subtitleCustomPromptsConfigSchema,
  position: subtitlePositionSchema,
  /**
   * 「拉开距离」模式下顶部译文离画面顶端的百分比。
   *
   * 单独存一个数字而不是复用 subtitlePositionSchema：这一行的存在意义就是"待在上面
   * 离原文足够远"，允许它锚到底部等于把这个模式本身取消掉。上限 60 也是同一个道理，
   * 再往下就贴到原文了。
   */
  farApartTranslationPercent: z.number().min(0).max(60),
})

export type SubtitlesDisplayMode = z.infer<typeof subtitlesDisplayModeSchema>
export type SubtitlesTranslationPosition = z.infer<typeof subtitlesTranslationPositionSchema>
export type SubtitlesFontFamily = z.infer<typeof subtitlesFontFamilySchema>
export type SubtitleTextStyle = z.infer<typeof subtitleTextStyleSchema>
export type SubtitleContainerStyle = z.infer<typeof subtitleContainerStyleSchema>
export type SubtitlesStyle = z.infer<typeof subtitlesStyleSchema>
export type SubtitlePosition = z.infer<typeof subtitlePositionSchema>
export type VideoSubtitles = z.infer<typeof videoSubtitlesSchema>
