/// <reference types="@modyfi/vite-plugin-yaml/modules" />
import type { Resource } from "i18next"
import en from "@/locales/en.yml"
import zhCN from "@/locales/zh-CN.yml"
import zhTW from "@/locales/zh-TW.yml"

/**
 * The interface languages the runtime i18next engine can switch between.
 *
 * 本项目面向中文用户，只保留英文（兜底）和简繁中文：每种语言的全部文案都会被打进
 * 每一个 bundle（含每个内容脚本），六种用不到的语言白占好几 MB。要加回某种语言，
 * 把 src/locales/<code>.yml 放回来，再在这里、uiLanguageSchema、界面语言下拉框
 * 三处各加一行即可。
 *
 * MUST stay in sync with the `uiLanguage` enum in `@/types/config/config` and the
 * files under `src/locales/`. `@wxt-dev/i18n/module` still reads those same files to
 * emit `_locales/*` for manifest name/description localization (browser-locale-bound).
 */
export const SUPPORTED_UI_LOCALES = ["en", "zh-CN", "zh-TW"] as const

export type SupportedUiLocale = (typeof SUPPORTED_UI_LOCALES)[number]

export const DEFAULT_UI_LOCALE: SupportedUiLocale = "en"

interface LocaleTree {
  [key: string]: string | LocaleTree
}

/**
 * Convert WXT-style positional substitutions to i18next interpolation, applied to
 * every string leaf at build time:
 *   - `$$`      → literal `$`   (WXT escape; none currently in the YAML, handled anyway)
 *   - `$1`..`$9`→ `{{0}}`..`{{8}}` (0-indexed to match the facade's array mapping)
 *
 * Intentionally left untouched:
 *   - existing named tokens like `{{targetLanguage}}` (LLM prompt templates; no `$`)
 *   - Chrome context-menu placeholders like `%s`
 */
function convertPlaceholders(value: string): string {
  return value.replace(/\$\$|\$(\d)/g, (_match, digit: string | undefined) =>
    digit === undefined ? "$" : `{{${Number(digit) - 1}}}`,
  )
}

function convertTree(node: LocaleTree): LocaleTree {
  const out: LocaleTree = {}
  for (const [key, val] of Object.entries(node)) {
    out[key] = typeof val === "string" ? convertPlaceholders(val) : convertTree(val)
  }
  return out
}

const rawResources: Record<SupportedUiLocale, LocaleTree> = {
  en,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
}

/**
 * i18next resource bundle: `{ [locale]: { translation: <nested string tree> } }`.
 * Single default namespace ("translation"); keys are traversed with keySeparator ".".
 */
export const resources: Resource = Object.fromEntries(
  Object.entries(rawResources).map(([lng, tree]) => [lng, { translation: convertTree(tree) }]),
)
