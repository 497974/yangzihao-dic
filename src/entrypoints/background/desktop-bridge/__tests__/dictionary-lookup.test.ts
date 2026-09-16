import type { Config } from "@/types/config/config"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { getBuiltInDictionaryAction } from "@/utils/custom-actions"

// 后台的流式查词和翻译队列都很重，这里只关心"桌面查词把请求交对了地方"
const runStructuredObjectStreamMock = vi.fn<(...args: any[]) => any>()
const enqueueInBackgroundMock = vi.fn<(...args: any[]) => any>()
const translateTextCoreMock = vi.fn<(...args: any[]) => any>()

vi.mock("../../background-stream", () => ({
  runStructuredObjectStreamInBackground: (...args: unknown[]) =>
    runStructuredObjectStreamMock(...args),
}))

vi.mock("../../translation-queues", () => ({
  enqueueTranslateRequestInBackground: (...args: unknown[]) => enqueueInBackgroundMock(...args),
}))

vi.mock("../../config", () => ({
  ensureInitializedConfig: vi.fn<(...args: any[]) => any>(),
}))

// 测试环境全局 mock 了语言包（见 vitest.setup.ts），i18n.t 返回键名，词典提示词里
// 没有 {{selection}} 占位符可替换——所以不能靠"提示词里出现选中的词"来判断。
// 查词服务真正负责的是把词、上下文、来源标题交给负载构造；占位符替换由网页端测试覆盖。
const mocks = vi.hoisted(() => ({ buildPayload: vi.fn<(...args: any[]) => any>() }))

vi.mock("@/utils/custom-action-execution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/custom-action-execution")>()
  mocks.buildPayload.mockImplementation(actual.buildCustomActionPayload)
  return {
    ...actual,
    buildCustomActionPayload: (...args: unknown[]) => mocks.buildPayload(...args),
  }
})

vi.mock("@/utils/host/translate/translate-text", () => ({
  translateTextCore: (...args: unknown[]) => translateTextCoreMock(...args),
}))

const { DesktopLookupError, lookupDictionaryForDesktop } = await import("../dictionary-lookup")
const { enqueueTranslateRequestInBackground } = await import("../../translation-queues")

function configWithDictionaryProvider(providerId: string): Config {
  const config = structuredClone(DEFAULT_CONFIG)
  config.selectionToolbar.builtInActions.dictionary.providerId = providerId
  return config
}

function depsFor(config: Config | null) {
  return { getConfig: async () => config }
}

