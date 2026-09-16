/**
 * 桌面版划词工具栏的「翻译」按钮：在 QQ、Word 里选中一段文字，点翻译。
 *
 * 和网页划词工具栏的翻译按钮用同一套设置——划词翻译的供应商（设置 → 划词工具栏 → 翻译）、
 * 目标语言、自定义翻译提示词。三条路也和网页一致（见 translate-button/provider.tsx）：
 * - 内置 AI → 托管文本流，边写边出
 * - 大模型 → 后台文本流，边写边出
 * - 纯翻译引擎 → 翻译队列，一次返回
 * 区别只有：没有网页上下文；后台不能给自己发消息，全部直接调用后台里的函数。
 */

import type { ThinkingSnapshot } from "@/types/background-stream"
import type { Config } from "@/types/config/config"
import { LANG_CODE_TO_EN_NAME } from "@read-frog/definitions"
import { isLLMProviderConfig, isTranslateProviderConfig } from "@/types/config/provider"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import { prepareTranslationText } from "@/utils/host/translate/text-preparation"
import { translateTextCore } from "@/utils/host/translate/translate-text"
import { getTranslatePromptFromConfig } from "@/utils/prompts/translate"
import { resolveModelId } from "@/utils/providers/model-id"
import { getProviderOptionsWithOverride } from "@/utils/providers/options"
import { resolveProviderRefForCapability } from "@/utils/providers/provider-registry"
import { getTopLevelReasoning } from "@/utils/providers/reasoning"
import { runStreamTextInBackground } from "../background-stream"
import { ensureInitializedConfig } from "../config"
import { enqueueTranslateRequestInBackground } from "../translation-queues"

export interface DesktopSelectionTranslateRequest {
  text: string
  /** 来源程序（如「QQ」），目前只用来记录 */
  sourceTitle?: string
}

export interface DesktopSelectionTranslateResult {
  text: string
  /** true = 纯翻译引擎一次返回，没有调用大模型 */
  fast: boolean
}

/** 大模型翻译的中途进度：译文写到哪就给到哪 */
export interface DesktopSelectionTranslateProgress {
  text: string
  thinking: ThinkingSnapshot | null
}

export type DesktopSelectionTranslateErrorCode =
  | "empty_text"
  | "config_unavailable"
  | "provider_unavailable"
  | "provider_disabled"
  | "empty_result"

/** 可以直接展示给用户的错误：message 就是给人看的原因 */
export class DesktopSelectionTranslateError extends Error {
  constructor(
    readonly code: DesktopSelectionTranslateErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "DesktopSelectionTranslateError"
  }
}

interface SelectionTranslateDeps {
  getConfig: () => Promise<Config | null | undefined>
  runStreamText: typeof runStreamTextInBackground
  translate: typeof translateTextCore
}

const defaultDeps: SelectionTranslateDeps = {
  getConfig: ensureInitializedConfig,
  runStreamText: runStreamTextInBackground,
  translate: translateTextCore,
}

export async function translateSelectionForDesktop(
  request: DesktopSelectionTranslateRequest,
  options: {
    signal?: AbortSignal
    onProgress?: (progress: DesktopSelectionTranslateProgress) => void
  } = {},
  deps: SelectionTranslateDeps = defaultDeps,
): Promise<DesktopSelectionTranslateResult> {
  const text = prepareTranslationText(request.text)
  if (!text) {
    throw new DesktopSelectionTranslateError("empty_text", "没有取到要翻译的文字")
  }

  const config = await deps.getConfig()
  if (!config) {
    throw new DesktopSelectionTranslateError(
      "config_unavailable",
      "扩展的配置还没准备好，请稍后再试",
    )
  }

  const provider = resolveProviderRefForCapability(
    "selectionTranslation",
    config.providersConfig,
    config.selectionToolbar.features.translate.providerId,
  )
  if (!provider) {
    throw new DesktopSelectionTranslateError(
      "provider_unavailable",
      "划词翻译用的翻译服务不可用。请到扩展设置 → 划词工具栏 → 翻译，检查供应商是否已启用",
    )
  }
  if (provider.kind === "local" && !provider.config.enabled) {
    throw new DesktopSelectionTranslateError(
      "provider_disabled",
      "划词翻译用的供应商被关掉了。请到扩展设置里把它打开，或者换一个供应商",
    )
  }

  const targetLangName = LANG_CODE_TO_EN_NAME[config.language.targetCode]
  const promptConfig = { customPromptsConfig: config.pageTranslation.customPromptsConfig }
  const onChunk = (snapshot: { output: string; thinking?: ThinkingSnapshot | null }) => {
    options.onProgress?.({ text: snapshot.output, thinking: snapshot.thinking ?? null })
  }

  let translated: string
  let fast = false
  if (provider.kind === "system") {
    const { systemPrompt, prompt } = getTranslatePromptFromConfig(
      promptConfig,
      targetLangName,
      text,
      {},
    )
    const snapshot = await deps.runStreamText(
      {
        providerId: provider.id,
        modelTier: provider.modelTier,
        requestId: getRandomUUID(),
        hostedFeature: "selectionTranslation",
        instructions: systemPrompt,
        prompt,
      },
      { signal: options.signal, onChunk },
    )
    translated = snapshot.output
  } else if (!isTranslateProviderConfig(provider.config)) {
    throw new DesktopSelectionTranslateError(
      "provider_unavailable",
      "划词翻译的供应商不能用来翻译。请到扩展设置 → 划词工具栏 → 翻译，换一个供应商",
    )
  } else if (isLLMProviderConfig(provider.config)) {
    // 和网页端 translateWithTextStream 的参数一致
    const providerConfig = provider.config
    const reasoning = getTopLevelReasoning(providerConfig)
    const providerOptions = getProviderOptionsWithOverride(
      resolveModelId(providerConfig.model) ?? "",
      providerConfig.provider,
      providerConfig.providerOptions,
      reasoning,
    )
    const { systemPrompt, prompt } = getTranslatePromptFromConfig(
      promptConfig,
      targetLangName,
      text,
      {},
    )
    const snapshot = await deps.runStreamText(
      {
        providerId: providerConfig.id,
        instructions: systemPrompt,
        prompt,
        providerOptions,
        reasoning,
        temperature: providerConfig.temperature,
      },
      { signal: options.signal, onChunk },
    )
    translated = snapshot.output
  } else {
    fast = true
    translated = await deps.translate({
      text,
      langConfig: config.language,
      providerConfig: provider.config,
      hostedFeature: "selectionTranslation",
      enableAIContentAware: config.pageTranslation.enableAIContentAware,
      extraHashTags: ["selectionTranslation"],
      dispatch: enqueueTranslateRequestInBackground,
    })
  }

  if (!translated.trim()) {
    throw new DesktopSelectionTranslateError(
      "empty_result",
      "翻译服务没有返回内容（可能判定这段文字不需要翻译）",
    )
  }
  return { text: translated, fast }
}
