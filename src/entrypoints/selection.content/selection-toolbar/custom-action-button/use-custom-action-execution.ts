import type { JSONValue } from "ai"
import type { RefObject } from "react"
import type { SelectionToolbarCustomActionRequestSlice } from "../atoms"
import type { SelectionToolbarInlineError } from "../inline-error"
import type { AnalyticsSurface, FeatureProviderAnalytics } from "@/types/analytics"
import type {
  BackgroundStructuredObjectStreamSnapshot,
  ThinkingSnapshot,
} from "@/types/background-stream"
import type { Config } from "@/types/config/config"
import type { AISDKReasoning, ProviderConfig } from "@/types/config/provider"
import type { SelectionToolbarCustomAction } from "@/types/config/selection-toolbar"
import type { HostedAiModelTier } from "@/utils/constants/provider-ids"
import type { CachedWebPageContext } from "@/utils/host/translate/webpage-context"
import type { CustomActionProviderRef } from "@/utils/providers/provider-registry"
import { LANG_CODE_TO_EN_NAME } from "@read-frog/definitions"
import { useCallback, useEffect, useRef, useState } from "react"
import { ANALYTICS_FEATURE } from "@/types/analytics"
import { isLLMProviderConfig, isPureTranslateProviderConfig } from "@/types/config/provider"
import { createFeatureUsageContext, trackFeatureUsed } from "@/utils/analytics"
import { classifyResolvedProvider } from "@/utils/analytics-provider"
import { BUILT_IN_DICTIONARY_ACTION_ID } from "@/utils/constants/custom-action"
import { streamBackgroundStructuredObject } from "@/utils/content-script/background-stream-client"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import { translateTextCore } from "@/utils/host/translate/translate-text"
import { getOrCreateWebPageContext } from "@/utils/host/translate/webpage-context"
import { resolveModelId } from "@/utils/providers/model-id"
import { getProviderOptionsWithOverride } from "@/utils/providers/options"
import { getTopLevelReasoning } from "@/utils/providers/reasoning"
import { truncateContextTextForCustomAction } from "../../utils"
import {
  buildSelectionToolbarCustomActionSystemPrompt,
  replaceSelectionToolbarCustomActionPromptTokens,
} from "../custom-action-prompt"
import {
  createSelectionToolbarPrecheckError,
  createSelectionToolbarRuntimeError,
  isAbortError,
} from "../inline-error"

/** 内置词典各结构化字段的稳定 id——见 utils/constants/config.ts 里 createDefaultDictionaryAction 加的 "default-" 前缀 */
const DICTIONARY_FIELD_ID = {
  term: "default-dictionary-term",
  definition: "default-dictionary-definition",
  context: "default-dictionary-context",
  contextTranslation: "default-dictionary-context-translation",
} as const

/**
 * 在整段上下文里找出包含选中词/短语的那一句，用于「快速词典」——纯翻译引擎
 * 产不出例句，只能从已有的页面上下文里摘一句出来。
 *
 * 用 Intl.Segmenter 的 sentence 粒度而不是手写标点正则：中英文、日文的句读符号
 * 不一样，Segmenter 按 locale 规则分句更稳。找不到就退回选中文本本身，好过
 * 一整段没切开的原文。
 */
