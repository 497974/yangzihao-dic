/**
 * 桌面版的「三下空格翻译」：在 QQ、微信等浏览器以外的地方打完字连按三下空格，
 * 桌面程序把输入框里的字交给这里翻译，再替换回去。
 *
 * 和网页里的输入翻译用同一份设置（设置 → 输入翻译：供应商、原文/译文语言），区别只有：
 * - 「源语言」为自动时用英语，和网页端一致（见 translate-variants.ts 的
 *   INPUT_AUTO_FOREIGN_LANG）——这是学英语的工具，只在中英之间翻
 * - 不带网页上下文（标题、正文摘要）
 * - 后台不能给自己发消息，翻译请求直接交给后台的翻译队列（缓存、限流和网页一致）
 */

import type { LangCodeISO6393 } from "@read-frog/definitions"
import type { Config, InputTranslationLang } from "@/types/config/config"
import { translateTextCore } from "@/utils/host/translate/translate-text"
import { resolveProviderRefForCapability } from "@/utils/providers/provider-registry"
import { ensureInitializedConfig } from "../config"
import { enqueueTranslateRequestInBackground } from "../translation-queues"

/** 源语言设成「自动」时桌面版用的外语 */
export const DESKTOP_INPUT_FALLBACK_FOREIGN_LANG: LangCodeISO6393 = "eng"

export interface DesktopTranslateRequest {
  text: string
  /** 来源程序（如「QQ」），目前只用来记录 */
  sourceTitle?: string
}

export interface DesktopTranslateResult {
  text: string
  from: LangCodeISO6393
  to: LangCodeISO6393
}

export type DesktopTranslateErrorCode =
  | "empty_text"
  | "config_unavailable"
  | "provider_unavailable"
  | "same_language"
  | "empty_result"

/** 可以直接展示给用户的错误：message 就是给人看的原因 */
export class DesktopTranslateError extends Error {
  constructor(
    readonly code: DesktopTranslateErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "DesktopTranslateError"
  }
}

export function resolveDesktopInputLang(
  lang: InputTranslationLang,
  language: Config["language"],
): LangCodeISO6393 {
  if (lang === "sourceCode") {
    return language.sourceCode === "auto"
      ? DESKTOP_INPUT_FALLBACK_FOREIGN_LANG
      : language.sourceCode
  }
  if (lang === "targetCode") {
    return language.targetCode
  }
  return lang
}

interface TranslateDeps {
  getConfig: () => Promise<Config | null | undefined>
  translate: typeof translateTextCore
}

const defaultDeps: TranslateDeps = {
  getConfig: ensureInitializedConfig,
  translate: translateTextCore,
}

export async function translateInputForDesktop(
  request: DesktopTranslateRequest,
  deps: TranslateDeps = defaultDeps,
): Promise<DesktopTranslateResult> {
  const text = request.text.trim()
  if (!text) {
    throw new DesktopTranslateError("empty_text", "输入框里没有要翻译的文字")
  }

  const config = await deps.getConfig()
  if (!config) {
    throw new DesktopTranslateError("config_unavailable", "扩展的配置还没准备好，请稍后再试")
  }

  const resolved = resolveProviderRefForCapability(
    "inputTranslation",
    config.providersConfig,
    config.inputTranslation.providerId,
  )
  if (!resolved) {
    throw new DesktopTranslateError(
      "provider_unavailable",
      "输入翻译用的翻译服务不可用。请到扩展设置 → 输入翻译，检查供应商是否已启用",
    )
  }
  const providerConfig = resolved.kind === "local" ? resolved.config : resolved

  const { fromLang, toLang } = config.inputTranslation
  const from = resolveDesktopInputLang(fromLang, config.language)
  const to = resolveDesktopInputLang(toLang, config.language)
  if (from === to) {
    throw new DesktopTranslateError(
      "same_language",
      `输入翻译的原文和译文语言都是「${from}」，没有可翻的。` +
        `请到扩展设置 → 输入翻译里把两边改成不同的语言。`,
    )
  }

  const translated = await deps.translate({
    text,
    langConfig: { sourceCode: from, targetCode: to, level: config.language.level },
    extraHashTags: [`inputTranslation:${fromLang}->${toLang}`],
    providerConfig,
    hostedFeature: "inputTranslation",
    // 用户自己敲的换行都是有意义的
    preserveLineBreaks: true,
    dispatch: enqueueTranslateRequestInBackground,
  })
  if (!translated.trim()) {
    throw new DesktopTranslateError(
      "empty_result",
      "翻译服务没有返回内容（可能判定这段文字不需要翻译）",
    )
  }
  return { text: translated, from, to }
}
