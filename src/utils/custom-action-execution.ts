/**
 * 划词动作（含内置词典）执行请求的构造——网页划词弹窗与桌面版查词共用。
 *
 * 之所以抽出来：桌面版在后台查词，而原来的构造逻辑写在网页脚本的 React hook 文件里，
 * 那个文件还引了 React 和网页端的流式客户端，后台引用它有模块顶层就碰 window 的风险。
 * 这里只放纯逻辑，两边调用同一份——以后改提示词、改供应商参数，两边自动一致。
 */

import type { JSONValue } from "ai"
import type { Config } from "@/types/config/config"
import type { AISDKReasoning, ProviderConfig } from "@/types/config/provider"
import type { SelectionToolbarCustomAction } from "@/types/config/selection-toolbar"
import type { HostedAiModelTier } from "@/utils/constants/provider-ids"
import type { EnqueueTranslateDispatch } from "@/utils/host/translate/translate-text"
import type { CustomActionProviderRef } from "@/utils/providers/provider-registry"
import {
  buildSelectionToolbarCustomActionSystemPrompt,
  replaceSelectionToolbarCustomActionPromptTokens,
} from "@/entrypoints/selection.content/selection-toolbar/custom-action-prompt"
import { isLLMProviderConfig, isPureTranslateProviderConfig } from "@/types/config/provider"
import { BUILT_IN_DICTIONARY_ACTION_ID } from "@/utils/constants/custom-action"
import { translateTextCore } from "@/utils/host/translate/translate-text"
import { resolveModelId } from "@/utils/providers/model-id"
import { getProviderOptionsWithOverride } from "@/utils/providers/options"
import { getTopLevelReasoning } from "@/utils/providers/reasoning"

/** 内置词典各结构化字段的稳定 id——见 utils/constants/config.ts 里 createDefaultDictionaryAction 加的 "default-" 前缀 */
export const DICTIONARY_FIELD_ID = {
  term: "default-dictionary-term",
  definition: "default-dictionary-definition",
  context: "default-dictionary-context",
  contextTranslation: "default-dictionary-context-translation",
} as const

export interface CustomActionExecutionContext {
  action: SelectionToolbarCustomAction
  provider: CustomActionProviderRef
  /** 只有快速词典分支要用（走纯翻译供应商时需要真正的语言配置，不是 promptTokens 里那个人类可读的语言名） */
  language: Config["language"]
  promptTokens: {
    selection: string
    paragraphs: string
    targetLanguage: string
    webTitle: string
    webContent: string
  }
}

/** 交给后台结构化查词（runStructuredObjectStreamInBackground）的负载 */
export interface CustomActionPayload {
  outputSchema: Array<{
    name: string
    type: SelectionToolbarCustomAction["outputSchema"][number]["type"]
  }>
  prompt: string
  providerId: string
  modelTier?: HostedAiModelTier
  providerOptions?: Record<string, Record<string, JSONValue>>
  reasoning?: AISDKReasoning
  instructions: string
  temperature?: number
}

/** 非空时走快速词典分支，绕开结构化查词——见 runFastDictionaryLookup */
export interface FastDictionaryRequest {
  promptTokens: CustomActionExecutionContext["promptTokens"]
  outputSchema: SelectionToolbarCustomAction["outputSchema"]
  language: Config["language"]
  providerConfig: ProviderConfig
}

export interface BuiltCustomActionPayload {
  payload: CustomActionPayload
  fastDictionary: FastDictionaryRequest | null
  /** 以下两项只给网页端拼去重键用 */
  model: unknown
  providerKey: string
}

