import type { WordlistEntry, WordlistFile } from "../ecdict"
import { describe, expect, it } from "vitest"
import {
  columnIndex,
  exchangeForms,
  harmonizeInflectionLevels,
  isPlainEntry,
  lemmaOf,
  LEVELS,
  levelFromTags,
  parseCsvLine,
  pickGloss,
  rankOf,
  toWordlistEntry,
} from "../ecdict"
import { normalizeToken, Wordlist } from "../lookup"

describe("解析 ECDICT 原始数据", () => {
  it("CSV：引号里的逗号、两个引号表示一个引号", () => {
    expect(parseCsvLine('abandon,əˈbændən,,"v. 放弃, 抛弃",,"say ""hi"""')).toEqual([
      "abandon",
      "əˈbændən",
      "",
      "v. 放弃, 抛弃",
      "",
      'say "hi"',
    ])
  })

  it("表头缺列时直接报错，而不是悄悄生成一份错位的词表", () => {
    expect(() => columnIndex(["word", "phonetic"])).toThrow(/translation/)
  })

  it("考试标签 → 取最低的难度档", () => {
    expect(levelFromTags("cet4 cet6 ky toefl")).toBe(3)
    expect(levelFromTags("gre")).toBe(LEVELS.indexOf("GRE") + 1)
    expect(levelFromTags("zk gk")).toBe(1)
    expect(levelFromTags("")).toBeNull()
  })

  it("只收纯英文单词和短语", () => {
    expect(isPlainEntry("abandon")).toBe(true)
    expect(isPlainEntry("give up")).toBe(true)
    expect(isPlainEntry("well-known")).toBe(true)
    expect(isPlainEntry("-able")).toBe(false)
    expect(isPlainEntry("'hood")).toBe(false)
    expect(isPlainEntry("covid19")).toBe(false)
  })

  it("释义：取第一条义项，去词性和来源标注，按分号装到长度上限", () => {
    expect(pickGloss("v. 放弃；抛弃；遗弃\\nn. 放任\\n[网络] 放弃")).toBe("放弃；抛弃；遗弃")
    expect(pickGloss("[网络] 胡德\\nn. 罩；风帽")).toBe("罩；风帽")
    expect(pickGloss("vt. 获得（尤指经努力）；得到")).toBe("获得；得到")
  })

  it("释义：ECDICT 真实数据里义项用英文逗号分隔，切开后用中文分号拼，不截成半截词", () => {
    // abandon 在 ECDICT 里的原文
    const translation = "vt. 放弃, 抛弃, 遗弃, 使屈从, 沉溺, 放纵\\nn. 放任, 无拘束, 狂热"
    // 15 个字，再加「；放纵」就超过 16 的上限了
    expect(pickGloss(translation)).toBe("放弃；抛弃；遗弃；使屈从；沉溺")
  })

  it("音标里的西里尔字母 ә 换成国际音标 ə", () => {
    const row = {
      word: "obtain",
      phonetic: "әb'tein",
      translation: "vt. 获得",
      tag: "gk",
      exchange: "",
    }
    expect(toWordlistEntry(row)?.[2]).toBe("əb'tein")
  })

  it("释义第一个义项就超长时硬截断", () => {
    expect(pickGloss(`n. ${"很".repeat(30)}`)).toHaveLength(16)
  })

  it("变形：跳过原形和类型说明，只要真正的变形词", () => {
    expect(exchangeForms("p:abandoned/d:abandoned/i:abandoning/3:abandons")).toEqual([
      "abandoned",
      "abandoning",
      "abandons",
    ])
    expect(exchangeForms("0:abandon/1:p")).toEqual([])
  })

  it("词频排名：优先当代语料库，没有再用英国国家语料库，都没有是 0", () => {
    expect(rankOf({ frq: "793", bnc: "1595" })).toBe(793)
    expect(rankOf({ frq: "0", bnc: "1595" })).toBe(1595)
    expect(rankOf({ frq: "", bnc: "" })).toBe(0)
    expect(rankOf({})).toBe(0)
  })

  it("变形词条用 0: 指回原形", () => {
    expect(lemmaOf("0:country/1:s")).toBe("country")
    expect(lemmaOf("s:countries")).toBeNull()
    expect(lemmaOf("")).toBeNull()
  })

  it("变形词条的难度档不高于原形：countries 在雅思词表里单独成条，但它是中考词", () => {
    const entries = new Map<string, WordlistEntry>([
      ["country", ["country", 1, "", "国家"]],
      ["countries", ["countries", 6, "", "国家"]],
      ["remain", ["remain", 2, "", "保持"]],
      ["remains", ["remains", 3, "", "剩余物；废墟"]],
      ["abandon", ["abandon", 2, "", "放弃"]],
    ])

    const adjusted = harmonizeInflectionLevels(entries, [
      ["countries", "country"],
      ["remains", "remain"],
      ["abandoned", "abandon"], // 变形没有自己的词条：不处理
    ])

    expect(adjusted).toBe(2)
    expect(entries.get("countries")?.[1]).toBe(1)
    // 释义保留：remains 的意思和 remain 不一样
    expect(entries.get("remains")).toEqual(["remains", 2, "", "剩余物；废墟"])
  })

  it("原形档位更高时不动变形（只往低处调）", () => {
    const entries = new Map<string, WordlistEntry>([
      ["news", ["news", 1, "", "新闻"]],
      ["new", ["new", 3, "", "新的"]],
    ])
    expect(harmonizeInflectionLevels(entries, [["news", "new"]])).toBe(0)
    expect(entries.get("news")?.[1]).toBe(1)
  })

  it("没有考试标签、不是纯单词、没有释义的词条都不收", () => {
    const base = {
      word: "abandon",
      phonetic: "əˈbændən",
      translation: "v. 放弃",
      tag: "cet4",
      exchange: "",
    }
    // 没有词频数据时排名记 0
    expect(toWordlistEntry(base)).toEqual(["abandon", 3, "əˈbændən", "放弃", 0])
    expect(toWordlistEntry({ ...base, frq: "2182", bnc: "2057" })?.[4]).toBe(2182)
    expect(toWordlistEntry({ ...base, tag: "" })).toBeNull()
    expect(toWordlistEntry({ ...base, word: "-able" })).toBeNull()
    expect(toWordlistEntry({ ...base, translation: "" })).toBeNull()
  })
})

