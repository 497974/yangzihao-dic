/**
 * 桌面版查词服务（桌面版方案第 1 步）。
 *
 * 桌面程序在 QQ、Word 等地方取到文字后交给这里查。查词完全复用扩展里的内置词典：
 * 同一个动作、同一套提示词和输出字段（含助记）、同一个供应商和 API Key——
 * 所以桌面弹窗里看到的，和网页里划词看到的一模一样，存进生词本的格式也一致。
 *
 * 两条路与网页端相同：
 * - 供应商是大模型 → 后台结构化查词（runStructuredObjectStreamInBackground）
 * - 供应商是纯翻译引擎 → 快速词典。注意网页端的快速词典是经消息把翻译请求交给后台，
 *   这里本身就在后台，必须传入直接派发的函数，否则后台给自己发消息没有接收方。
 */

import type { ThinkingSnapshot } from "@/types/background-stream"
import type { Config } from "@/types/config/config"
import type { DictionaryLookupRecord } from "@/types/lookup-history"
import { LANG_CODE_TO_EN_NAME } from "@read-frog/definitions"
import { truncateContextTextForCustomAction } from "@/entrypoints/selection.content/utils"
import { BUILT_IN_DICTIONARY_ACTION_ID } from "@/utils/constants/custom-action"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import { buildCustomActionPayload, runFastDictionaryLookup } from "@/utils/custom-action-execution"
import { findSelectionToolbarAction } from "@/utils/custom-actions"
import {
  resolveDictionaryProviderRef,
  resolveProviderRefForCapability,
} from "@/utils/providers/provider-registry"
import { runStructuredObjectStreamInBackground } from "../background-stream"
import { ensureInitializedConfig } from "../config"
import { recordDictionaryLookup } from "../lookup-history"
import { enqueueTranslateRequestInBackground } from "../translation-queues"

export interface DesktopLookupRequest {
  /** 选中的文字 */
  text: string
  /** 选中文字所在的整句或整段；取不到就不传，退回用选中文字本身 */
  context?: string
  /** 来源程序的窗口标题（如「QQ」「报告.docx - Word」），填进提示词里网页标题的位置 */
  sourceTitle?: string
  /** 划词工具栏上的哪个动作；不传就是内置词典 */
  actionId?: string
  /** 「重新生成」：不用上次查过的结果，重新问大模型 */
  fresh?: boolean
}

export interface DesktopLookupResult {
  /** 词典字段，key 是字段名（词条、音标、释义……），和网页词典弹窗里一致 */
  fields: Record<string, unknown>
  /** 字段的展示顺序、类型、能不能朗读，桌面弹窗按它渲染 */
  outputSchema: { name: string; type: string; speaking: boolean }[]
  /** 走的是不是快速词典：纯翻译引擎只有词条、释义、例句、例句翻译四项 */
  fast: boolean
  /** 算上这一次查了几次（只有内置词典记，重新生成不算） */
  lookupCount?: number
  /** 存过的词又查了一次，它的复习卡被提前到了今天 */
  reviewBumped?: boolean
}

/**
 * 大模型查词的中途进度。网页弹窗是边生成边显示的，桌面弹窗也一样：
 * 先收到字段列表（全是"…"），然后字段一个个填上。thinking 是推理模型的思考过程。
 */
export interface DesktopLookupProgress {
  fields: Record<string, unknown>
  outputSchema: DesktopLookupResult["outputSchema"]
  thinking: ThinkingSnapshot | null
}

export type DesktopLookupErrorCode =
  | "empty_selection"
  | "config_unavailable"
  | "provider_unavailable"
  | "action_unavailable"

/** 可以直接展示给用户的错误：message 就是给人看的原因 */
export class DesktopLookupError extends Error {
  constructor(
    readonly code: DesktopLookupErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "DesktopLookupError"
  }
}

interface LookupDeps {
  getConfig: () => Promise<Config | null | undefined>
  /** 记一次查词；不传就用真的（见 lookup-history.ts） */
  recordLookup?: (text: string) => Promise<DictionaryLookupRecord | null>
}

