import type { WordlistEntry } from "../ecdict"
import type { ChineseCandidate } from "../reverse"
import { describe, expect, it } from "vitest"
import {
  bandRange,
  buildReverseIndex,
  chineseKeys,
  dropDerivedForms,
  isDerivedNoun,
  pickCandidate,
} from "../reverse"

const candidate = (en: string, level: number, rank = 0): ChineseCandidate => ({
  en,
  level,
  phonetic: "",
  rank,
})

describe("难度范围", () => {
  it("巩固 / 提升 / 挑战 / 综合，相对我的水平", () => {
    expect(bandRange(3, "consolidate")).toEqual([3, 3])
    expect(bandRange(3, "improve")).toEqual([4, 5])
    expect(bandRange(3, "challenge")).toEqual([5, 7])
    expect(bandRange(3, "mixed")).toEqual([3, 7])
  })

  it("水平已经很高时退回最难的一档，不会一个词都换不了", () => {
    expect(bandRange(7, "improve")).toEqual([7, 7])
    expect(bandRange(6, "challenge")).toEqual([7, 7])
  })
})

describe("中文说法", () => {
  it("只取第一个义项，引申义不算", () => {
    expect(chineseKeys("持续时间；期间")).toEqual(["持续时间"])
  })

  it("一个字的、虚词、带标点的都不算", () => {
    expect(chineseKeys("书")).toEqual([])
    expect(chineseKeys("已经")).toEqual([])
    expect(chineseKeys("（使）放弃")).toEqual([])
  })

  it("形容词释义保留「的」，免得「变化的」把网页上的「变化」都抢走", () => {
    expect(chineseKeys("变化的；代谢的")).toEqual(["变化的"])
  })
})

describe("去掉变形和派生词", () => {
  it("同一个中文词下有原形时，去掉加了后缀的词", () => {
    const kept = dropDerivedForms([candidate("abandon", 2), candidate("abandonment", 4)])
    expect(kept.map((item) => item.en)).toEqual(["abandon"])
  })

  it("由更常用的词派生出来的名词算派生：importance ← important", () => {
    const ranks = new Map([
      ["important", 300],
      ["importance", 1500],
      ["opportune", 20_000],
      ["opportunity", 800],
      ["option", 1200],
    ])
    const rankOf = (word: string) => ranks.get(word)

    expect(isDerivedNoun("importance", 1500, rankOf)).toBe(true)
    // 拆出来的原形更冷僻：opportunity 本身才是基础词
    expect(isDerivedNoun("opportunity", 800, rankOf)).toBe(false)
    // 复数单独成条的也不选
    expect(isDerivedNoun("options", 0, rankOf)).toBe(true)
    expect(isDerivedNoun("social media", 0, rankOf)).toBe(false)
  })
})

describe("挑英文说法", () => {
  it("难度范围内挑最常用的；范围内没有就不换", () => {
    const list = [
      candidate("abandon", 2, 2000),
      candidate("forsake", 4, 9000),
      candidate("relinquish", 6, 12_000),
    ]

    expect(pickCandidate(list, [2, 2])?.en).toBe("abandon")
    expect(pickCandidate(list, [3, 5])?.en).toBe("forsake")
    expect(pickCandidate(list, [5, 7])?.en).toBe("relinquish")
    expect(pickCandidate([candidate("student", 1, 500)], [3, 4])).toBeNull()
  })

  it("有人工对照的词只用人工对照（交换 → exchange，不会是 commute）", () => {
    const entries: WordlistEntry[] = [["commute", 4, "", "交换；通勤", 6000]]
    const index = buildReverseIndex(entries, [{ zh: "交换", en: "exchange", level: 2 }])

    expect(pickCandidate(index.get("交换")!, [2, 2])?.en).toBe("exchange")
    // 人工对照不在范围内时宁可不换，也不退回自动反查的结果
    expect(pickCandidate(index.get("交换")!, [4, 5])).toBeNull()
  })

  it("派生名词不选", () => {
    const entries: WordlistEntry[] = [
      ["important", 1, "", "重要的", 300],
      ["importance", 2, "", "重要", 1500],
    ]
    const index = buildReverseIndex(entries, [])

    expect(pickCandidate(index.get("重要")!, [1, 7])).toBeNull()
    expect(pickCandidate(index.get("重要的")!, [1, 7])?.en).toBe("important")
  })
})