const FILE: WordlistFile = {
  version: 1,
  source: "test",
  levels: LEVELS,
  words: [
    ["obtain", 3, "əbˈteɪn", "获得"],
    ["study", 1, "ˈstʌdi", "学习"],
    ["stop", 1, "stɒp", "停止"],
    ["make", 1, "meɪk", "做"],
    ["leaf", 2, "liːf", "叶子"],
    ["bus", 1, "bʌs", "公共汽车"],
    ["give up", 2, "", "放弃"],
  ],
  forms: { went: "go", made: "make" },
}

describe("查词", () => {
  const wordlist = new Wordlist(FILE)

  it("原形直接查到", () => {
    expect(wordlist.lookup("obtain")).toMatchObject({ lemma: "obtain", level: 3, gloss: "获得" })
  })

  it("变形表里的不规则变形", () => {
    expect(wordlist.lookup("made")?.lemma).toBe("make")
  })

  it("常见后缀规则兜底", () => {
    expect(wordlist.lookup("obtained")?.lemma).toBe("obtain")
    expect(wordlist.lookup("studies")?.lemma).toBe("study")
    expect(wordlist.lookup("stopped")?.lemma).toBe("stop")
    expect(wordlist.lookup("making")?.lemma).toBe("make")
    expect(wordlist.lookup("leaves")?.lemma).toBe("leaf")
  })

  it("兜底猜出的原形必须真在词表里：bus 不会被当成 bu 的复数", () => {
    expect(wordlist.lookup("bus")?.lemma).toBe("bus")
  })

  it("大小写、首尾标点、所有格都能认", () => {
    expect(normalizeToken("“Obtain,”")).toBe("obtain")
    expect(wordlist.lookup("Study's")?.lemma).toBe("study")
  })

  it("词表里没有的词返回 null（包括变形表指向的原形不在词表里）", () => {
    expect(wordlist.lookup("went")).toBeNull()
    expect(wordlist.lookup("xyzzy")).toBeNull()
    expect(wordlist.lookup("123")).toBeNull()
  })
})
