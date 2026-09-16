import type { Config } from "@/types/config/config"
import { describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"

// 后台的文本流和翻译队列都很重，这里只关心"划词翻译把请求交对了地方"
vi.mock("../../background-stream", () => ({
  runStreamTextInBackground: vi.fn<(...args: any[]) => any>(),
}))
vi.mock("../../translation-queues", () => ({
  enqueueTranslateRequestInBackground: vi.fn<(...args: any[]) => any>(),
}))
vi.mock("../../config", () => ({
  ensureInitializedConfig: vi.fn<(...args: any[]) => any>(),
}))

const { translateSelectionForDesktop } = await import("../selection-translate")
const { enqueueTranslateRequestInBackground } = await import("../../translation-queues")

/** 划词翻译用哪个供应商；enabled 控制这个供应商开没开 */
function configWithTranslateProvider(providerId: string, enabled = true): Config {
  const config = structuredClone(DEFAULT_CONFIG)
  config.selectionToolbar.features.translate.providerId = providerId
  const provider = config.providersConfig.find((candidate) => candidate.id === providerId)
  if (provider) {
    provider.enabled = enabled
  }
  return config
}

function createDeps(config: Config | null) {
  const runStreamText = vi.fn<(...args: any[]) => any>(async (_payload, options) => {
    options.onChunk({ output: "你好", thinking: { status: "thinking", text: "" } })
    return { output: "你好世界", thinking: null }
  })
  const translate = vi.fn<(...args: any[]) => Promise<string>>(async () => "你好")
  const deps = { getConfig: async () => config, runStreamText, translate }
  return {
    deps: deps as unknown as Parameters<typeof translateSelectionForDesktop>[2],
    runStreamText,
    translate,
  }
}

describe("桌面版划词翻译", () => {
  it("大模型供应商：走后台文本流，边写边把进度交出去", async () => {
    const { deps, runStreamText, translate } = createDeps(
      configWithTranslateProvider("openai-default"),
    )
    const onProgress = vi.fn<(...args: any[]) => void>()

    const result = await translateSelectionForDesktop({ text: "hello world" }, { onProgress }, deps)

    expect(result).toEqual({ text: "你好世界", fast: false })
    const [payload] = runStreamText.mock.calls[0]!
    expect(payload).toMatchObject({ providerId: "openai-default" })
    expect(typeof payload.instructions).toBe("string")
    expect(typeof payload.prompt).toBe("string")
    expect(onProgress).toHaveBeenCalledWith({
      text: "你好",
      thinking: { status: "thinking", text: "" },
    })
    expect(translate).not.toHaveBeenCalled()
  })

  it("纯翻译引擎：交给后台翻译队列，一次返回", async () => {
    const config = configWithTranslateProvider(DEFAULT_CONFIG.inputTranslation.providerId)
    const { deps, runStreamText, translate } = createDeps(config)

    const result = await translateSelectionForDesktop({ text: "hello" }, {}, deps)

    expect(result).toEqual({ text: "你好", fast: true })
    const [options] = translate.mock.calls[0]!
    expect(options).toMatchObject({
      text: "hello",
      langConfig: config.language,
      hostedFeature: "selectionTranslation",
    })
    // 后台不能给自己发消息：翻译请求必须直接交给后台队列
    expect(options.dispatch).toBe(enqueueTranslateRequestInBackground)
    expect(runStreamText).not.toHaveBeenCalled()
  })

  describe("出错时给出人能看懂的原因", () => {
    it("供应商被关掉了", async () => {
      const { deps } = createDeps(configWithTranslateProvider("openai-default", false))
      await expect(translateSelectionForDesktop({ text: "hi" }, {}, deps)).rejects.toMatchObject({
        code: "provider_disabled",
      })
    })

    it("供应商不存在", async () => {
      const { deps } = createDeps(configWithTranslateProvider("no-such-provider"))
      await expect(translateSelectionForDesktop({ text: "hi" }, {}, deps)).rejects.toMatchObject({
        code: "provider_unavailable",
      })
    })

    it("没有文字", async () => {
      const { deps } = createDeps(configWithTranslateProvider("openai-default"))
      await expect(translateSelectionForDesktop({ text: "   " }, {}, deps)).rejects.toMatchObject({
        code: "empty_text",
      })
    })

    it("扩展配置还没准备好", async () => {
      const { deps } = createDeps(null)
      await expect(translateSelectionForDesktop({ text: "hi" }, {}, deps)).rejects.toMatchObject({
        code: "config_unavailable",
      })
    })

    it("翻译服务什么都没返回", async () => {
      const config = configWithTranslateProvider(DEFAULT_CONFIG.inputTranslation.providerId)
      const { deps, translate } = createDeps(config)
      translate.mockResolvedValueOnce("  ")
      await expect(translateSelectionForDesktop({ text: "hi" }, {}, deps)).rejects.toMatchObject({
        code: "empty_result",
      })
    })
  })
})
