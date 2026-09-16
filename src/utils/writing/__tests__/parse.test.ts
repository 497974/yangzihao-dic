import { describe, expect, it } from "vitest"
import {
  addMistakes,
  countByType,
  markPracticed,
  MAX_MISTAKES,
  practiceOrder,
  removeMistake,
} from "../mistakes"
import { DEFAULT_TYPE, isSameSentence, parseCorrections } from "../parse"

describe("拆错误清单", () => {
  it("一行一条，四段分别是原文、改法、类型、讲解", () => {
    const raw = [
      "I very like it ||| I like it very much ||| 搭配 ||| very 不能直接修饰动词",
      "he go to school ||| he goes to school ||| 语法 ||| 第三人称单数要加 s",
    ].join("\n")

    expect(parseCorrections(raw)).toEqual([
      {
        original: "I very like it",
        corrected: "I like it very much",
        type: "搭配",
        explanation: "very 不能直接修饰动词",
      },
      {
        original: "he go to school",
        corrected: "he goes to school",
        type: "语法",
        explanation: "第三人称单数要加 s",
      },
    ])
  })

  it("模型加了序号、项目符号也照拆", () => {
    const raw =
      "1. a apple ||| an apple ||| 冠词 ||| 元音开头用 an\n- two book ||| two books ||| 单复数 ||| 复数要加 s"

    expect(parseCorrections(raw).map((item) => item.corrected)).toEqual(["an apple", "two books"])
  })

  it("少写了类型或讲解也不丢掉这一条", () => {
    expect(parseCorrections("teh ||| the")).toEqual([
      { original: "teh", corrected: "the", type: DEFAULT_TYPE, explanation: "" },
    ])
  })

  it("表头、空行、没有分隔符的散文都跳过", () => {
    const raw = ["原文 ||| 改成 ||| 类型 ||| 讲解", "", "整体写得不错，注意时态。"].join("\n")
    expect(parseCorrections(raw)).toEqual([])
  })

  it("没有可改的地方就是空清单", () => {
    expect(parseCorrections("")).toEqual([])
  })
})

describe("重练时比对答案", () => {
  it("大小写、标点、多余空格不计较", () => {
    expect(isSameSentence("He goes to school.", "he  goes to school")).toBe(true)
  })

  it("真改错了就是错", () => {
    expect(isSameSentence("he go to school", "he goes to school")).toBe(false)
  })
})

describe("错题本", () => {
  const one = {
    original: "I very like it",
    corrected: "I like it very much",
    type: "搭配",
    explanation: "",
  }
  const two = { original: "he go", corrected: "he goes", type: "语法", explanation: "" }

  it("同一条错不重复存（大小写、首尾空格不算区别）", () => {
    const db = addMistakes([], [one])
    const again = addMistakes(db, [{ ...one, original: "  i very like it  " }])

    expect(again).toHaveLength(1)
  })

  it("攒太多就把最早的挤掉", () => {
    const many = Array.from({ length: MAX_MISTAKES + 10 }, (_, index) => ({
      original: `wrong ${index}`,
      corrected: `right ${index}`,
      type: "语法",
      explanation: "",
    }))

    const db = addMistakes([], many)

    expect(db).toHaveLength(MAX_MISTAKES)
    expect(db[0]!.original).toBe("wrong 10")
  })

  it("练对过的往后排，没练过的先出", () => {
    let db = addMistakes([], [one, two])
    db = markPracticed(db, db[0]!.id)

    expect(practiceOrder(db)[0]!.original).toBe(two.original)
    expect(db[0]!.practiced).toBe(1)
  })

  it("按类型统计，最常犯的排最前", () => {
    const db = addMistakes([], [one, two, { ...two, original: "she go", corrected: "she goes" }])

    expect(countByType(db)[0]).toEqual({ type: "语法", count: 2 })
  })

  it("删掉一条", () => {
    const db = addMistakes([], [one, two])
    expect(removeMistake(db, db[0]!.id)).toHaveLength(1)
  })
})
