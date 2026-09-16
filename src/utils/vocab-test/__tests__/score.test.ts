import type { TestAnswer } from "../score"
import { describe, expect, it } from "vitest"
import { correctRate, describeLevel, scoreVocabTest, UNRELIABLE_FALSE_ALARM } from "../score"
import { ALL_ITEMS, BAND_SIZE, FAKE_ITEMS, REAL_ITEMS, shuffleItems } from "../word-bank"

/** 按每档答对几个、假词答错几个，造一份答卷 */
function makeAnswers(knownPerBand: Record<number, number>, fakeKnown = 0): TestAnswer[] {
  const answers: TestAnswer[] = []
  for (const band of [1, 2, 3, 4, 5] as const) {
    const items = REAL_ITEMS.filter((item) => item.band === band)
    items.forEach((item, index) => {
      answers.push({ word: item.word, band, known: index < (knownPerBand[band] ?? 0) })
    })
  }
  FAKE_ITEMS.forEach((item, index) => {
    answers.push({ word: item.word, band: null, known: index < fakeKnown })
  })
  return answers
}

describe("词库", () => {
  it("真词、假词都不重复，假词没有档位", () => {
    const words = ALL_ITEMS.map((item) => item.word)
    expect(new Set(words).size).toBe(words.length)
    expect(FAKE_ITEMS.every((item) => item.band === null)).toBe(true)
  })

  it("洗牌不丢题、不重复", () => {
    const shuffled = shuffleItems(ALL_ITEMS, () => 0.42)
    expect(shuffled).toHaveLength(ALL_ITEMS.length)
    expect(new Set(shuffled.map((item) => item.word)).size).toBe(ALL_ITEMS.length)
  })
})

describe("扣掉蒙的部分", () => {
  it("没蒙过就是原始正确率", () => {
    expect(correctRate(0.8, 0)).toBeCloseTo(0.8)
  })

  it("蒙得越多扣得越狠", () => {
    expect(correctRate(0.8, 0.5)).toBeCloseTo(0.6)
    expect(correctRate(0.5, 0.5)).toBe(0)
  })

  it("全都点「认识」的人，估出来接近 0", () => {
    const all = ALL_ITEMS.map((item) => ({ word: item.word, band: item.band, known: true }))
    const result = scoreVocabTest(all)

    expect(result.estimatedWords).toBe(0)
    expect(result.unreliable).toBe(true)
  })
})

describe("估算词汇量", () => {
  it("每一档全认识，就是各档词量之和", () => {
    const perfect = REAL_ITEMS.map((item) => ({ word: item.word, band: item.band, known: true }))
    const withFakes = [
      ...perfect,
      ...FAKE_ITEMS.map((item) => ({ word: item.word, band: null, known: false })),
    ]

    const total = Object.values(BAND_SIZE).reduce((sum, size) => sum + size, 0)
    expect(scoreVocabTest(withFakes).estimatedWords).toBe(total)
  })

  it("只认识最常用的那批，估出来就是小几千", () => {
    const result = scoreVocabTest(makeAnswers({ 1: 6, 2: 8, 3: 2 }))

    expect(result.estimatedWords).toBeGreaterThan(1_500)
    expect(result.estimatedWords).toBeLessThan(3_000)
    expect(result.unreliable).toBe(false)
  })

  it("答「不认识」的真词留下来，可以拿去背", () => {
    const result = scoreVocabTest(makeAnswers({ 1: 6, 2: 8, 3: 10, 4: 11, 5: 0 }))

    expect(result.unknownWords).toContain("obfuscate")
    expect(result.unknownWords).not.toContain("begin")
  })

  it("假词答对一半以上就标成不可信", () => {
    const fakeKnown = Math.ceil(FAKE_ITEMS.length * (UNRELIABLE_FALSE_ALARM + 0.2))
    expect(scoreVocabTest(makeAnswers({ 1: 6 }, fakeKnown)).unreliable).toBe(true)
  })
})

describe("水平说明", () => {
  it("按估出来的词汇量给建议，每天新词数随水平上升", () => {
    expect(describeLevel(800).label).toBe("入门")
    expect(describeLevel(2_500).label).toBe("初级")
    expect(describeLevel(4_000).label).toBe("中级")
    expect(describeLevel(9_000).label).toBe("高级")
    expect(describeLevel(9_000).dailyNewWords).toBeGreaterThan(describeLevel(800).dailyNewWords)
  })
})
