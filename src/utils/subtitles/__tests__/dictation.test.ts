import { describe, expect, it } from "vitest"
import {
  addToStats,
  averageAccuracy,
  diffWords,
  maskSentence,
  normalizeWord,
  splitWords,
} from "../dictation"

const types = (text: string, typed: string) =>
  diffWords(text, typed).ops.map((op) => `${op.type}:${op.word}`)

describe("逐词比对", () => {
  it("全对", () => {
    const result = diffWords("I want to go home.", "i want to go home")
    expect(result.accuracy).toBe(1)
    expect(result.ops.every((op) => op.type === "match")).toBe(true)
  })

  it("漏听一个词：后面的词不会因为错位全判成错", () => {
    expect(types("I really want to go", "I want to go")).toEqual([
      "match:I",
      "missing:really",
      "match:want",
      "match:to",
      "match:go",
    ])
    expect(diffWords("I really want to go", "I want to go").accuracy).toBeCloseTo(4 / 5)
  })

  it("听错一个词：标出正确的词和写错的词", () => {
    expect(types("I bought a car", "I brought a car")).toEqual([
      "match:I",
      "missing:bought",
      "extra:brought",
      "match:a",
      "match:car",
    ])
  })

  it("多写的词标为多余，不影响正确率（正确率按原句的词数算）", () => {
    const result = diffWords("go home", "go to home")
    expect(result.ops.map((op) => op.type)).toEqual(["match", "extra", "match"])
    expect(result.accuracy).toBe(1)
  })

  it("忽略大小写、标点；don't 和 dont 算一致", () => {
    expect(diffWords("Don't worry, it's fine!", "dont worry its fine").accuracy).toBe(1)
  })

  it("什么都没写：全部标为漏听，正确率 0", () => {
    const result = diffWords("see you later", "")
    expect(result.accuracy).toBe(0)
    expect(result.ops.map((op) => op.type)).toEqual(["missing", "missing", "missing"])
  })

  it("原句没有词（纯音效字幕如 [Music]）时正确率为 0，不会除以 0", () => {
    expect(diffWords("♪ ♪", "music").accuracy).toBe(0)
  })
})

describe("辅助函数", () => {
  it("分词保留原样，数字也算词", () => {
    expect(splitWords("In 2020, she's well-known.")).toEqual(["In", "2020", "she's", "well-known"])
    expect(normalizeWord("She’s")).toBe("shes")
  })

  it("遮住原文：只透露词数和长短", () => {
    expect(maskSentence("I want to go.")).toBe("_ ____ __ __")
  })

  it("本次听写的平均正确率", () => {
    let stats = { lines: 0, accuracySum: 0 }
    expect(averageAccuracy(stats)).toBe(0)
    stats = addToStats(stats, diffWords("a b", "a b"))
    stats = addToStats(stats, diffWords("a b", "a"))
    expect(stats.lines).toBe(2)
    expect(averageAccuracy(stats)).toBeCloseTo(0.75)
  })
})
