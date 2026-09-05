/**
 * Migration script from v100 to v101.
 *
 * 把配置里残留的「托管内置 AI」供应商 id 换成本机真实存在的供应商。
 *
 * 本项目移除了上游需要订阅的托管 AI（见 utils/providers/provider-registry.ts：
 * SYSTEM_PROVIDER_DEFS 现在是空的），但一直没有配套的迁移。结果是：任何配置
 * 版本早于 v088 的用户，升级时会被 v087-to-v088 写入 `yangzihao-dic-free-ai`、
 * 再被 v096-to-v097 改名成 `yangzihao-dic-advance-ai`，而这两个 id 在本项目里
 * 都已不存在 —— configSchema 校验失败，initializeConfig 于是判定配置无效，
 * 用默认值整个重建，用户的设置被静默清空。这一步就是来补这个缺口的。
 *
 * 替换分两类，因为两类槽位的能力要求不同：
 *   - 翻译类（页面／字幕／输入框／划词翻译／内置词典）可以用免密钥的
 *     Microsoft Translate，换过去就能直接用，不需要用户配 key；
 *   - 大模型类（笔记建议／自定义动作／LLM 语言检测）没有纯翻译的等价物，
 *     只能挑用户自己配置里第一个启用的大模型；一个都没有时退回 openai
 *     默认行，用户会看到「请填 API Key」的提示 —— 那是正确的提示，
 *     比配置被重置好得多。
 *
 * IMPORTANT: This is a frozen snapshot. All values and helpers are deliberately inline and it
 * imports nothing from the evolving application code.
 */

/** 已移除的托管供应商 id，含上游品牌下的历史写法 */
const REMOVED_HOSTED_PROVIDER_IDS = new Set([
  "yangzihao-dic-free-ai",
  "yangzihao-dic-advance-ai",
  "yangzihao-dic-ultra-ai",
  "yangzihao-dic-built-in-ai",
  "read-frog-free-ai",
  "read-frog-advance-ai",
  "read-frog-ultra-ai",
  "read-frog-built-in-ai",
])

const MICROSOFT_TRANSLATE_PROVIDER_ID = "microsoft-translate-default"
const OPENAI_PROVIDER_ID = "openai-default"

/** 纯翻译引擎——这些不能拿去顶大模型的槽位 */
const PURE_TRANSLATE_PROVIDER_TYPES = new Set(["google", "microsoft", "deeplx", "deepl"])

function isObject(value: any): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isRemoved(providerId: any): boolean {
  return typeof providerId === "string" && REMOVED_HOSTED_PROVIDER_IDS.has(providerId)
}

function usableProviders(oldConfig: any): any[] {
  const providersConfig = oldConfig?.providersConfig
  if (!Array.isArray(providersConfig)) {
    return []
  }
  return providersConfig.filter(
    (provider: any) =>
      isObject(provider) &&
      provider.enabled !== false &&
      typeof provider.id === "string" &&
      !isRemoved(provider.id),
  )
}

/** 从用户自己的 providersConfig 里挑第一个启用的大模型 */
function pickLLMProviderId(oldConfig: any): string {
  const llm = usableProviders(oldConfig).find(
    (provider: any) => !PURE_TRANSLATE_PROVIDER_TYPES.has(provider.provider),
  )
  return llm ? llm.id : OPENAI_PROVIDER_ID
}

/**
 * 翻译类槽位的替补。优先免密钥的 Microsoft Translate，但不能假定它一定在
 * providersConfig 里（配置可能是精简过的），所以逐级退让：本机有的纯翻译引擎 →
 * 本机有的大模型 → 最后才硬写 Microsoft。
 */
function pickTranslateProviderId(oldConfig: any): string {
  const usable = usableProviders(oldConfig)
  if (usable.some((provider: any) => provider.id === MICROSOFT_TRANSLATE_PROVIDER_ID)) {
    return MICROSOFT_TRANSLATE_PROVIDER_ID
  }
  const translate = usable.find((provider: any) =>
    PURE_TRANSLATE_PROVIDER_TYPES.has(provider.provider),
  )
  if (translate) {
    return translate.id
  }
  const llm = usable.find((provider: any) => !PURE_TRANSLATE_PROVIDER_TYPES.has(provider.provider))
  return llm ? llm.id : MICROSOFT_TRANSLATE_PROVIDER_ID
}

/** 该槽位存的是已移除的 id 就换掉，否则原样返回（命中才复制） */
function replaceProviderId(holder: any, replacement: string): any {
  if (!isObject(holder) || !isRemoved(holder.providerId)) {
    return holder
  }
  return { ...holder, providerId: replacement }
}

export function migrate(oldConfig: any): any {
  if (!isObject(oldConfig)) {
    return oldConfig
  }

  const llmProviderId = pickLLMProviderId(oldConfig)
  const translateProviderId = pickTranslateProviderId(oldConfig)
  const next: Record<string, any> = { ...oldConfig }

  // 翻译类槽位：免密钥引擎顶上即可
  for (const key of ["pageTranslation", "videoSubtitles", "inputTranslation"]) {
    next[key] = replaceProviderId(next[key], translateProviderId)
  }

  // 语言检测走 llm 模式时要的是大模型
  next.languageDetection = replaceProviderId(next.languageDetection, llmProviderId)

  const selectionToolbar = next.selectionToolbar
  if (isObject(selectionToolbar)) {
    const nextSelectionToolbar: Record<string, any> = { ...selectionToolbar }

    nextSelectionToolbar.noteSuggestion = replaceProviderId(
      nextSelectionToolbar.noteSuggestion,
      llmProviderId,
    )

    const features = nextSelectionToolbar.features
    if (isObject(features)) {
      nextSelectionToolbar.features = {
        ...features,
        translate: replaceProviderId(features.translate, translateProviderId),
      }
    }

    // 内置词典在本项目里可以降级到纯翻译引擎（见 resolveDictionaryProviderRef），
    // 所以这里跟翻译类一样挂 Microsoft，没有 key 也能查词
    const builtInActions = nextSelectionToolbar.builtInActions
    if (isObject(builtInActions)) {
      nextSelectionToolbar.builtInActions = {
        ...builtInActions,
        dictionary: replaceProviderId(builtInActions.dictionary, translateProviderId),
      }
    }

    // 自定义动作靠 systemPrompt 做结构化抽取，纯翻译引擎跑不了，只能给大模型
    if (Array.isArray(nextSelectionToolbar.customActions)) {
      nextSelectionToolbar.customActions = nextSelectionToolbar.customActions.map((action: any) =>
        replaceProviderId(action, llmProviderId),
      )
    }

    next.selectionToolbar = nextSelectionToolbar
  }

  return next
}