const defaultDeps: LookupDeps = {
  getConfig: ensureInitializedConfig,
  recordLookup: recordDictionaryLookup,
}

function lookupStats(record: DictionaryLookupRecord | null) {
  return record ? { lookupCount: record.count, reviewBumped: record.reviewBumped } : {}
}

export async function lookupDictionaryForDesktop(
  request: DesktopLookupRequest,
  options: { signal?: AbortSignal; onProgress?: (progress: DesktopLookupProgress) => void } = {},
  deps: LookupDeps = defaultDeps,
): Promise<DesktopLookupResult> {
  const text = request.text.trim()
  if (!text) {
    throw new DesktopLookupError("empty_selection", "没有取到选中的文字")
  }

  const config = await deps.getConfig()
  if (!config) {
    throw new DesktopLookupError("config_unavailable", "扩展的配置还没准备好，请稍后再试")
  }

  // 用划词工具栏里的动作本身（默认是内置词典），不另起一套：字段、提示词、供应商都跟网页端走同一份
  const action = findSelectionToolbarAction(
    config.selectionToolbar,
    request.actionId ?? BUILT_IN_DICTIONARY_ACTION_ID,
  )
  if (!action || action.enabled === false) {
    throw new DesktopLookupError(
      "action_unavailable",
      "这个动作已经被删掉或关掉了。请重新选中文字，用工具栏上现有的按钮",
    )
  }
  // 查词次数：只记内置词典，「重新生成」不算又查了一次；查成功了才记（和网页词典一样），
  // 查失败、超时不算。记一次只要几毫秒，不影响出结果
  const shouldRecord = action.id === BUILT_IN_DICTIONARY_ACTION_ID && !request.fresh
  const recordLookup = async () =>
    shouldRecord ? (deps.recordLookup ?? recordDictionaryLookup)(text).catch(() => null) : null
  // 和网页端一样：词典可以挂纯翻译引擎（快速词典），其余自定义动作只能用大模型
  const provider =
    action.id === BUILT_IN_DICTIONARY_ACTION_ID
      ? resolveDictionaryProviderRef(config.providersConfig, action.providerId)
      : resolveProviderRefForCapability("customAction", config.providersConfig, action.providerId)
  if (!provider) {
    throw new DesktopLookupError(
      "provider_unavailable",
      `「${action.name}」用的服务不可用。请到扩展设置 → 划词工具栏，检查它的供应商是否已启用`,
    )
  }

  const { payload, fastDictionary } = buildCustomActionPayload({
    action,
    provider,
    language: config.language,
    promptTokens: {
      selection: text,
      paragraphs: truncateContextTextForCustomAction(request.context?.trim() || text),
      targetLanguage: LANG_CODE_TO_EN_NAME[config.language.targetCode],
      webTitle: request.sourceTitle?.trim() ?? "",
      webContent: "",
    },
  })
  const outputSchema = action.outputSchema.map(({ name, type, speaking }) => ({
    name,
    type,
    speaking,
  }))

  if (fastDictionary) {
    const fields = await runFastDictionaryLookup(
      fastDictionary.promptTokens,
      fastDictionary.outputSchema,
      fastDictionary.language,
      fastDictionary.providerConfig,
      enqueueTranslateRequestInBackground,
    )
    return { fields, outputSchema, fast: true, ...lookupStats(await recordLookup()) }
  }

  // 先把字段列表发过去，桌面弹窗立刻就能摆出和网页一样的空字段，不用干等
  options.onProgress?.({ fields: {}, outputSchema, thinking: null })
  // 查过的词直接用上次的结果，不再花一次大模型的钱（见 structured-result-cache.ts）
  const snapshot = await runStructuredObjectStreamInBackground(
    { ...payload, requestId: getRandomUUID(), cache: request.fresh ? "refresh" : "use" },
    {
      signal: options.signal,
      onChunk: (chunk) => {
        options.onProgress?.({
          fields: chunk.output,
          outputSchema,
          thinking: chunk.thinking ?? null,
        })
      },
    },
  )
  return {
    fields: snapshot.output,
    outputSchema,
    fast: false,
    ...lookupStats(await recordLookup()),
  }
}
