import type { GeneratedI18nStructure } from "#i18n"
import type { ProviderConfig, ProvidersConfig } from "@/types/config/provider"
import type { Theme } from "@/types/config/theme"
import type { FeatureKey } from "@/utils/constants/feature-providers"
import type {
  ProviderSelectorOption,
  SystemProviderSelectorItem,
} from "@/utils/providers/provider-display"
import readFrogLogo from "@/assets/providers/yangzihao-dic-provider.png?url&no-inline"
import {
  isLLMProviderConfig,
  isPureTranslateProviderConfig,
  isTranslateProviderConfig,
} from "@/types/config/provider"
import {
  BUILT_IN_AI_PROVIDER_IDS,
  BUILT_IN_AI_ADVANCE_PROVIDER_ID,
  type BuiltInAiProviderId,
  type HostedAiModelTier,
} from "@/utils/constants/provider-ids"
import { i18n } from "@/utils/i18n"

// 这两个 id 仍被别处引用（旧配置里可能残留这些 providerId，需要能识别出来），
// 所以继续转出；但内置 AI 本身已移除，配套的名称常量成了死代码，已删。
export {
  BUILT_IN_AI_PROVIDER_ID,
  BUILT_IN_AI_ADVANCE_PROVIDER_ID,
} from "@/utils/constants/provider-ids"
export const BUILT_IN_AI_PROVIDER_LOGO = readFrogLogo

export type ProviderCapability = FeatureKey | "customAction" | "languageDetection"
type SystemProviderNameKey = keyof GeneratedI18nStructure
type ProviderConfigPredicate<T extends ProviderConfig = ProviderConfig> = (
  provider: ProviderConfig,
) => provider is T

interface SystemProviderDef {
  id: BuiltInAiProviderId
  modelTier: HostedAiModelTier
  nameKey: SystemProviderNameKey
  fallbackName: string
  capabilities: readonly ProviderCapability[]
  logo: (theme: Theme) => string
}

export interface LocalProviderRef<T extends ProviderConfig = ProviderConfig> {
  kind: "local"
  config: T
  id: string
  name: string
}

export interface SystemProviderRef {
  kind: "system"
  id: BuiltInAiProviderId
  name: string
  modelTier: HostedAiModelTier
}

export type ResolvedProviderRef<T extends ProviderConfig = ProviderConfig> =
  | LocalProviderRef<T>
  | SystemProviderRef

// 本地化改动：上游的「内置 AI」/「高级内置 AI」是需要订阅的托管服务
// （见 src/entrypoints/background/hosted-ai-status.ts 等，本项目均未实现）。
// 没有后端支撑，留着只会让用户选中后失败或卡死，所以这里不注册任何系统
// 供应商 —— 可选的永远只有用户自己配的 API Key。下面用到的 BUILT_IN_AI_*
// 仍作为类型/常量导出，供 provider-config 的历史配置迁移脚本识别旧数据。
const SYSTEM_PROVIDER_DEFS = {} as const satisfies Record<string, SystemProviderDef>

function getSystemProviderDefs(): SystemProviderDef[] {
  return Object.values(SYSTEM_PROVIDER_DEFS)
}

const LOCAL_PROVIDER_CAPABILITY_PREDICATES = {
  pageTranslation: isTranslateProviderConfig,
  videoSubtitles: isTranslateProviderConfig,
  selectionTranslation: isTranslateProviderConfig,
  inputTranslation: isTranslateProviderConfig,
  noteSuggestion: isLLMProviderConfig,
  customAction: isLLMProviderConfig,
  languageDetection: isLLMProviderConfig,
} as const satisfies Record<ProviderCapability, ProviderConfigPredicate>

export type ProviderConfigForCapability<C extends ProviderCapability> =
  (typeof LOCAL_PROVIDER_CAPABILITY_PREDICATES)[C] extends ProviderConfigPredicate<infer T>
    ? T
    : never

export type ProviderRefForCapability<C extends ProviderCapability> = ResolvedProviderRef<
  ProviderConfigForCapability<C>
>

export type CustomActionProviderRef = ProviderRefForCapability<"customAction">
export type SelectionTranslationProviderRef = ProviderRefForCapability<"selectionTranslation">

function getSystemProviderName(def: SystemProviderDef): string {
  return i18n.t(def.nameKey as never) || def.fallbackName
}

function createSystemProviderSelectorItem(def: SystemProviderDef): SystemProviderSelectorItem {
  return {
    kind: "system",
    id: def.id,
    name: getSystemProviderName(def),
    logo: def.logo,
  }
}

function createSystemProviderRef(def: SystemProviderDef): SystemProviderRef {
  return {
    kind: "system",
    id: def.id,
    name: getSystemProviderName(def),
    modelTier: def.modelTier,
  }
}

function getSystemProviderDef(providerId: string): SystemProviderDef | undefined {
  return getSystemProviderDefs().find((def) => def.id === providerId)
}

export function isBuiltInAiProviderId(providerId: string): providerId is BuiltInAiProviderId {
  return BUILT_IN_AI_PROVIDER_IDS.includes(providerId as BuiltInAiProviderId)
}

export function getBuiltInAiProviderName(providerId: BuiltInAiProviderId): string {
  return getSystemProviderName(SYSTEM_PROVIDER_DEFS[providerId])
}

export function getHostedAiModelTier(providerId: BuiltInAiProviderId): HostedAiModelTier {
  return providerId === BUILT_IN_AI_ADVANCE_PROVIDER_ID ? "advance" : "normal"
}

export function isSystemProviderId(providerId: string): boolean {
  return !!getSystemProviderDef(providerId)
}

