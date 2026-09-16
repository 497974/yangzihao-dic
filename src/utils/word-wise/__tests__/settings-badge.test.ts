import { describe, expect, it } from "vitest"
import { badgeText } from "../badge"
import { DEFAULT_ENGLISH_LEVEL } from "../level"
import { resolveEnglishLevel } from "../settings"

describe("我的英语水平从哪来", () => {
  it("手动选过的优先", () => {
    expect(resolveEnglishLevel(4, { estimatedWords: 1_000, unreliable: false })).toEqual({
      level: 4,
      source: "manual",
    })
  })

  it("没选过就按词汇量测试推算", () => {
    expect(resolveEnglishLevel(undefined, { estimatedWords: 5_000, unreliable: false })).toEqual({
      level: 4,
      source: "vocabTest",
    })
  })

  it("测试结果不可信（乱蒙的）不拿来推算，用默认值", () => {
    expect(resolveEnglishLevel(undefined, { estimatedWords: 9_000, unreliable: true })).toEqual({
      level: DEFAULT_ENGLISH_LEVEL,
      source: "default",
    })
  })

  it("存储里的值不合法（被别的版本写坏了）也不崩，按没设过处理", () => {
    expect(resolveEnglishLevel("四级", null)).toEqual({
      level: DEFAULT_ENGLISH_LEVEL,
      source: "default",
    })
    expect(resolveEnglishLevel(99, null).source).toBe("default")
  })
})

describe("难度角标的文字", () => {
  it("百分比取整，带上水平和评价；有超纲词时列出数量", () => {
    expect(badgeText({ total: 500, coverage: 0.9567, hardWords: 12 }, "大学英语四级")).toEqual({
      percent: "96%",
      detail: "的词在你的水平（大学英语四级）内 · 可以流畅阅读 · 超纲词 12 个",
    })
  })

  it("没有超纲词时不写「超纲词 0 个」", () => {
    expect(badgeText({ total: 500, coverage: 1, hardWords: 0 }, "GRE").detail).not.toContain(
      "超纲词",
    )
  })
})
