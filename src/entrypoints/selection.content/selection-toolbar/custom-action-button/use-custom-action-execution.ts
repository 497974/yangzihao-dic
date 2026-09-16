import type { RefObject } from "react"
import type { SelectionToolbarCustomActionRequestSlice } from "../atoms"
import type { SelectionToolbarInlineError } from "../inline-error"
import type { AnalyticsSurface, FeatureProviderAnalytics } from "@/types/analytics"
import type {
  BackgroundStructuredObjectStreamSnapshot,
  ThinkingSnapshot,
} from "@/types/background-stream"
import type { DictionaryLookupRecord } from "@/types/lookup-history"
import type { CachedWebPageContext } from "@/utils/host/translate/webpage-context"
import { LANG_CODE_TO_EN_NAME } from "@read-frog/definitions"
import { useCallback, useEffect, useRef, useState } from "react"
import { ANALYTICS_FEATURE } from "@/types/analytics"
import { createFeatureUsageContext, trackFeatureUsed } from "@/utils/analytics"
import { classifyResolvedProvider } from "@/utils/analytics-provider"
import { BUILT_IN_DICTIONARY_ACTION_ID } from "@/utils/constants/custom-action"
import { streamBackgroundStructuredObject } from "@/utils/content-script/background-stream-client"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import {
  buildCustomActionPayload,
  type CustomActionExecutionContext,
  type CustomActionPayload,
  type FastDictionaryRequest,
  runFastDictionaryLookup,
} from "@/utils/custom-action-execution"
import { getOrCreateWebPageContext } from "@/utils/host/translate/webpage-context"
import { sendMessage } from "@/utils/message"
import { truncateContextTextForCustomAction } from "../../utils"
import {
  createSelectionToolbarPrecheckError,
  createSelectionToolbarRuntimeError,
  isAbortError,
} from "../inline-error"

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
  payload: CustomActionPayload
  fastDictionary: FastDictionaryRequest | null
  /** 同一个弹窗里 rerunNonce 变了 = 点了「重新生成」，这次不用缓存 */
  popoverSessionKey: number
  rerunNonce: number
  /** 选中的词，记查词次数用 */
  selectionText: string
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
  const { action, provider, promptTokens } = executionContext
  // 负载构造与桌面版查词共用一份（见 utils/custom-action-execution.ts）
  const { payload, fastDictionary, model, providerKey } = buildCustomActionPayload(executionContext)

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
      prompt: payload.prompt,
      promptTokens,
      provider: providerKey,
      providerId: provider.id,
      providerOptions: payload.providerOptions,
      reasoning: payload.reasoning,
      rerunNonce,
      instructions: payload.instructions,
      temperature: payload.temperature,
    }),
    payload,
    fastDictionary,
    popoverSessionKey,
    rerunNonce,
    selectionText: promptTokens.selection,
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
  /** 这个词第几次查；只有内置词典有，查完才有 */
  const [lookupRecord, setLookupRecord] = useState<DictionaryLookupRecord | null>(null)
  const lastRunKeyRef = useRef<string | null>(null)
  const lastRunSessionRef = useRef<{ popoverSessionKey: number; rerunNonce: number } | null>(null)
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
    setLookupRecord(null)
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

    // 同一个弹窗里 rerunNonce 变了 = 用户点了「重新生成」：不用上次查过的结果，重新问模型
    const previousRun = lastRunSessionRef.current
    const isRegenerate =
      previousRun?.popoverSessionKey === request.popoverSessionKey &&
      previousRun.rerunNonce !== request.rerunNonce
    lastRunSessionRef.current = {
      popoverSessionKey: request.popoverSessionKey,
      rerunNonce: request.rerunNonce,
    }

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
          // 查过的词直接用上次的结果，不再花一次大模型的钱（见 background/structured-result-cache.ts）
          const finalResult = await streamBackgroundStructuredObject(
            {
              ...request.payload,
              requestId: getRandomUUID(),
              cache: isRegenerate ? "refresh" : "use",
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

        // 查词次数：只记内置词典，「重新生成」不算又查了一次（见 background/lookup-history.ts）
        if (request.analytics.actionId === BUILT_IN_DICTIONARY_ACTION_ID && !isRegenerate) {
          void (async () => {
            try {
              const record = await sendMessage("recordDictionaryLookup", {
                text: request.selectionText,
              })
              if (!isCancelled) {
                setLookupRecord(record)
              }
            } catch {
              // 记不下来只是少显示一个「第几次查」，不影响查词
            }
          })()
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
    lookupRecord,
    resetSessionState,
    result,
    thinking,
  }
}
