/**
 * 设置页里需要 AI 的练习功能（写作纠错、对话练习）用哪个供应商、怎么拼请求参数。
 *
 * 一律用「词典」那个动作配的供应商：用户已经为词典配好了 AI，这里不该再让人配第二遍，
 * 也保证几个功能的费用都走同一个账户、行为一致。
 */

import type { SelectionToolbarCustomAction } from "@/types/config/selection-toolbar"
import type { CustomActionProviderRef } from "@/utils/providers/provider-registry"
import { useAtomValue } from "jotai"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { BUILT_IN_DICTIONARY_ACTION_ID } from "@/utils/constants/custom-action"
import { buildCustomActionPayload } from "@/utils/custom-action-execution"
import { findSelectionToolbarAction } from "@/utils/custom-actions"
import { resolveProviderRefForCapability } from "@/utils/providers/provider-registry"

/** 词典所用的 AI 供应商；没配、或配的是纯翻译引擎（不能做对话和批改）时为 null */
export function useDictionaryAiProvider(): CustomActionProviderRef | null {
  const selectionToolbar = useAtomValue(configFieldsAtomMap.selectionToolbar)
  const providersConfig = useAtomValue(configFieldsAtomMap.providersConfig)
  const providerId = findSelectionToolbarAction(
    selectionToolbar,
    BUILT_IN_DICTIONARY_ACTION_ID,
  )?.providerId
  return providerId
    ? resolveProviderRefForCapability("customAction", providersConfig, providerId)
    : null
}

/**
 * 按某个「临时动作」拼出结构化输出请求（系统提示、字段约定、温度、推理参数都在里面）。
 * 临时动作不进配置、不出现在划词工具栏，只借用划词动作那套请求构造逻辑。
 */
export function buildAiPayload(
  provider: CustomActionProviderRef,
  language: Parameters<typeof buildCustomActionPayload>[0]["language"],
  action: SelectionToolbarCustomAction,
  input: string,
) {
  return buildCustomActionPayload({
    action,
    provider,
    language,
    promptTokens: {
      selection: input,
      paragraphs: input,
      targetLanguage: "Chinese",
      webTitle: "",
      webContent: "",
    },
  }).payload
}