function extractSentenceContaining(paragraphs: string, selection: string): string {
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
 * 走这条路，而不是 streamBackgroundStructuredObject。
 *
 * 纯翻译引擎给不出词性/音标/难度这些结构化字段（这些需要"理解"而不是"翻译"），
 * 所以只填词条、释义（=词条的翻译）、例句（从页面上下文摘出来的原句）、例句翻译
 * 这四项，用一次轻量翻译调用换取秒回；换来的代价是没有词性分析，也不做原形
 * 归一化（"running" 不会被规范成 "run"）。结果对象的 key 用 outputSchema 里
 * 对应字段的 name（渲染层就是按 name 取值的，见 structured-object-renderer.tsx），
 * 不是这里的稳定 id。
 */
async function runFastDictionaryLookup(
  promptTokens: CustomActionExecutionContext["promptTokens"],
  outputSchema: SelectionToolbarCustomAction["outputSchema"],
  language: Config["language"],
  providerConfig: ProviderConfig,
): Promise<Record<string, unknown>> {
  const term = promptTokens.selection
  const sentence = extractSentenceContaining(promptTokens.paragraphs, term)

  const translate = (text: string) =>
    translateTextCore({
      text,
      langConfig: language,
      providerConfig,
      hostedFeature: "selectionTranslation",
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

interface CustomActionExecutionPlan {
  error: SelectionToolbarInlineError | null
  executionContext: CustomActionExecutionContext | null
}

interface ResolvedWebPageContext {
  popoverSessionKey: number
  value: CachedWebPageContext | null
}

interface CustomActionExecutionRequest {
  analytics: FeatureProviderAnalytics & {
    actionId: string
    actionName: string
    surface: AnalyticsSurface
  }
  key: string
  payload: {
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
  /** 非空时走快速词典分支，绕开 streamBackgroundStructuredObject——见 runFastDictionaryLookup */
  fastDictionary: {
    promptTokens: CustomActionExecutionContext["promptTokens"]
    outputSchema: SelectionToolbarCustomAction["outputSchema"]
    language: Config["language"]
    providerConfig: ProviderConfig
  } | null
}

const FOLLOW_STREAM_BOTTOM_THRESHOLD = 8

function scrollSelectionPopoverBodyToBottom(ref: RefObject<HTMLDivElement | null>) {
  const node = ref.current
  if (!node) {
    return
  }

  // Measured before the chunk renders: a reader who scrolled up to reread
  // earlier output must not be yanked back down, and measuring after the
  // append would misread "was at the bottom" as "far from it" whenever a
  // chunk adds more height than the threshold.
  const distanceToBottom = node.scrollHeight - node.scrollTop - node.clientHeight
  if (distanceToBottom > FOLLOW_STREAM_BOTTOM_THRESHOLD) {
    return
  }

  requestAnimationFrame(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight
    }
  })
}

function normalizeExecutionKeyValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeExecutionKeyValue)
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nestedValue]) => nestedValue !== undefined)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, nestedValue]) => [key, normalizeExecutionKeyValue(nestedValue)]),
    )
  }

  return value
}

function stringifyExecutionRequestKey(value: Record<string, unknown>) {
  return JSON.stringify(normalizeExecutionKeyValue(value))
}

export function buildCustomActionExecutionPlan(
  customActionRequest: SelectionToolbarCustomActionRequestSlice,
  cleanSelection: string,
  contextText: string,
  webPageContext?: CachedWebPageContext | null,
): CustomActionExecutionPlan {
  const action = customActionRequest.action

  if (!action) {
    return {
      error: createSelectionToolbarPrecheckError("customAction", "actionUnavailable"),
      executionContext: null,
    }
  }

  if (!cleanSelection) {
    return {
      error: createSelectionToolbarPrecheckError("customAction", "missingSelection"),
      executionContext: null,
    }
  }

  const provider = customActionRequest.provider
  if (!provider) {
    return {
      error: createSelectionToolbarPrecheckError("customAction", "providerUnavailable"),
      executionContext: null,
    }
  }

  if (provider.kind === "local" && !provider.config.enabled) {
    return {
      error: createSelectionToolbarPrecheckError("customAction", "providerDisabled"),
      executionContext: null,
    }
  }

  if (webPageContext === undefined) {
    return {
      error: null,
      executionContext: null,
    }
  }

  return {
    error: null,
    executionContext: {
      action,
      provider,
      language: customActionRequest.language,
      promptTokens: {
        selection: cleanSelection,
        paragraphs: truncateContextTextForCustomAction(contextText || cleanSelection),
        targetLanguage: LANG_CODE_TO_EN_NAME[customActionRequest.language.targetCode],
        webTitle: webPageContext?.webTitle ?? document.title,
        webContent: webPageContext?.webContent || "",
      },
    },
  }
}

export function useCustomActionWebPageContext(open: boolean, popoverSessionKey: number) {
  const [resolvedWebPageContext, setResolvedWebPageContext] =
    useState<ResolvedWebPageContext | null>(null)

  useEffect(() => {
    if (!open) {
      return undefined
    }

    let isCancelled = false

    void getOrCreateWebPageContext()
      .then((nextContext) => {
        if (!isCancelled) {
          setResolvedWebPageContext({
            popoverSessionKey,
            value: nextContext,
          })
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setResolvedWebPageContext({
            popoverSessionKey,
            value: null,
          })
        }
      })

    return () => {
      isCancelled = true
    }
  }, [open, popoverSessionKey])

  if (!open || resolvedWebPageContext?.popoverSessionKey !== popoverSessionKey) {
    return undefined
  }

  return resolvedWebPageContext.value
}

function buildCustomActionExecutionRequest({
  analyticsSurface,
  executionContext,
  popoverSessionKey,
  rerunNonce,
}: {
  analyticsSurface: AnalyticsSurface
  executionContext: CustomActionExecutionContext
  popoverSessionKey: number
  rerunNonce: number
}): CustomActionExecutionRequest {
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
    analytics: {
      actionId: action.id,
      actionName: action.name,
      surface: analyticsSurface,
      ...classifyResolvedProvider(provider),
    },
    key: stringifyExecutionRequestKey({
      actionId: action.id,
      analyticsSurface,
      model,
      outputSchema: action.outputSchema.map(({ description, name, type }) => ({
        description,
        name,
        type,
      })),
      popoverSessionKey,
      prompt,
      promptTokens,
      provider: providerKey,
      providerId: provider.id,
      providerOptions,
      reasoning,
      rerunNonce,
      instructions: systemPrompt,
      temperature,
    }),
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
  }
}

