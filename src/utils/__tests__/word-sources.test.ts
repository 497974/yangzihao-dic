import { describe, expect, it } from "vitest"
import {
  buildSourceLink,
  findWordSource,
  formatVideoTime,
  isRecordableSourceUrl,
  mergeWordSource,
  rememberSubtitleLookup,
  SUBTITLE_LOOKUP_TTL_MS,
  videoTimeForSave,
} from "../word-sources"

const PAGE = { url: "https://example.com/a", title: "A", savedAt: 1 }
const VIDEO = {
  url: "https://www.youtube.com/watch?v=abc",
  title: "V",
  savedAt: 2,
  videoTimeSec: 65,
}

describe("记出处", () => {
  it("词条大小写、空白不敏感，和生词本去重一个规则", () => {
    const db = mergeWordSource({}, "  Give Up ", PAGE)
    expect(findWordSource(db, "give up")).toEqual(PAGE)
  })

  it("再存一次保留第一次遇到的地方", () => {
    const db = mergeWordSource({}, "run", PAGE)
    const again = mergeWordSource(db, "run", { ...PAGE, url: "https://other.com", savedAt: 9 })
    expect(again).toBe(db)
  })

  it("原来只有网页、这次是从视频存的，换成视频的（能回去听原声）", () => {
    const db = mergeWordSource({}, "run", PAGE)
    expect(findWordSource(mergeWordSource(db, "run", VIDEO), "run")).toEqual(VIDEO)
    // 反过来不换
    const video = mergeWordSource({}, "run", VIDEO)
    expect(mergeWordSource(video, "run", PAGE)).toBe(video)
  })

  it("超过上限先丢最早存的", () => {
    let db = mergeWordSource({}, "a", { ...PAGE, savedAt: 1 }, 2)
    db = mergeWordSource(db, "b", { ...PAGE, savedAt: 2 }, 2)
    db = mergeWordSource(db, "c", { ...PAGE, savedAt: 3 }, 2)
    expect(Object.keys(db).sort()).toEqual(["b", "c"])
  })

  it("只记普通网页", () => {
    expect(isRecordableSourceUrl("https://a.com")).toBe(true)
    expect(isRecordableSourceUrl("chrome-extension://x/options.html")).toBe(false)
  })
})

describe("回到原处的链接", () => {
  it("YouTube、B 站带上时间点，已有的时间点换掉", () => {
    expect(buildSourceLink({ ...VIDEO, url: "https://www.youtube.com/watch?v=abc&t=5s" })).toBe(
      "https://www.youtube.com/watch?v=abc&t=65s",
    )
    expect(buildSourceLink({ ...VIDEO, url: "https://www.bilibili.com/video/BV1xx?p=2" })).toBe(
      "https://www.bilibili.com/video/BV1xx?p=2&t=65",
    )
  })

  it("没有时间点、或者不认识的网站，原样打开", () => {
    expect(buildSourceLink(PAGE)).toBe(PAGE.url)
    expect(buildSourceLink({ ...VIDEO, url: "https://vimeo.com/1" })).toBe("https://vimeo.com/1")
  })

  it("时间点显示", () => {
    expect(formatVideoTime(65)).toBe("1:05")
    expect(formatVideoTime(3723)).toBe("1:02:03")
    expect(formatVideoTime(0)).toBe("0:00")
  })
})

describe("字幕点词后存词带上时间点", () => {
  it("同一个页面、不久之前点过词 → 那句字幕的时间点", () => {
    rememberSubtitleLookup(VIDEO.url, 65_400, 1_000)
    expect(videoTimeForSave(VIDEO.url, 2_000)).toBe(65)
  })

  it("换了页面、隔太久都不带", () => {
    rememberSubtitleLookup(VIDEO.url, 65_400, 1_000)
    expect(videoTimeForSave("https://www.youtube.com/watch?v=other", 2_000)).toBeUndefined()
    expect(videoTimeForSave(VIDEO.url, 1_000 + SUBTITLE_LOOKUP_TTL_MS + 1)).toBeUndefined()
  })
})
