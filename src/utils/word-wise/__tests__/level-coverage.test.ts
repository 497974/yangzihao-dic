import type { WordInfo } from "@/utils/wordlist/lookup"
import { describe, expect, it } from "vitest"
import {
  computeCoverage,
  countWords,
  describeCoverage,
  isEnglishPage,
  MIN_WORDS_FOR_COVERAGE,
} from "../coverage"
import { isEnglishLevel, levelFromVocabSize, needsHint } from "../level"

describe("我的英语水平", () => {
  it("词汇量测试结果换算成默认水平", () => {
    expect(levelFromVocabSize(800)).toBe(1)
    expect(levelFromVocabSize(2_500)).toBe(2)
    expect(levelFromVocabSize(4_000)).toBe(3)
    expect(levelFromVocabSize(5_000)).toBe(4)
    expect(levelFromVocabSize(8_000)).toBe(6)
    expect(levelFromVocabSize(12_000)).toBe(7)
  })

  it("只认 1~7 这几档", () => {
    expect(isEnglishLevel(3)).toBe(true)
    expect(isEnglishLevel(0)).toBe(false)
    expect(isEnglishLevel("3")).toBe(false)
  })

  it("提示范围：高一档起提示，或高两档起提示", () => {
    expect(needsHint(3, 2, "above1")).toBe(true)
    expect(needsHint(2, 2, "above1")).toBe(false)
    expect(needsHint(3, 2, "above2")).toBe(false)
    expect(needsHint(4, 2, "above2")).toBe(true)
    expect(needsHint(2, 2, "atLevel")).toBe(true)
    expect(needsHint(1, 2, "atLevel")).toBe(false)
  })
})

describe("页面分词", () => {
  it("按词次数计；撇号、连字符连在一起算一个词", () => {
    const counts = countWords("The well-known fact: it's the end. THE end!")
    expect(counts.get("The")).toBe(1)
    expect(counts.get("the")).toBe(1)
    expect(counts.get("well-known")).toBe(1)
    expect(counts.get("it's")).toBe(1)
    expect(counts.get("end")).toBe(2)
  })

  it("英文为主的页面才算；中文页、太短的都不算", () => {
    expect(isEnglishPage("This is a long English article about learning. ".repeat(10))).toBe(true)
    expect(isEnglishPage("这是一篇很长的中文文章，讲的是如何学习英语。".repeat(20))).toBe(false)
    expect(isEnglishPage("Short text")).toBe(false)
  })
})

describe("本页掌握度", () => {
  const info = (lemma: string, level: number): WordInfo => ({
    lemma,
    level,
    phonetic: "",
    gloss: "",
  })

  function pageOf(words: Record<string, number>) {
    return new Map(Object.entries(words))
  }

  it("词表里没有的、不超过我的水平的都算认识；超纲的按原形去重计数", () => {
    const counts = pageOf({ the: 100, study: 20, ubiquitous: 5, Ubiquitous: 1, obtain: 24 })
    const infos = {
      study: info("study", 1),
      ubiquitous: info("ubiquitous", 7),
      Ubiquitous: info("ubiquitous", 7),
      obtain: info("obtain", 3),
    }

    const result = computeCoverage(counts, infos, 2, new Set())!

    expect(result.total).toBe(150)
    // the(100) + study(20) 认识；ubiquitous(6) + obtain(24) 超纲
    expect(result.coverage).toBeCloseTo(120 / 150)
    expect(result.hardWords).toBe(2)
  })

  it("生词本里已掌握的词算认识", () => {
    const counts = pageOf({ the: 140, obtain: 10 })
    const result = computeCoverage(counts, { obtain: info("obtain", 3) }, 2, new Set(["obtain"]))!

    expect(result.coverage).toBe(1)
    expect(result.hardWords).toBe(0)
  })

  it("词次太少（导航栏、按钮）不给结论", () => {
    expect(
      computeCoverage(pageOf({ home: MIN_WORDS_FOR_COVERAGE - 1 }), {}, 2, new Set()),
    ).toBeNull()
  })

  it("覆盖率的一句话评价", () => {
    expect(describeCoverage(0.99)).toBe("非常轻松")
    expect(describeCoverage(0.96)).toBe("可以流畅阅读")
    expect(describeCoverage(0.92)).toBe("需要查少量生词")
    expect(describeCoverage(0.8)).toBe("难度偏高")
  })
})
