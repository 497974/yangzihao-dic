/**
 * 桌面版朗读：用扩展里的朗读设置（设置 → 朗读：各语言的声音、语速、音调、音量）合成语音，
 * 把音频交给桌面程序去放。这样在 QQ 里点朗读，听到的和网页上是同一个声音。
 *
 * 和网页端的区别只有选声音这一步：网页用语言检测模块判断是哪种语言，那个模块依赖页面环境，
 * 后台用不了；这里按文字粗判（假名→日语、谚文→韩语、汉字→中文，其余当英语）——
 * 桌面版读的基本就是中英两种，粗判足够。
 */

import type { LangCodeISO6393 } from "@read-frog/definitions"
import type { Config } from "@/types/config/config"
import { synthesizeEdgeTTS } from "@/utils/server/edge-tts"
import { ensureInitializedConfig } from "../config"

export interface DesktopSpeakRequest {
  text: string
}

export interface DesktopSpeakResult {
  /** 合成好的整段音频（base64） */
  audioBase64: string
  /** 比如 audio/mpeg */
  contentType: string
}

export type DesktopSpeakErrorCode = "empty_text" | "config_unavailable" | "synthesize_failed"

/** 可以直接展示给用户的错误：message 就是给人看的原因 */
export class DesktopSpeakError extends Error {
  constructor(
    readonly code: DesktopSpeakErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "DesktopSpeakError"
  }
}

/** 假名先判：日文里也夹着汉字 */
export function guessSpeechLanguage(text: string): LangCodeISO6393 {
  if (/[぀-ヿ]/.test(text)) {
    return "jpn"
  }
  if (/[가-힯]/.test(text)) {
    return "kor"
  }
  if (/[㐀-鿿]/.test(text)) {
    return "cmn"
  }
  return "eng"
}

function toSignedValue(value: number, unit: "%" | "Hz"): string {
  return `${value >= 0 ? "+" : ""}${value}${unit}`
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  // 一次转一小段：整段音频几百 KB，一口气展开给 fromCharCode 会爆调用栈
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

interface SpeakDeps {
  getConfig: () => Promise<Config | null | undefined>
  synthesize: typeof synthesizeEdgeTTS
}

const defaultDeps: SpeakDeps = {
  getConfig: ensureInitializedConfig,
  synthesize: synthesizeEdgeTTS,
}

export async function speakForDesktop(
  request: DesktopSpeakRequest,
  deps: SpeakDeps = defaultDeps,
): Promise<DesktopSpeakResult> {
  const text = request.text.trim()
  if (!text) {
    throw new DesktopSpeakError("empty_text", "没有要朗读的文字")
  }

  const config = await deps.getConfig()
  if (!config) {
    throw new DesktopSpeakError("config_unavailable", "扩展的配置还没准备好，请稍后再试")
  }

  const { tts } = config
  const voice = tts.languageVoices[guessSpeechLanguage(text)] ?? tts.defaultVoice
  const response = await deps.synthesize({
    text,
    voice,
    rate: toSignedValue(tts.rate, "%"),
    pitch: toSignedValue(tts.pitch, "Hz"),
    volume: toSignedValue(tts.volume, "%"),
  })
  if (!response.ok) {
    throw new DesktopSpeakError("synthesize_failed", `朗读合成失败：${response.error.message}`)
  }
  return { audioBase64: arrayBufferToBase64(response.audio), contentType: response.contentType }
}
