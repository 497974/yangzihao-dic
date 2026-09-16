import type { Config } from "@/types/config/config"
import { describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"

// 默认依赖里的 ensureInitializedConfig 会拉起整套配置初始化；这里用注入的配置代替
vi.mock("../../config", () => ({
  ensureInitializedConfig: vi.fn<(...args: any[]) => any>(),
}))

const { guessSpeechLanguage, speakForDesktop } = await import("../speak")

function configWithVoices(): Config {
  const config = structuredClone(DEFAULT_CONFIG)
  config.tts.defaultVoice = "en-US-DefaultNeural"
  config.tts.languageVoices.eng = "en-US-GuyNeural"
  config.tts.languageVoices.cmn = "zh-CN-XiaoxiaoNeural"
  config.tts.rate = 10
  config.tts.pitch = -5
  config.tts.volume = 0
  return config
}

function createDeps(config: Config | null) {
  const synthesize = vi.fn<(...args: any[]) => Promise<any>>(async () => ({
    ok: true,
    audio: new Uint8Array([1, 2, 3]).buffer,
    contentType: "audio/mpeg",
  }))
  return { synthesize, deps: { getConfig: async () => config, synthesize } }
}

describe("桌面版朗读", () => {
  it("按扩展的朗读设置选声音、语速、音调、音量，音频转成 base64 交回", async () => {
    const { deps, synthesize } = createDeps(configWithVoices())

    const result = await speakForDesktop({ text: " obtain " }, deps)

    expect(synthesize).toHaveBeenCalledWith({
      text: "obtain",
      voice: "en-US-GuyNeural",
      rate: "+10%",
      pitch: "-5Hz",
      volume: "+0%",
    })
    expect(result).toEqual({ audioBase64: "AQID", contentType: "audio/mpeg" })
  })

  it("中文用中文的声音", async () => {
    const { deps, synthesize } = createDeps(configWithVoices())

    await speakForDesktop({ text: "获得" }, deps)

    expect(synthesize.mock.calls[0]![0]).toMatchObject({ voice: "zh-CN-XiaoxiaoNeural" })
  })

  it("粗判语言：假名是日语、谚文是韩语、汉字是中文，其余当英语", () => {
    expect(guessSpeechLanguage("食べる")).toBe("jpn")
    expect(guessSpeechLanguage("안녕하세요")).toBe("kor")
    expect(guessSpeechLanguage("你好")).toBe("cmn")
    expect(guessSpeechLanguage("hello")).toBe("eng")
  })

  it("合成失败时报出原因", async () => {
    const { deps, synthesize } = createDeps(configWithVoices())
    synthesize.mockResolvedValueOnce({
      ok: false,
      error: { code: "NETWORK_ERROR", message: "断网" },
    })

    await expect(speakForDesktop({ text: "hi" }, deps)).rejects.toMatchObject({
      code: "synthesize_failed",
    })
  })

  it("没有文字、配置没准备好都报出原因", async () => {
    await expect(
      speakForDesktop({ text: "  " }, createDeps(configWithVoices()).deps),
    ).rejects.toMatchObject({ code: "empty_text" })
    await expect(speakForDesktop({ text: "hi" }, createDeps(null).deps)).rejects.toMatchObject({
      code: "config_unavailable",
    })
  })
})
