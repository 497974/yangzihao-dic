/**
 * Migration script from v101 to v102.
 *
 * `videoSubtitles` 新增必填字段 `farApartTranslationPercent`（「拉开距离」模式下
 * 顶部译文离画面顶端的百分比）。
 *
 * 不补这一步的话，老用户的配置里没有这个键，configSchema 校验直接失败，
 * initializeConfig 会判定配置无效并用默认值整个重建——填好的 API Key、
 * 选好的供应商、调好的字幕样式全没了。新增必填字段就必须配一步迁移。
 *
 * IMPORTANT: This is a frozen snapshot. All values and helpers are deliberately inline and it
 * imports nothing from the evolving application code.
 */

const FAR_APART_TRANSLATION_TOP_PERCENT = 8

function isObject(value: any): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function migrate(oldConfig: any): any {
  if (!isObject(oldConfig)) {
    return oldConfig
  }

  const videoSubtitles = oldConfig.videoSubtitles
  if (!isObject(videoSubtitles)) {
    return oldConfig
  }

  if (typeof videoSubtitles.farApartTranslationPercent === "number") {
    return oldConfig
  }

  return {
    ...oldConfig,
    videoSubtitles: {
      ...videoSubtitles,
      farApartTranslationPercent: FAR_APART_TRANSLATION_TOP_PERCENT,
    },
  }
}
