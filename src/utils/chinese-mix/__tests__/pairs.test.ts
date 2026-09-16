import type { MixPair } from "../pairs"
import type { LocalNotebaseDb } from "@/utils/local-notebase/storage"
import { describe, expect, it } from "vitest"
import {
  buildNotebasePairs,
  collectTerms,
  createSegmenter,
  extractChineseWords,
  findMatches,
  isChinesePage,
} from "../pairs"

/** 一个只有「词条 / 音标 / 释义」三列的生词本，和内置词典建出来的一样 */
function makeDb(rows: Array<{ term: string; phonetic?: string; meaning: string }>) {
  return {
    notebases: {
      nb1: {
        id: "nb1",
        name: "生词本",
        notebaseColumns: [
          { id: "c1", name: "词条", position: 0, isPrimary: true },
          { id: "c2", name: "音标", position: 1 },
          { id: "c3", name: "释义", position: 2 },
        ],
        notebaseRows: rows.map((row, index) => ({
          id: `r${index}`,
          position: index,
          cells: { c1: row.term, c2: row.phonetic ?? "", c3: row.meaning },
        })),
      },
    },
  } as unknown as LocalNotebaseDb
}

describe("从释义里拆中文词", () => {
  it("按标点拆开，去掉词性前缀和括号里的补充", () => {
    expect(extractChineseWords("v. 获得；取得，得到（正式）")).toEqual(["获得", "取得", "得到"])
    expect(extractChineseWords("〈动〉推迟")).toEqual(["推迟"])
  })

  it("一个字的、太长的、带英文的都不要", () => {
    expect(extractChineseWords("好；非常好的一种说法；nice")).toEqual([])
  })

  it("到处都是别的意思的词不要（可以、东西这种）", () => {
    expect(extractChineseWords("可以；能够")).toEqual(["能够"])
  })
})

describe("生词本词对", () => {
  it("释义里的中文说法对应生词本的英文词条", () => {
    const pairs = buildNotebasePairs(makeDb([{ term: "obtain", meaning: "获得；取得" }]))

    expect(pairs.get("获得")).toMatchObject({ en: "obtain", source: "notebase" })
  })

  it("同一个英文词只留一个中文说法，免得满页都是它", () => {
    const pairs = buildNotebasePairs(makeDb([{ term: "obtain", meaning: "获得；取得" }]))
    const english = [...pairs.values()].map((pair) => pair.en)

    expect(english).toEqual(["obtain"])
  })

  it("英文词条不是纯英文单词的（整句、带数字）不参与", () => {
    const pairs = buildNotebasePairs(makeDb([{ term: "hello world 2", meaning: "你好" }]))
    expect(pairs.size).toBe(0)
  })
})

const pair = (zh: string, en: string): MixPair => ({ zh, en, phonetic: "", source: "wordlist" })

describe("按分词匹配", () => {
  const segmenter = createSegmenter()

  it("「留学生」是一个词，里面的「学生」不会被单独换掉（不会出现「留students」）", () => {
    const table = new Map([["学生", pair("学生", "student")]])

    expect(findMatches("他是一名留学生", segmenter, (term) => table.get(term))).toEqual([])
    expect(findMatches("大学生和学生", segmenter, (term) => table.get(term))).toEqual([
      { index: 4, pair: table.get("学生") },
    ])
  })

  it("被切开的合成词也能整体匹配：交换生 = 交换 | 生", () => {
    const table = new Map([
      ["交换", pair("交换", "exchange")],
      ["交换生", pair("交换生", "exchange student")],
    ])

    const matches = findMatches("他也是交换生。", segmenter, (term) => table.get(term))

    expect(matches.map((match) => match.pair.en)).toEqual(["exchange student"])
  })

  it("候选词：单个分词和相邻两三个分词拼起来的，只要纯汉字", () => {
    const terms = collectTerms("获得了显著的进展", segmenter)

    expect(terms.has("显著")).toBe(true)
    expect(terms.has("显著的")).toBe(true)
    expect(terms.has("进展")).toBe(true)
  })

  it("没有汉字的文字直接跳过", () => {
    expect(collectTerms("hello world", segmenter).size).toBe(0)
  })
})

describe("判断是不是中文网页", () => {
  it("中文正文算，英文网页不算", () => {
    expect(isChinesePage("这是一篇中文文章。".repeat(20))).toBe(true)
    expect(isChinesePage("This is an English article. ".repeat(20))).toBe(false)
  })

  it("只有零星几个汉字的英文页不算", () => {
    expect(isChinesePage(`${"English text everywhere. ".repeat(40)}中文`)).toBe(false)
  })
})
