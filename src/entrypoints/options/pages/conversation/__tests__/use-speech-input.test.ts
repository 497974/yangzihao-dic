import { describe, expect, it } from "vitest"
import { describeSpeechError } from "../use-speech-input"

describe("语音识别出错时给用户的说明", () => {
  it("权限、网络、没声音、没麦克风分别说清楚原因", () => {
    expect(describeSpeechError("not-allowed")).toContain("麦克风权限")
    expect(describeSpeechError("service-not-allowed")).toContain("麦克风权限")
    expect(describeSpeechError("network")).toContain("部分网络环境下不可用")
    expect(describeSpeechError("no-speech")).toContain("没有检测到说话声")
    expect(describeSpeechError("audio-capture")).toContain("麦克风")
  })

  it("不认识的错误也给出可操作的建议（改用文字输入）", () => {
    expect(describeSpeechError("something-new")).toContain("改用文字输入")
  })
})