export function useCustomActionExecution({
  analyticsSurface,
  bodyRef,
  executionContext,
  open,
  popoverSessionKey,
  rerunNonce,
}: {
  analyticsSurface: AnalyticsSurface
  bodyRef: RefObject<HTMLDivElement | null>
  executionContext: CustomActionExecutionContext | null
  open: boolean
  popoverSessionKey: number
  rerunNonce: number
}) {
  const [isRunning, setIsRunning] = useState(false)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<SelectionToolbarInlineError | null>(null)
  const [thinking, setThinking] = useState<ThinkingSnapshot | null>(null)
  const lastRunKeyRef = useRef<string | null>(null)
  const bodyRefRef = useRef(bodyRef)
  bodyRefRef.current = bodyRef
  const executionRequest = executionContext
    ? buildCustomActionExecutionRequest({
        analyticsSurface,
        executionContext,
        popoverSessionKey,
        rerunNonce,
      })
    : null
  const executionRequestRef = useRef<CustomActionExecutionRequest | null>(null)
  executionRequestRef.current = executionRequest
  const executionRequestKey = executionRequest?.key ?? null

  const resetSessionState = useCallback(() => {
    setIsRunning(false)
    setResult(null)
    setError(null)
    setThinking(null)
  }, [])

  useEffect(() => {
    if (!open || !executionRequestKey) {
      return undefined
    }

    const request = executionRequestRef.current
    if (!request || request.key !== executionRequestKey) {
      return undefined
    }

    if (lastRunKeyRef.current === executionRequestKey) {
      return undefined
    }
    lastRunKeyRef.current = executionRequestKey

    let isCancelled = false
    const abortController = new AbortController()

    const analyticsContext = createFeatureUsageContext(
      ANALYTICS_FEATURE.CUSTOM_AI_ACTION,
      request.analytics.surface,
      Date.now(),
      {
        action_id: request.analytics.actionId,
        action_name: request.analytics.actionName,
      },
    )
    const providerAnalytics: FeatureProviderAnalytics = {
      provider: request.analytics.provider,
      backend_kind: request.analytics.backend_kind,
    }

    const run = async () => {
      setIsRunning(true)
      setResult(null)
      setError(null)
      setThinking({
        status: "thinking",
        text: "",
      })

      try {
        if (request.fastDictionary) {
          // 纯翻译引擎——一次 translateTextCore 就完事，没有分片可流式渲染
          const output = await runFastDictionaryLookup(
            request.fastDictionary.promptTokens,
            request.fastDictionary.outputSchema,
            request.fastDictionary.language,
            request.fastDictionary.providerConfig,
          )

          if (isCancelled) {
            return
          }

          setResult(output)
          setThinking(null)
        } else {
          const finalResult = await streamBackgroundStructuredObject(
            {
              ...request.payload,
              requestId: getRandomUUID(),
            },
            {
              signal: abortController.signal,
              onChunk: (partial: BackgroundStructuredObjectStreamSnapshot) => {
                if (isCancelled) {
                  return
                }

                setResult(partial.output)
                setThinking(partial.thinking)
                scrollSelectionPopoverBodyToBottom(bodyRefRef.current)
              },
            },
          )

          if (isCancelled) {
            return
          }

          setResult(finalResult.output)
          setThinking(finalResult.thinking)
        }

        void trackFeatureUsed({
          ...analyticsContext,
          ...providerAnalytics,
          outcome: "success",
        })
      } catch (caughtError) {
        if (isAbortError(caughtError)) {
          return
        }

        if (isCancelled) {
          return
        }

        setThinking((prev) => (prev?.text ? { ...prev, status: "complete" } : null))
        setError(createSelectionToolbarRuntimeError("customAction", caughtError))
        void trackFeatureUsed({
          ...analyticsContext,
          ...providerAnalytics,
          outcome: "failure",
        })
      } finally {
        if (!isCancelled) {
          setIsRunning(false)
        }
      }
    }

    void run()

    return () => {
      isCancelled = true
      abortController.abort()
    }
  }, [executionRequestKey, open])

  useEffect(() => {
    if (!open) {
      lastRunKeyRef.current = null
    }
  }, [open])

  return {
    error,
    isRunning,
    resetSessionState,
    result,
    thinking,
  }
}
