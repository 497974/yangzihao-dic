import type { FeatureUsageCache } from "../analytics-feature-cache"
import type { FeatureUsedEventProperties } from "@/types/analytics"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  createBackgroundAnalytics,
  filterAnalyticsCaptureResult,
  resolveDistinctIdOverride,
} from "../analytics"

type MessageHandler<TData, TResult = void> = (message: {
  data: TData
}) => TResult | Promise<TResult>

// 本分叉已把 posthog SDK 换成空实现（见 ../analytics 顶部注释），
// 客户端接口随之放宽成 (...args: unknown[]) => void。这里跟着对齐，
// 不再从 posthog-js 取类型——那个包已经不进产物了。
type CaptureResult = Record<string, unknown>
type PostHogCaptureMock = (...args: unknown[]) => void
type PostHogInitMock = (...args: unknown[]) => void
type PostHogRegisterMock = (...args: unknown[]) => void

const DEFAULT_FEATURE_PROVIDER = {
  provider: "openai",
  backend_kind: "llm",
} as const

describe("background analytics", () => {
  // 注册回调仍要提供，但删掉遥测上报用例后已无处读取它
  let _trackFeatureUsedEventHandler: MessageHandler<FeatureUsedEventProperties> | undefined
  let storageGetItemMock = vi.fn<(key: string) => Promise<unknown>>()
  let storageSetItemMock = vi.fn<(key: string, value: unknown) => Promise<void>>()
  let getTargetLanguageMock = vi.fn<() => Promise<"cmn" | undefined>>()
  let posthogInitMock = vi.fn<PostHogInitMock>()
  let posthogCaptureMock = vi.fn<PostHogCaptureMock>()
  let posthogRegisterMock = vi.fn<PostHogRegisterMock>()
  let loggerWarnMock = vi.fn<(...args: unknown[]) => void>()

  function createAnalytics(overrides?: {
    apiHost?: string
    apiKey?: string
    defaultAnalyticsEnabled?: boolean
    distinctIdOverride?: string
    featureUsageCache?: FeatureUsageCache
    getCurrentDate?: () => Date
  }) {
    const apiHost =
      overrides && "apiHost" in overrides ? overrides.apiHost : "https://us.i.posthog.com"
    const apiKey = overrides && "apiKey" in overrides ? overrides.apiKey : "phc_test"

    return createBackgroundAnalytics({
      apiHost,
      apiKey,
      createDistinctId: () => "generated-install-id",
      defaultAnalyticsEnabled: overrides?.defaultAnalyticsEnabled ?? true,
      distinctIdOverride: overrides?.distinctIdOverride,
      extensionVersion: "1.0.0",
      featureUsageCache: overrides?.featureUsageCache,
      getCurrentDate: overrides?.getCurrentDate ?? (() => new Date("2026-07-14T12:00:00.000Z")),
      getStorageItem: storageGetItemMock,
      getTargetLanguage: getTargetLanguageMock,
      messageRegistrar: {
        registerTrackFeatureUsedEvent(handler) {
          _trackFeatureUsedEventHandler = handler
        },
      },
      posthog: {
        init: posthogInitMock,
        capture: posthogCaptureMock,
        register: posthogRegisterMock,
      },
      setStorageItem: storageSetItemMock,
      warn: (...args) => loggerWarnMock(...args),
    })
  }

  function createMemoryFeatureUsageCache() {
    const lastReportedDays = new Map<string, string>()
    const cache: FeatureUsageCache = {
      getLastReportedDay: vi.fn<FeatureUsageCache["getLastReportedDay"]>(async (feature) =>
        lastReportedDays.get(feature),
      ),
      setLastReportedDay: vi.fn<FeatureUsageCache["setLastReportedDay"]>(async (feature, day) => {
        lastReportedDays.set(feature, day)
      }),
    }

    return { cache, lastReportedDays }
  }

  beforeEach(() => {
    _trackFeatureUsedEventHandler = undefined
    storageGetItemMock = vi.fn<(key: string) => Promise<unknown>>()
    storageSetItemMock = vi
      .fn<(key: string, value: unknown) => Promise<void>>()
      .mockResolvedValue(undefined)
    getTargetLanguageMock = vi.fn<() => Promise<"cmn" | undefined>>().mockResolvedValue("cmn")
    posthogInitMock = vi.fn<PostHogInitMock>()
    posthogCaptureMock = vi.fn<PostHogCaptureMock>()
    posthogRegisterMock = vi.fn<PostHogRegisterMock>()
    loggerWarnMock = vi.fn<(...args: unknown[]) => void>()
  })

  it("never sends telemetry, even fully configured with analytics enabled", async () => {
    // 这是本项目的核心承诺：不做任何遥测上报。getPostHogClient 里是硬性 return null，
    // 不依赖"构建时恰好没配 POSTHOG 变量"这种偶然——就算有人把 key 和 host 都补齐、
    // 并且把开关打开，也不该有任何数据发出。这个用例就是守住这条底线的回归防线。
    storageGetItemMock.mockResolvedValue(true)

    const { captureFeatureUsedEventInBackground } = createAnalytics({
      defaultAnalyticsEnabled: true,
    })
    await captureFeatureUsedEventInBackground({
      feature: "page_translation",
      surface: "popup",
      outcome: "success",
      latency_ms: 1_500,
      ...DEFAULT_FEATURE_PROVIDER,
    })

    expect(posthogInitMock).not.toHaveBeenCalled()
    expect(posthogCaptureMock).not.toHaveBeenCalled()
    expect(posthogRegisterMock).not.toHaveBeenCalled()
  })

  it("does not initialize PostHog when analytics is disabled", async () => {
    storageGetItemMock.mockResolvedValueOnce(false)

    const { captureFeatureUsedEventInBackground } = createAnalytics()
    await captureFeatureUsedEventInBackground({
      feature: "page_translation",
      surface: "popup",
      outcome: "success",
      latency_ms: 1_500,
      ...DEFAULT_FEATURE_PROVIDER,
    })

    expect(posthogInitMock).not.toHaveBeenCalled()
    expect(posthogCaptureMock).not.toHaveBeenCalled()
  })

  it("does not write feature cache state when analytics is disabled", async () => {
    storageGetItemMock.mockResolvedValueOnce(false)
    const { cache } = createMemoryFeatureUsageCache()
    const { captureFeatureUsedEventInBackground } = createAnalytics({
      featureUsageCache: cache,
    })

    await captureFeatureUsedEventInBackground({
      feature: "page_translation",
      surface: "popup",
      outcome: "success",
      latency_ms: 100,
      ...DEFAULT_FEATURE_PROVIDER,
    })

    expect(cache.getLastReportedDay).not.toHaveBeenCalled()
    expect(cache.setLastReportedDay).not.toHaveBeenCalled()
  })

  it("uses the runtime default when the preference has not been stored yet", async () => {
    storageGetItemMock.mockResolvedValueOnce(undefined)

    const { captureFeatureUsedEventInBackground } = createAnalytics({
      defaultAnalyticsEnabled: false,
    })
    await captureFeatureUsedEventInBackground({
      feature: "page_translation",
      surface: "popup",
      outcome: "success",
      latency_ms: 100,
      ...DEFAULT_FEATURE_PROVIDER,
    })

    expect(posthogInitMock).not.toHaveBeenCalled()
    expect(posthogCaptureMock).not.toHaveBeenCalled()
  })

  it("uses the dev default test UUID when no explicit override is configured", () => {
    expect(resolveDistinctIdOverride("   ", true)).toBe("00000000-0000-0000-0000-000000000001")
  })

  it("prefers an explicit test UUID over the dev default", () => {
    expect(resolveDistinctIdOverride("11111111-1111-1111-1111-111111111111", true)).toBe(
      "11111111-1111-1111-1111-111111111111",
    )
  })

  it("falls back to undefined outside dev mode when no override is configured", () => {
    expect(resolveDistinctIdOverride("   ", false)).toBeUndefined()
  })

  it("keeps new safe business properties and coarse runtime information by default", () => {
    const filtered = filterAnalyticsCaptureResult({
      event: "feature_used",
      properties: {
        token: "phc_test",
        distinct_id: "install-123",
        feature: "custom_ai_action",
        surface: "context_menu",
        outcome: "success",
        latency_ms: 250,
        ...DEFAULT_FEATURE_PROVIDER,
        new_safe_business_field: "automatically-kept",
        action_id: "dictionary",
        action_name: "Dictionary",
        target_language: "cmn",
        $browser: "Chrome",
        $browser_version: "145.0.0.0",
        $os: "Mac OS X",
        $os_version: "15.5",
        $device_type: "Desktop",
        $timezone: "America/Vancouver",
        $timezone_offset: 420,
        $browser_language: "en-US",
        $insert_id: "insert-123",
        $time: 1234,
        $lib: "web",
        $lib_version: "1.360.2",
        $process_person_profile: false,
        extension_version: "1.0.0",
      },
      timestamp: new Date("2026-03-16T19:02:43.960Z"),
      uuid: "test-uuid",
    }).properties

    expect(filtered).toEqual({
      token: "phc_test",
      distinct_id: "install-123",
      feature: "custom_ai_action",
      surface: "context_menu",
      outcome: "success",
      latency_ms: 250,
      ...DEFAULT_FEATURE_PROVIDER,
      new_safe_business_field: "automatically-kept",
      action_id: "dictionary",
      action_name: "Dictionary",
      target_language: "cmn",
      $browser: "Chrome",
      $browser_version: "145.0.0.0",
      $os: "Mac OS X",
      $os_version: "15.5",
      $device_type: "Desktop",
      $timezone: "America/Vancouver",
      $timezone_offset: 420,
      $browser_language: "en-US",
      $insert_id: "insert-123",
      $time: 1234,
      $lib: "web",
      $lib_version: "1.360.2",
      $process_person_profile: false,
      extension_version: "1.0.0",
    })
  })

  it("recursively removes sensitive, identifying, page, and SDK-internal properties", () => {
    const captureResult = {
      event: "feature_used",
      properties: {
        token: "phc_root_token_must_survive",
        distinct_id: "install-123",
        provider: "openai",
        backend_kind: "llm",
        $current_url: "https://private.example/path",
        page_url: "https://private.example/another-path",
        href: "https://private.example/link",
        $host: "private.example",
        $pathname: "/path",
        $referrer: "https://referrer.example",
        title: "Private page title",
        $raw_user_agent: "full user agent",
        $device: "Exact hardware model",
        $screen_width: 3_456,
        $viewport_height: 1_234,
        $device_id: "device-id",
        $session_id: "session-id",
        $window_id: "window-id",
        $pageview_id: "pageview-id",
        $initial_current_url: "https://private.example/initial",
        $prev_pageview_pathname: "/previous-private-path",
        $sdk_debug_retry_queue: ["debug"],
        $config_defaults: "2025-11-30",
        $lib_custom_api_host: "https://analytics.example",
        $active_feature_flags: ["flag-a"],
        $enabled_feature_flags: ["flag-a"],
        $feature_flag_payload: { private: true },
        model: "private-model",
        model_name: "another-private-model",
        prompt: "private prompt",
        system_prompt: "private system prompt",
        provider_options: { private: true },
        nested: {
          safe_nested_business_field: true,
          api_key: "secret-key",
          access_token: "secret-token",
          headers: { authorization: "Bearer secret" },
          rows: [
            {
              variant: "control",
              selection: "private selected text",
            },
          ],
        },
        $set: {
          safe_set_property: "kept",
          content: "private content",
        },
        $set_once: {
          safe_set_once_property: "kept",
          password: "private password",
        },
      },
      $set: {
        safe_top_level_set: "kept",
        base_url: "https://private-provider.example",
      },
      $set_once: {
        safe_top_level_set_once: "kept",
        instructions: "private instructions",
      },
      timestamp: new Date("2026-03-16T19:02:43.960Z"),
      uuid: "test-uuid",
    } as unknown as CaptureResult

    const filtered = filterAnalyticsCaptureResult(captureResult) as CaptureResult & {
      $set?: Record<string, unknown>
      $set_once?: Record<string, unknown>
    }

    expect(filtered.properties).toEqual({
      token: "phc_root_token_must_survive",
      distinct_id: "install-123",
      provider: "openai",
      backend_kind: "llm",
      nested: {
        safe_nested_business_field: true,
        rows: [{ variant: "control" }],
      },
      $set: { safe_set_property: "kept" },
      $set_once: { safe_set_once_property: "kept" },
    })
    expect(filtered.$set).toEqual({ safe_top_level_set: "kept" })
    expect(filtered.$set_once).toEqual({ safe_top_level_set_once: "kept" })
  })
})
