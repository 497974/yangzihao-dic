import type { Config } from "@/types/config/config"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"

// 翻译队列很重，这里只关心"请求交对了地方"
const enqueueInBackgroundMock = vi.fn<(...args: any[]) => any>()
vi.mock("../../translation-queues", () => ({
  enqueueTranslateRequestInBackground: (...args: unknown[]) => enqueueInBackgroundMock(...args),
}))

const { translateInputForDesktop, resolveDesktopInputLang } = await import("../input-translate")
const { enqueueTranslateRequestInBackground } = await import("../../translation-queues")

function configWith(overrides: {
  sourceCode?: Config["language"]["sourceCode"]
  targetCode?: Config["language"]["targetCode"]
  providerId?: string
  fromLang?: Config["inputTranslation"]["fromLang"]
  toLang?: Config["inputTranslation"]["toLang"]
}): Config {
  return {
    ...DEFAULT_CONFIG,
    language: {
      ...DEFAULT_CONFIG.language,
      sourceCode: overrides.sourceCode ?? "auto",
      targetCode: overrides.targetCode ?? "cmn",
    },
    inputTranslation: {
      ...DEFAULT_CONFIG.inputTranslation,
      providerId: overrides.providerId ?? DEFAULT_CONFIG.inputTranslation.providerId,
      fromLang: overrides.fromLang ?? "targetCode",
      toLang: overrides.toLang ?? "sourceCode",
    },
  }
}

function depsFor(config: Config | null, translated = "Hello world") {
  const translate = vi.fn<(...args: any[]) => Promise<string>>(async () => translated)
  return { deps: { getConfig: async () => config, translate }, translate }
}

describe("桌面版三下空格翻译", () => {
  beforeEach(() => {
    enqueueInBackgroundMock.mockReset()
  })

  it("默认设置：中文 → 英语（源语言是自动，桌面没有页面可检测，就用英语）", async () => {
    const { deps, translate } = depsFor(configWith({}))
    const result = await translateInputForDesktop({ text: "  你好世界  ", sourceTitle: "QQ" }, deps)

    expect(result).toEqual({ text: "Hello world", from: "cmn", to: "eng" })
    const [options] = translate.mock.calls[0]!
    expect(options).toMatchObject({
      text: "你好世界",
      langConfig: { sourceCode: "cmn", targetCode: "eng" },
      hostedFeature: "inputTranslation",
      preserveLineBreaks: true,
    })
    // 后台不能给自己发消息：翻译请求必须直接交给后台队列
    expect(options.dispatch).toBe(enqueueTranslateRequestInBackground)
  })

  it("用户明确选了源语言（比如日语），就翻成日语", async () => {
    const { deps } = depsFor(configWith({ sourceCode: "jpn" }))
    const result = await translateInputForDesktop({ text: "你好" }, deps)
    expect(result.to).toBe("jpn")
  })

  it.each([
    ["sourceCode", { sourceCode: "auto" as const }, "eng"],
    ["sourceCode", { sourceCode: "fra" as const }, "fra"],
    ["targetCode", { targetCode: "cmn" as const }, "cmn"],
    ["kor", {}, "kor"],
  ])("语言 %s 解析成 %j → %s", (lang, language, expected) => {
    const merged = { ...configWith({}).language, ...language }
    expect(resolveDesktopInputLang(lang as never, merged)).toBe(expected)
  })

  describe("出错时给出人能看懂的原因", () => {
    it("两边是同一种语言", async () => {
      const { deps, translate } = depsFor(configWith({ fromLang: "eng", toLang: "eng" }))
      await expect(translateInputForDesktop({ text: "hi" }, deps)).rejects.toMatchObject({
        code: "same_language",
      })
      expect(translate).not.toHaveBeenCalled()
    })

    it("没有文字", async () => {
      const { deps } = depsFor(configWith({}))
      await expect(translateInputForDesktop({ text: "   " }, deps)).rejects.toMatchObject({
        code: "empty_text",
      })
    })

    it("扩展配置还没准备好", async () => {
      const { deps } = depsFor(null)
      await expect(translateInputForDesktop({ text: "你好" }, deps)).rejects.toMatchObject({
        code: "config_unavailable",
      })
    })

    it("输入翻译的供应商不可用", async () => {
      const { deps } = depsFor(configWith({ providerId: "no-such-provider" }))
      await expect(translateInputForDesktop({ text: "你好" }, deps)).rejects.toMatchObject({
        code: "provider_unavailable",
      })
    })

    it("翻译服务什么都没返回", async () => {
      const { deps } = depsFor(configWith({}), "  ")
      await expect(translateInputForDesktop({ text: "你好" }, deps)).rejects.toMatchObject({
        code: "empty_result",
      })
    })
  })
})