export function buildCustomActionPayload(
  executionContext: CustomActionExecutionContext,
): BuiltCustomActionPayload {
  const { action, provider, promptTokens, language } = executionContext
  const systemPrompt = buildSelectionToolbarCustomActionSystemPrompt(
    action.systemPrompt,
    promptTokens,
    action.outputSchema,
  )
  const prompt = replaceSelectionToolbarCustomActionPromptTokens(action.prompt, promptTokens)
  const outputSchema = action.outputSchema.map(({ name, type }) => ({ name, type }))
  const providerKey = provider.kind === "local" ? provider.config.provider : provider.id
  // provider.config 在类型上是 LLMProviderConfig，但词典允许纯翻译供应商伪装成
  // 这个类型混进来（见 resolveDictionaryProviderRef 的断言注释）——.model/
  // .providerOptions/.temperature 在那种情况下其实不存在，所以这里必须用
  // isLLMProviderConfig 做一次真正的运行时判断，不能只看 provider.kind，
  // 否则 resolveModelId(undefined) 会直接崩溃。
  const isLocalLLM = provider.kind === "local" && isLLMProviderConfig(provider.config)
  const model = isLocalLLM ? provider.config.model : undefined
  const modelName = isLocalLLM ? (resolveModelId(provider.config.model) ?? "") : ""
  const reasoning = isLocalLLM ? getTopLevelReasoning(provider.config) : undefined
  const providerOptions = isLocalLLM
    ? getProviderOptionsWithOverride(
        modelName,
        provider.config.provider,
        provider.config.providerOptions,
        reasoning,
      )
    : undefined
  const temperature = isLocalLLM ? provider.config.temperature : undefined
  const fastDictionary =
    action.id === BUILT_IN_DICTIONARY_ACTION_ID &&
    provider.kind === "local" &&
    isPureTranslateProviderConfig(provider.config)
      ? {
          promptTokens,
          outputSchema: action.outputSchema,
          language,
          providerConfig: provider.config,
        }
      : null

  return {
    payload: {
      providerId: provider.id,
      modelTier: provider.kind === "system" ? provider.modelTier : undefined,
      instructions: systemPrompt,
      prompt,
      outputSchema,
      providerOptions,
      reasoning,
      temperature,
    },
    fastDictionary,
    model,
    providerKey,
  }
}

/**
 * 在整段上下文里找出包含选中词/短语的那一句，用于「快速词典」——纯翻译引擎
 * 产不出例句，只能从已有的上下文里摘一句出来。
 *
 * 用 Intl.Segmenter 的 sentence 粒度而不是手写标点正则：中英文、日文的句读符号
 * 不一样，Segmenter 按 locale 规则分句更稳。找不到就退回选中文本本身，好过
 * 一整段没切开的原文。
 */
export function extractSentenceContaining(paragraphs: string, selection: string): string {
  if (!paragraphs || typeof Intl.Segmenter !== "function") {
    return selection
  }
  const idx = paragraphs.toLowerCase().indexOf(selection.toLowerCase())
  if (idx < 0) {
    return selection
  }
  const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" })
  for (const { segment, index } of segmenter.segment(paragraphs)) {
    if (idx >= index && idx < index + segment.length) {
      const trimmed = segment.trim()
      return trimmed || selection
    }
  }
  return selection
}

/**
 * 词典的「快速模式」——供应商是 Google/Microsoft Translate 这类纯翻译引擎时
 * 走这条路，而不是结构化查词。
 *
 * 纯翻译引擎给不出词性/音标/难度这些结构化字段（这些需要"理解"而不是"翻译"），
 * 所以只填词条、释义（=词条的翻译）、例句（从上下文摘出来的原句）、例句翻译
 * 这四项，用一次轻量翻译调用换取秒回；代价是没有词性分析，也不做原形归一化
 * （"running" 不会被规范成 "run"）。结果对象的 key 用 outputSchema 里对应字段的
 * name（渲染层就是按 name 取值的，见 structured-object-renderer.tsx），不是稳定 id。
 *
 * dispatch：网页端不传（经消息发给后台）；后台调用时必须传直接派发的函数。
 */
export async function runFastDictionaryLookup(
  promptTokens: CustomActionExecutionContext["promptTokens"],
  outputSchema: SelectionToolbarCustomAction["outputSchema"],
  language: Config["language"],
  providerConfig: ProviderConfig,
  dispatch?: EnqueueTranslateDispatch,
): Promise<Record<string, unknown>> {
  const term = promptTokens.selection
  const sentence = extractSentenceContaining(promptTokens.paragraphs, term)

  const translate = (text: string) =>
    translateTextCore({
      text,
      langConfig: language,
      providerConfig,
      hostedFeature: "selectionTranslation",
      dispatch,
    })

  const [definition, sentenceTranslation] = await Promise.all([
    translate(term),
    sentence && sentence !== term ? translate(sentence) : Promise.resolve(""),
  ])

  const fieldName = (id: string) => outputSchema.find((field) => field.id === id)?.name
  const result: Record<string, unknown> = {}
  const termKey = fieldName(DICTIONARY_FIELD_ID.term)
  const definitionKey = fieldName(DICTIONARY_FIELD_ID.definition)
  const contextKey = fieldName(DICTIONARY_FIELD_ID.context)
  const contextTranslationKey = fieldName(DICTIONARY_FIELD_ID.contextTranslation)
  if (termKey) result[termKey] = term
  if (definitionKey) result[definitionKey] = definition
  if (contextKey) result[contextKey] = sentence
  if (contextTranslationKey) result[contextTranslationKey] = sentenceTranslation
  return result
}