describe("桌面版查词服务", () => {
  beforeEach(() => {
    runStructuredObjectStreamMock.mockReset()
    enqueueInBackgroundMock.mockReset()
    translateTextCoreMock.mockReset()
    // 只清调用记录，保留"透传真实实现"
    mocks.buildPayload.mockClear()
  })

  describe("纯翻译引擎（默认的免密钥 Microsoft Translate）走快速词典", () => {
    it("翻译请求交给后台直连的队列，而不是经消息发给自己", async () => {
      translateTextCoreMock.mockResolvedValue("获得")

      await lookupDictionaryForDesktop(
        { text: "obtain", context: "You must obtain a permit first." },
        {},
        depsFor(DEFAULT_CONFIG),
      )

      // 快速词典里 translateTextCore 默认会 sendMessage 给后台——可这里本身就是后台，
      // 发给自己没有接收方。必须拿到直连队列的 dispatch，否则桌面查词在免密钥配置下必然失败。
      expect(translateTextCoreMock).toHaveBeenCalled()
      for (const [options] of translateTextCoreMock.mock.calls) {
        expect((options as { dispatch?: unknown }).dispatch).toBe(
          enqueueTranslateRequestInBackground,
        )
      }
      expect(runStructuredObjectStreamMock).not.toHaveBeenCalled()
    })

    it("结果按词典字段名返回，并从上下文里摘出例句", async () => {
      translateTextCoreMock.mockImplementation(async ({ text }: { text: string }) =>
        text === "obtain" ? "获得" : "你必须先获得许可证。",
      )

      const result = await lookupDictionaryForDesktop(
        { text: "obtain", context: "Hello there. You must obtain a permit first. Thanks." },
        {},
        depsFor(DEFAULT_CONFIG),
      )

      expect(result.fast).toBe(true)
      const values = Object.values(result.fields)
      expect(values).toContain("obtain")
      expect(values).toContain("获得")
      expect(values).toContain("You must obtain a permit first.")
      expect(values).toContain("你必须先获得许可证。")
      // 展示顺序跟随词典动作的输出字段
      expect(result.outputSchema.length).toBeGreaterThan(0)
    })
  })

  describe("查词次数", () => {
    it("内置词典每查一次记一笔，结果里带上第几次；重新生成不算", async () => {
      translateTextCoreMock.mockResolvedValue("获得")
      const recordLookup = vi.fn<(text: string) => Promise<any>>(async () => ({
        count: 3,
        inNotebase: true,
        reviewBumped: true,
      }))
      const deps = { ...depsFor(DEFAULT_CONFIG), recordLookup }

      const result = await lookupDictionaryForDesktop({ text: " obtain " }, {}, deps)
      await lookupDictionaryForDesktop({ text: "obtain", fresh: true }, {}, deps)

      expect(recordLookup).toHaveBeenCalledTimes(1)
      expect(recordLookup).toHaveBeenCalledWith("obtain")
      expect(result).toMatchObject({ lookupCount: 3, reviewBumped: true })
    })

    it("查词失败不算查过一次（和网页词典一样）", async () => {
      runStructuredObjectStreamMock.mockRejectedValue(new Error("模型超时"))
      const recordLookup = vi.fn<(text: string) => Promise<any>>(async () => null)

      await expect(
        lookupDictionaryForDesktop(
          { text: "obtain" },
          {},
          { ...depsFor(configWithDictionaryProvider("openai-default")), recordLookup },
        ),
      ).rejects.toThrow("模型超时")
      expect(recordLookup).not.toHaveBeenCalled()
    })

    it("记不下来也不影响查词", async () => {
      translateTextCoreMock.mockResolvedValue("获得")
      const deps = {
        ...depsFor(DEFAULT_CONFIG),
        recordLookup: async () => {
          throw new Error("storage broken")
        },
      }

      const result = await lookupDictionaryForDesktop({ text: "obtain" }, {}, deps)

      expect(result.fast).toBe(true)
      expect(result.lookupCount).toBeUndefined()
    })
  })

  describe("大模型供应商走结构化查词", () => {
    it("把选中的词、上下文、来源标题交给负载构造，并原样发出、带上请求 id", async () => {
      runStructuredObjectStreamMock.mockResolvedValue({
        output: { 词条: "obtain", 释义: "获得" },
        thinking: null,
      })

      const result = await lookupDictionaryForDesktop(
        { text: "  obtain  ", context: "You must obtain a permit first.", sourceTitle: "QQ" },
        {},
        depsFor(configWithDictionaryProvider("openai-default")),
      )

      expect(result).toMatchObject({ fast: false, fields: { 词条: "obtain", 释义: "获得" } })

      // 交给负载构造的：去掉首尾空白的词、整句上下文、来源窗口标题
      expect(mocks.buildPayload).toHaveBeenCalledWith(
        expect.objectContaining({
          promptTokens: expect.objectContaining({
            selection: "obtain",
            paragraphs: "You must obtain a permit first.",
            webTitle: "QQ",
          }),
        }),
      )

      // 发出去的就是构造出来的那份负载，外加一个请求 id
      const built = mocks.buildPayload.mock.results[0]!.value as { payload: object }
      const [sent] = runStructuredObjectStreamMock.mock.calls[0]!
      expect(sent).toMatchObject(built.payload)
      expect(sent).toMatchObject({ providerId: "openai-default" })
      expect(typeof sent.requestId).toBe("string")
      expect(translateTextCoreMock).not.toHaveBeenCalled()
    })

    it("没给上下文时，用选中的词本身当上下文", async () => {
      runStructuredObjectStreamMock.mockResolvedValue({ output: {}, thinking: null })

      await lookupDictionaryForDesktop(
        { text: "obtain" },
        {},
        depsFor(configWithDictionaryProvider("openai-default")),
      )

      expect(mocks.buildPayload).toHaveBeenCalledWith(
        expect.objectContaining({
          promptTokens: expect.objectContaining({ selection: "obtain", paragraphs: "obtain" }),
        }),
      )
    })

    it("边生成边把进度交出去：先给空字段列表，然后模型写到哪就给到哪", async () => {
      runStructuredObjectStreamMock.mockImplementation(async (_payload, options) => {
        options.onChunk({ output: { 词条: "ob" }, thinking: { status: "thinking", text: "" } })
        return { output: { 词条: "obtain" }, thinking: null }
      })
      const onProgress = vi.fn<(...args: any[]) => void>()

      await lookupDictionaryForDesktop(
        { text: "obtain" },
        { onProgress },
        depsFor(configWithDictionaryProvider("openai-default")),
      )

      expect(onProgress).toHaveBeenCalledTimes(2)
      const [first] = onProgress.mock.calls[0]!
      const [second] = onProgress.mock.calls[1]!
      expect(first).toMatchObject({ fields: {}, thinking: null })
      expect(first.outputSchema.length).toBeGreaterThan(0)
      expect(first.outputSchema[0]).toHaveProperty("speaking")
      expect(second).toMatchObject({
        fields: { 词条: "ob" },
        thinking: { status: "thinking" },
      })
    })
  })

  describe("划词工具栏上的其它动作", () => {
    it("按动作 id 找到用户自己加的动作，用它自己的供应商走结构化查词", async () => {
      runStructuredObjectStreamMock.mockResolvedValue({ output: { 结果: "Hello" }, thinking: null })
      const config = structuredClone(DEFAULT_CONFIG)
      const dictionary = getBuiltInDictionaryAction(config.selectionToolbar)
      config.selectionToolbar.customActions = [
        { ...dictionary, id: "polish", name: "润色", providerId: "openai-default" },
      ]

      const result = await lookupDictionaryForDesktop(
        { text: "hello", actionId: "polish" },
        {},
        depsFor(config),
      )

      expect(result).toMatchObject({ fast: false, fields: { 结果: "Hello" } })
      const [sent] = runStructuredObjectStreamMock.mock.calls[0]!
      expect(sent).toMatchObject({ providerId: "openai-default" })
    })

    it("动作不存在或被关掉了：说明原因", async () => {
      await expect(
        lookupDictionaryForDesktop(
          { text: "hello", actionId: "no-such-action" },
          {},
          depsFor(DEFAULT_CONFIG),
        ),
      ).rejects.toMatchObject({ code: "action_unavailable" })
    })
  })

  describe("出错时给出人能看懂的原因", () => {
    it("没取到文字", async () => {
      await expect(
        lookupDictionaryForDesktop({ text: "   " }, {}, depsFor(DEFAULT_CONFIG)),
      ).rejects.toMatchObject({ code: "empty_selection" })
    })

    it("扩展配置还没准备好", async () => {
      await expect(
        lookupDictionaryForDesktop({ text: "obtain" }, {}, depsFor(null)),
      ).rejects.toBeInstanceOf(DesktopLookupError)
    })

    it("词典的供应商不可用", async () => {
      await expect(
        lookupDictionaryForDesktop(
          { text: "obtain" },
          {},
          depsFor(configWithDictionaryProvider("no-such-provider")),
        ),
      ).rejects.toMatchObject({ code: "provider_unavailable" })
    })
  })
})
