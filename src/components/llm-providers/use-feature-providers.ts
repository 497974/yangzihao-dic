import type { ProviderConfig } from "@/types/config/provider"
import type { SelectionToolbarCustomAction } from "@/types/config/selection-toolbar"
import type { FeatureKey } from "@/utils/constants/feature-providers"
import type { ProviderSelectorOption } from "@/utils/providers/provider-display"
import { useAtomValue, useSetAtom } from "jotai"
import { useCallback, useMemo } from "react"
import { configAtom, configFieldsAtomMap, writeConfigAtom } from "@/utils/atoms/config"
import { getProviderConfigById } from "@/utils/config/helpers"
import {
  buildFeatureProviderPatch,
  FEATURE_PROVIDER_DEFS,
} from "@/utils/constants/feature-providers"
import { getSelectionToolbarActions, patchSelectionToolbarAction } from "@/utils/custom-actions"
import { isSystemProviderSelectorItem } from "@/utils/providers/provider-display"
import {
  getDictionaryProviders,
  getSelectableProvidersForCapability,
} from "@/utils/providers/provider-registry"
import { providerSupportsTranslationOnlyMode } from "@/utils/providers/translation-only-gate"
import { useHostedAiProviderOptions } from "./use-hosted-ai-provider-options"

export interface FeatureProviderBinding {
  providers: ProviderSelectorOption[]
  providerId: string
  providerConfig: ProviderConfig | null
  setProviderId: (providerId: string) => void
}

/** Reads and writes the provider a built-in feature runs on, independent of how it is laid out. */
export function useFeatureProvider(featureKey: FeatureKey): FeatureProviderBinding {
  const config = useAtomValue(configAtom)
  const setConfig = useSetAtom(writeConfigAtom)
  const providersConfig = useAtomValue(configFieldsAtomMap.providersConfig)
  const translationMode = useAtomValue(configFieldsAtomMap.pageTranslation).mode
  const providerId = FEATURE_PROVIDER_DEFS[featureKey].getProviderId(config)

  // Page translate in translationOnly mode cannot run on providers without
  // markup support (see translation-only-gate.ts) — hide them so the blocked
  // combination cannot be formed from a provider picker. Other features keep
  // the full list.
  const hideTranslationOnlyUnsupported =
    featureKey === "pageTranslation" && translationMode === "translationOnly"
  const baseProviders = useMemo(() => {
    const candidates = getSelectableProvidersForCapability(featureKey, providersConfig)
    if (!hideTranslationOnlyUnsupported) {
      return candidates
    }
    return candidates.filter(
      (option) =>
        isSystemProviderSelectorItem(option) ||
        providerSupportsTranslationOnlyMode(option.provider),
    )
  }, [featureKey, providersConfig, hideTranslationOnlyUnsupported])
  const providers = useHostedAiProviderOptions(featureKey, baseProviders)

  const setProviderId = useCallback(
    (id: string) => void setConfig(buildFeatureProviderPatch({ [featureKey]: id })),
    [featureKey, setConfig],
  )

  return {
    providers,
    providerId,
    providerConfig: getProviderConfigById(providersConfig, providerId) ?? null,
    setProviderId,
  }
}

export interface CustomActionProvidersBinding {
  /** Only the actions the user can actually trigger, so disabled ones stay out of the UI. */
  actions: SelectionToolbarCustomAction[]
  providers: ProviderSelectorOption[]
  /**
   * 词典专用的供应商列表——比 `providers` 多一档「普通翻译」（Google/Microsoft
   * Translate 等），因为内置词典能在缺词性分析的情况下退化成一次纯翻译调用
   * （见 use-custom-action-execution.ts 的快速词典分支）。其余自定义动作没有
   * 这条退路，一律沿用 `providers`。
   */
  dictionaryProviders: ProviderSelectorOption[]
  getProviderConfig: (action: SelectionToolbarCustomAction) => ProviderConfig | null
  setActionProviderId: (actionId: string, providerId: string) => void
}

/** Same as `useFeatureProvider`, for the custom AI actions in the selection toolbar. */
export function useCustomActionProviders(): CustomActionProvidersBinding {
  const config = useAtomValue(configAtom)
  const setConfig = useSetAtom(writeConfigAtom)
  const providersConfig = useAtomValue(configFieldsAtomMap.providersConfig)

  const baseProviders = useMemo(
    () => getSelectableProvidersForCapability("customAction", providersConfig),
    [providersConfig],
  )
  const providers = useHostedAiProviderOptions("customAction", baseProviders)
  const dictionaryProviders = useMemo(
    () => getDictionaryProviders(providersConfig),
    [providersConfig],
  )

  const actions = useMemo(
    () =>
      getSelectionToolbarActions(config.selectionToolbar).filter(
        (action) => action.enabled !== false,
      ),
    [config.selectionToolbar],
  )

  const setActionProviderId = useCallback(
    (actionId: string, providerId: string) =>
      void setConfig({
        selectionToolbar: patchSelectionToolbarAction(config.selectionToolbar, actionId, {
          providerId,
        }),
      }),
    [config.selectionToolbar, setConfig],
  )

  const getProviderConfig = useCallback(
    (action: SelectionToolbarCustomAction) =>
      getProviderConfigById(providersConfig, action.providerId) ?? null,
    [providersConfig],
  )

  return { actions, providers, dictionaryProviders, getProviderConfig, setActionProviderId }
}