export function getLocalProviderPredicateForCapability<C extends ProviderCapability>(
  capability: C,
): ProviderConfigPredicate<ProviderConfigForCapability<C>> {
  return LOCAL_PROVIDER_CAPABILITY_PREDICATES[capability] as ProviderConfigPredicate<
    ProviderConfigForCapability<C>
  >
}

export function isLocalProviderConfigCompatibleWithCapability<C extends ProviderCapability>(
  capability: C,
  providerConfig: ProviderConfig,
): providerConfig is ProviderConfigForCapability<C> {
  return getLocalProviderPredicateForCapability(capability)(providerConfig)
}

export function getSystemProviderIdsForCapability(capability: ProviderCapability): string[] {
  return getSystemProviderDefs()
    .filter((def) => def.capabilities.includes(capability))
    .map((def) => def.id)
}

export function doesProviderSupportsCapability(
  capability: ProviderCapability,
  providersConfig: ProvidersConfig,
  providerId: string,
  options: { requireEnable?: boolean } = {},
): boolean {
  const providerConfig = providersConfig.find((provider) => provider.id === providerId)
  if (providerConfig) {
    return (
      (!options.requireEnable || providerConfig.enabled) &&
      isLocalProviderConfigCompatibleWithCapability(capability, providerConfig)
    )
  }

  const systemProvider = getSystemProviderDef(providerId)
  return !!systemProvider?.capabilities.includes(capability)
}

export function getProviderIdsForCapability(
  capability: ProviderCapability,
  providersConfig: ProvidersConfig,
  options: { requireEnable?: boolean } = {},
): string[] {
  const localIds = providersConfig
    .filter(
      (provider) =>
        (!options.requireEnable || provider.enabled) &&
        isLocalProviderConfigCompatibleWithCapability(capability, provider),
    )
    .map((provider) => provider.id)

  return [...localIds, ...getSystemProviderIdsForCapability(capability)]
}

export function getSelectableProvidersForCapability(
  capability: ProviderCapability,
  providersConfig: ProvidersConfig,
): ProviderSelectorOption[] {
  const systemProviders = getSystemProviderDefs()
    .filter((def) => def.capabilities.includes(capability))
    .map(createSystemProviderSelectorItem)

  const localProviders = providersConfig.filter(
    (provider) =>
      provider.enabled && isLocalProviderConfigCompatibleWithCapability(capability, provider),
  )

  return [...systemProviders, ...localProviders]
}

export function resolveProviderRefForCapability<C extends ProviderCapability>(
  capability: C,
  providersConfig: ProvidersConfig,
  providerId: string,
): ProviderRefForCapability<C> | null {
  const providerConfig = providersConfig.find((provider) => provider.id === providerId)
  if (providerConfig) {
    if (!isLocalProviderConfigCompatibleWithCapability(capability, providerConfig)) {
      return null
    }

    return {
      kind: "local",
      config: providerConfig,
      id: providerConfig.id,
      name: providerConfig.name,
    }
  }

  const systemProvider = getSystemProviderDef(providerId)
  if (!systemProvider?.capabilities.includes(capability)) {
    return null
  }

  return createSystemProviderRef(systemProvider)
}

/**
 * 词典专用的供应商解析——比普通 customAction 松一档。
 *
 * customAction 能力被限定成只认大模型（见 LOCAL_PROVIDER_CAPABILITY_PREDICATES），
 * 这对用户自定义的动作是对的：任意 systemPrompt 驱动的结构化抽取，脱离大模型
 * 就跑不动。但内置词典的输出字段是固定的（词条/音标/词性/释义/句子/句子翻译/
 * 难度），当引擎换成 Google/Microsoft 这类纯翻译接口时，能优雅降级——放弃
 * 词性和难度分析，只留"这个词/这句话翻译成什么"，用一次轻量翻译调用换取
 * 秒回（对照 use-custom-action-execution.ts 里的快速词典分支）。
 *
 * 所以词典的供应商解析要在标准 customAction 判定之外，再额外认一遍纯翻译
 * 供应商；其他自定义动作一律不享受这条口子。
 */
export function resolveDictionaryProviderRef(
  providersConfig: ProvidersConfig,
  providerId: string,
): CustomActionProviderRef | null {
  const asCustomAction = resolveProviderRefForCapability(
    "customAction",
    providersConfig,
    providerId,
  )
  if (asCustomAction) {
    return asCustomAction
  }

  const providerConfig = providersConfig.find((provider) => provider.id === providerId)
  if (providerConfig?.enabled && isPureTranslateProviderConfig(providerConfig)) {
    // 类型上仍标成 CustomActionProviderRef（config: LLMProviderConfig）——这里其实
    // 塞进去的是纯翻译配置，字段形状对不上。之所以敢这么断言，是因为消费方
    // （use-custom-action-execution.ts 的 buildCustomActionExecutionRequest）在
    // 访问任何 LLM 专属字段（.model/.providerOptions/.temperature）之前，都会先
    // 用 isLLMProviderConfig 做一次真正的运行时判断——那层判断读的是 .provider
    // 字符串，跟这里的静态类型无关，所以不会被这个断言糊弄过去、也不会踩空字段崩溃。
    return {
      kind: "local",
      config: providerConfig,
      id: providerConfig.id,
      name: providerConfig.name,
    } as CustomActionProviderRef
  }

  return null
}

/** 词典的供应商下拉列表：大模型 + 纯翻译引擎，专供内置词典这一个动作使用。 */
export function getDictionaryProviders(providersConfig: ProvidersConfig): ProviderSelectorOption[] {
  const llmProviders = getSelectableProvidersForCapability("customAction", providersConfig)
  const translateProviders = providersConfig.filter(
    (provider) => provider.enabled && isPureTranslateProviderConfig(provider),
  )
  return [...llmProviders, ...translateProviders]
}
