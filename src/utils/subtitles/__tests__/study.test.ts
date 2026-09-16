import { describe, expect, it } from "vitest"
import {
  cueEndingBetween,
  findCurrentCue,
  findNextCue,
  findPreviousCue,
  MAX_FRAME_JUMP_MS,
  PAUSE_LEAD_MS,
  RESTART_THRESHOLD_MS,
  tokenizeSubtitle,
} from "../study"

const CUES = [
  { start: 1_000, end: 3_000, text: "one" },
  { start: 4_000, end: 7_000, text: "two" },
  { start: 7_000, end: 9_000, text: "three" },
]

describe("找句子", () => {
  it("正在播的那句；两句之间是刚播完的那句；第一句之前没有", () => {
    expect(findCurrentCue(CUES, 2_000)?.text).toBe("one")
    expect(findCurrentCue(CUES, 3_500)?.text).toBe("one")
    expect(findCurrentCue(CUES, 7_000)?.text).toBe("three")
    expect(findCurrentCue(CUES, 500)).toBeNull()
  })

  it("上一句：刚开始播就跳到再上一句，播了一会儿先回到这句开头", () => {
    expect(findPreviousCue(CUES, 4_000 + 300)?.text).toBe("one")
    expect(findPreviousCue(CUES, 4_000 + RESTART_THRESHOLD_MS + 1)?.text).toBe("two")
    expect(findPreviousCue(CUES, 1_200)?.text).toBe("one")
  })

  it("下一句：开始时间在现在之后的第一句；最后一句之后没有", () => {
    expect(findNextCue(CUES, 2_000)?.text).toBe("two")
    expect(findNextCue(CUES, 4_000)?.text).toBe("three")
    expect(findNextCue(CUES, 8_000)).toBeNull()
  })
})

describe("逐句暂停：这一帧是不是刚播到句尾", () => {
  it("跨过句尾前一点点的那一帧算，停在这句末尾", () => {
    const stopAt = 3_000 - PAUSE_LEAD_MS
    expect(cueEndingBetween(CUES, stopAt - 16, stopAt + 1)?.text).toBe("one")
  })

  it("还没到、已经过了都不算", () => {
    expect(cueEndingBetween(CUES, 2_000, 2_016)).toBeNull()
    expect(cueEndingBetween(CUES, 3_100, 3_116)).toBeNull()
  })

  it("拖进度条跳过去的不算，倒着走的也不算", () => {
    expect(cueEndingBetween(CUES, 1_500, 1_500 + MAX_FRAME_JUMP_MS + 500)).toBeNull()
    expect(cueEndingBetween(CUES, 3_000, 2_900)).toBeNull()
  })
})

describe("把字幕拆成可以点的词", () => {
  it("英文词可以点，空格和标点原样保留，拼回去和原来一样", () => {
    const text = "Don't give up, it's well-known!"
    const tokens = tokenizeSubtitle(text)

    expect(tokens.filter((token) => token.word).map((token) => token.text)).toEqual([
      "Don't",
      "give",
      "up",
      "it's",
      "well-known",
    ])
    expect(tokens.map((token) => token.text).join("")).toBe(text)
  })

  it("数字、中文不能点", () => {
    expect(tokenizeSubtitle("第 3 集 hello")).toEqual([
      { text: "第 3 集 ", word: false },
      { text: "hello", word: true },
    ])
  })
})
